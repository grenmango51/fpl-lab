# Scenario and optimiser API additions

All existing endpoints remain compatible. Forecast requests (`/api/projections`, `/api/optimise`, `/api/lineup`, `/api/plan/validate`, `/api/snapshot`, `/api/sensitivity`) accept:

```json
{
  "stat_schedule": {
    "123": {
      "8": {"expected_points": 7.2, "xg": 0.55, "xa": 0.25, "clean_sheet_probability": 0.4}
    }
  }
}
```

Fields are independently optional; each scenario needs at least one. `xg` and `xa` are unconditional **gameweek totals**, not per-90 values. Double-gameweek attacking totals are split between fixtures in proportion to their original event expectations, falling back to expected minutes. `clean_sheet_probability` is a probability from 0 to 1 applied to each fixture; clean-sheet points still require the 60-minute appearance state. Points are between -5 and 60; xG/xA between 0 and 10. Only canonical current player IDs and remaining GWs are accepted, and all numbers must be finite. Blank gameweeks stay zero. A positive attacking/points edit cannot revive a zero-appearance player; set minutes/availability first.

Stat edits apply after normal provider/CSV calibration. Every unedited player-week remains exactly unchanged. Edited weeks contain `stat_scenario` with supplied fields, `label`, `source: "user-assumed"`, `adjusted_at`, and `base: {expected_points, xg, xa, clean_sheet_probabilities}`. The `base.clean_sheet_probabilities` array retains the original fixture-order source probabilities for Teams/Markets views; player assumptions must not be shown as newly sourced team odds. Their `prediction_source.kind` is `"user-scenario"` and `prediction_source.previous` retains the prior point-layer provenance. Fixture and GW components reconcile with points; a direct expected-points edit is an explicit `user_points_adjustment`. Existing provider/imported residuals remain separately identified. This is a human planning scenario, with no claim of provider or injury information.

Optimiser requests additionally accept:

```json
{
  "horizon": 38,
  "transfer_limits": {"8": 0, "9": 3},
  "locked_by_gw": {"8": [123, 456]},
  "excluded_by_gw": {"9": [456]},
  "captain_locks": {"8": 123}
}
```

`horizon` is 1–38 and clipped at GW38. Existing global `locked`, `excluded`, `max_transfers` remain defaults. Per-GW locks require ownership that week; exclusions prohibit ownership; a captain lock requires ownership and a starting place. Constraints are enforced inside the MILP. Constraint weeks must be within the requested (clipped) solve window. `transfer_limits` is a 0–15 count and also constrains Wildcard/Free Hit squad changes when explicitly supplied. The ordinary solve accepts a supplied chip schedule; the separate [WC/FH placement job](CHIP_STRATEGY_CONTRACT.md) searches bounded placements of an unused allowance. Existing `max_transfers` does not constrain unlimited-transfer chips.

Solve responses include `requested_horizon`, `actual_horizon`, `start_gw`, `end_gw`, `solve_seconds`, `time_limit_seconds`, `variable_count`, `constraint_count`, `status_code`, and `feasible`. Long solves use the official `highspy` package to supply a constraint-checked full-horizon incumbent before improving the same joint MILP for the requested bounded 2–45-second native time limit. A short optimised prefix with legal held continuation normally supplies this incumbent; later constraints can require additional bounded four-week seed segments. Those are initialisation, not a replacement for the final joint search. Extra seed work is bounded by ten segments of at most four seconds; total request time can exceed the native limit. `engine`, `warm_start`, `warm_start_seconds`, `joint_solve_seconds`, `native_status` disclose this work. `gap` can be null when a reliable native bound is unavailable and must not be shown as zero. Optimality remains relative to the disclosed candidate pool. If no feasible incumbent is found, HTTP 422 explains that the time limit or constraints prevented a plan.

When the existing squad can legally be held over a seed segment, that short solve also starts through `highspy` with the held plan checked against all of its MILP constraints. This prevents a four-second segment from spending its entire budget finding any feasible squad before attempting improvements. When holding violates a required transfer, exclusion or ownership constraint, ordinary feasibility search remains necessary. The final full-horizon joint solve still controls the returned plan and can change every week.

Snapshots preserve `stat_schedule` in their configuration/hash and `stat_scenario` in each future player target. Sensitivity jobs freeze the edited forecasts. No predictions or plans are submitted to FPL.

`POST /api/players/{id}?gw=N` accepts a forecast request for scenario-aware player details and simulation. `POST /api/export/projections.csv` accepts the same request to export the edited forecast. Existing GET variants use default forecasts.

## Automatic TC/BB placement

`POST /api/chips/recommend` accepts an existing `PlanRequest`: `base_squad`, `bank`, `free_transfers`, `purchase_prices`, `weeks`, `used_chips`, and all forecast inputs including `stat_schedule`. It validates the starting plan on the server, retains all manually assigned chips, then recommends remaining Triple Captain and Bench Boost placements among its existing chip-free weeks. Separate GW1–19 and GW20–38 allowances apply. WC/FH stay where the caller scheduled them. Squads, transfers, XI, captain, vice and bench order stay fixed; regular optimisation can subsequently use the returned schedule.

The response contains `chips` (non-`none` schedule, keyed by GW), `recommendations: [{chip, gw, half, marginal_points}]`, independently validated resultant `weeks`, `baseline_net_points`, `recommended_net_points`, `improvement`, `available_windows: [{chip, half, gameweeks}]`, `candidate_counts`, `status`, `method`, and `limitations`. Totals use undiscounted full squad expected net points over exactly the same supplied GWs, including formation-aware autosubs and vice fallback. This is exact TC/BB placement for a fixed plan under the existing scoring approximation, not simultaneous stochastic transfer/chip optimisation or paid-model parity.

## Permanent holdings and saved-plan rebasing

Every week returned by `POST /api/plan/validate` (and chip recommendations, which use the same validation) includes `permanent_squad: number[]`, `permanent_bank: number` and `purchase_prices: Record<string, number>`. These describe the permanent state **after** that week and are snapshots, not references to subsequent decisions. Normal transfers and Wildcards update holdings and purchase costs. Free Hits retain the earlier permanent squad, bank and purchase costs; the ordinary `squad` and `bank` fields still describe the temporary Free Hit team. Values are in millions of pounds. `next_free_transfers` is the allowance entering the next GW, including preserved WC/FH allowances.

To rebase a saved branch after completed gameweeks, use the last expired week's permanent receipts as `base_squad`, `bank` and `purchase_prices`, and its `next_free_transfers` as the new initial allowance. Keep expired decisions in local history; move their non-`none` chips into `used_chips`. Historical purchase costs remain those recorded when acquired, even if the latest official price has risen. Never reconstruct a receipt-bearing branch using today's price as its purchase price. Older saved plans without these receipts need an explicitly labelled legacy fallback.

The server rejects duplicate chip allowances, two historical chips in one GW, and a used-chip record at or after the first planned GW. Solver chip assignments must be inside its requested solve window. Purchase prices must be finite and greater than zero, with a declared 200-million input cap; malformed future player IDs receive HTTP 422 before transfer pricing or scoring.

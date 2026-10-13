# Wildcard / Free Hit placement search

`POST /api/chip-strategy` starts a local background job. `GET /api/chip-strategy/{id}` polls it; `POST /api/chip-strategy/{id}/cancel` cancels between solves. Create/poll/cancel return HTTP 200 with the job. Invalid requests return 422, another active placement job 409, and missing/restarted jobs 404. No FPL transfers are submitted.

The body extends `SolveRequest` and all outer forecast/provider/CSV/stat/minutes settings:

```json
{
  "auto_chip": "wildcard", "chip_half": 1,
  "start_gw": 7, "horizon": 8, "seconds": 6,
  "max_candidates": 4, "budget_seconds": 120,
  "candidate_gws": [], "name": "Wildcard timing"
}
```

Supply either the usual entering `squad`, `bank`, `free_transfers`, `purchase_prices`, `used_chips` and manual `chips`, or optional `source_plan: PlanRequest` containing the active branch's `base_squad`, `bank`, `free_transfers`, `purchase_prices`, `used_chips` and nonempty `weeks`. Its earlier weeks are server-validated against the frozen outer forecast settings. Exact permanent receipts derive the squad, bank, historical purchase costs and FTs entering `start_gw`, including Free Hit restoration. Those prefix decisions are returned with every adoptable result. The source's manual chips stay fixed. If a later manual source chip lies beyond the requested window, extend the horizon; adoption never silently drops it. Later non-chip decisions are replaced by the searched window, as in ordinary optimisation.

One previously unscheduled `wildcard` or `freehit` in one `chip_half` (1 = GW1–19; 2 = GW20–38) is searched per job. A spent or manually scheduled allowance is rejected. Other manual chips exclude their GW from automatic placement. `candidate_gws` accepts up to 38 distinct chip-free solve weeks in the chosen half; empty means all legal weeks in that half/window. `max_candidates` is 1–8, default 4. Larger eligible sets are sampled deterministically at evenly spaced dates including endpoints; a single candidate uses the middle eligible week. Horizon is 1–38, clipped at GW38. `seconds` is 2–12 native seconds per solve, default 6; `budget_seconds` is 30–240, default 120. Budget/cancel checks occur between solves; current bounded native and seed work finishes first, so wall time can exceed the requested budget. One placement job runs at once, and up to six recent local reports remain.

The baseline uses existing manual chips and no added chip. Each placement reoptimises identical forecasts, GWs, initial permanent holdings, prices, bank, FTs and objective settings with only its chosen chip added. Weekly locks, exclusions, captains and transfer ceilings still apply. Baseline players are retained in later candidate pools. Every result is independently replayed for FPL legality, exact permanent restoration and pricing; requested weekly constraints and fixed chip assignments are checked again. A failed baseline ends the job without an improvement recommendation.

Short strategy windows also use the official native `highspy` interface. When holding the current squad satisfies every weekly constraint, the full short-window hold is checked against the MILP and supplied as an incumbent before the timed search. WC/FH preserve its permanent state and FT allowance. This makes a feasible held result available even if a two-second native budget ends before finding an improvement. Required future purchases or exclusions can prevent a held seed; native feasibility search may then still fail honestly. Unknown native gaps remain null, and a retained hold does not imply any transfer or chip improvement.

Rank by discounted full squad expected net points (`decay` from the request), including autosubs, vice fallback and hits. This ranking excludes saved-FT utility and ownership preference, which remain solver objective settings. Undiscounted net totals are also returned. Screening and native time limits can affect rankings; a complete job means all selected placements were attempted, not globally optimal timing or forecast accuracy.

```typescript
type ChipStrategyJob = {
  id: string;
  status: 'queued' | 'running' | 'complete' | 'cancelled' | 'budget-exhausted' | 'failed';
  phase: string;
  created_at: string; started_at: string | null; finished_at: string | null;
  elapsed_seconds: number;
  attempted: number; completed: number; total: number; // Include the baseline.
  current_candidate_id: string | null;
  cancel_requested: boolean; error: string | null;
  settings: {
    auto_chip: 'wildcard' | 'freehit'; chip_half: 1 | 2;
    candidate_gws: number[]; max_candidates: number; budget_seconds: number;
    name: string; solve: Record<string, unknown>;
  };
  forecast: {
    sha256: string; configuration_hash: string; input_hash: string;
    model_version: string | null; loaded_at: string | null; frozen_at: string;
    layers: unknown[]; sources: Record<string, unknown>;
    coverage: { players: number; gameweeks: number[]; player_gameweeks: number };
  };
  scope: {
    gameweeks: number[]; eligible_gameweeks: number[]; selected_gameweeks: number[];
    all_eligible_selected: boolean;
  };
  candidates: ChipStrategyCandidate[]; // Baseline first, then ascending selected GW.
  baseline: ChipStrategyCandidate | null;
  best: ChipStrategyCandidate | null; // Baseline retained when no placement improves it.
  recommendation: { chip: 'wildcard' | 'freehit'; gw: number; improvement: number } | null;
  failures: { candidate_id: string; message: string }[];
  method: string; limitations: string[];
};
type ChipStrategyCandidate = {
  id: string; chip: 'none' | 'wildcard' | 'freehit'; gw: number | null;
  placements: { chip: 'wildcard' | 'freehit'; half: 1 | 2; gw: number }[];
  status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped-budget' | 'skipped-cancel' | 'skipped-failure';
  error: string | null;
  weeks?: Week[];        // Complete validated frozen prefix + solved window; adopt these.
  solve_weeks?: Week[];  // Exactly the requested GW window used for fair comparison.
  chips?: Record<string, string>;
  net_points?: number; discounted_net_points?: number;
  improvement?: number; // Discounted full squad EV minus hits against baseline.
  undiscounted_improvement?: number;
  solve?: SolveResult;  // Native status/gap/times/pool metadata, with validated solve_weeks.
};
```

The frontend component is `ChipStrategyView` from `./ChipStrategyView`, with props `plan: Plan | null`, `forecast: Record<string, unknown>`, optional `solveOptions: Record<string, unknown>`, `busy: boolean`, `onApply: (source: Plan, weeks: Week[]) => Promise<void>` and `onNotify: (message: string, error?: boolean) => void`. It imports its own CSS. Freeze the source branch when starting a job; `onApply` receives that source and the complete validated result. The parent revalidates against current inputs and saves a separate branch using the source's original initial resources. Results remain reviewable after input changes, with saving disabled while inputs differ. Polling retries transient failures and treats confirmed missing jobs as lost. Reports are process-local; download JSON before restarting.

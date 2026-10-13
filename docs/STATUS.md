# Current handover

Updated 2026-10-13. **Open FPL runs locally on the Windows laptop. The planner has been rebuilt around the observed Solio workflow; exact feature and forecast parity is not claimed.**

## Open and run

Production: http://127.0.0.1:8000. Development: http://127.0.0.1:5173.

Run `./start.ps1` from this folder. It checks runtimes, installs missing or changed dependencies, builds outdated production files and starts the API in the background. `-Development` uses Vite; `-Restart` restarts a server owned by the script. Runtime logs and the process record are in ignored `data/cache/runtime/`. See [README.md](../README.md) for separate-terminal commands.

This checkout is a local Git repo without a remote. The app needs no cloud account. Raw feeds, snapshots, exports and credentials remain local and ignored.

## Delivered in the rebuild

- Original Open FPL branding with a narrow navigation rail, connected scenario/gameweek canvas and a detail panel containing Lineup, Projections, Optimise, Plans and Fixtures. Configure, create/copy/delete, horizon and selected-GW controls follow the inspected Solio workflow. The mobile planner uses an explicit branch selector and internally scrolling gameweek cards.
- Public team import; editable bank/FTs; independent saved branches; profit-aware transfers, hits and FT carryover; legal squads, formations, captain/vice and bench order; all four manual chips. Free Hit restores permanent holdings and bank. Server validation checks every adopted plan.
- Player actions for captain/vice, lock, ban and transfer; editable per-GW minutes/availability plus expected points, xG, xA and clean-sheet probability. These are labelled human assumptions. Stat edits run after provider/CSV calibration, preserve original values and leave every unedited player-week unchanged. xG/xA use unconditional GW totals, rather than Solio's gated per-90 edit fields.
- Player, team and fixture projection views through GW38, with search/filter/sort, multiple metrics, watchlists, source labels and CSV import/export. The current pool is **667 players across 20 clubs, GW7–38**. Missing market observations remain missing; a player's stat scenario does not become sourced team odds.
- One joint multiweek MILP through GW38: global/per-GW ownership locks and exclusions, captain locks, transfer ceilings, chips, budget, club/position constraints, hits and FT rollover. Presets expose local ownership preference, transfer value and bench weighting. Draft review keeps the pitch visible; Apply saves a separate branch and preserves validated earlier decisions.
- Long solves use official `highspy` with a constraint-checked seed and a bounded joint search. Legal held squads initialise short seed segments so their budget can improve an existing feasible plan. Time, candidate pool, status and MIP gap are shown; unknown gaps remain unknown. This is not a guarantee of full-season optimality.
- Automatic Triple Captain/Bench Boost placement on a frozen, validated plan, respecting manual chips and separate first/second-half allowances. It compares the same GWs with full expected squad scoring and saves a separate branch. Transfers/XI stay fixed during placement. A separate bounded Wildcard/Free Hit search reoptimises each selected legal placement against a frozen baseline; one chip allowance is searched at a time.
- Plans insights: matched-GW comparison with holding, weaker-starter alternatives, points components, expected bench/fallback contribution, FT/bank pressure, player exposure and club exposure. Ownership is current official FPL selection, not Solio projected effective ownership. Expected autosubs/vice fallback use the documented independent-appearance approximation.
- Saved settings/plans recover safely after the GW advances. Original records are archived before sanitisation; expired decisions remain in branch history; permanent squad/bank/purchase receipts preserve Free Hit and profit-aware costs. Legacy plans without purchase receipts have an explicit fallback notice. Configuration/file import and refresh validate before applying changes.
- Existing seeded background stress tests, progress/cancellation, representative branch adoption and JSON reports; player history and uncalibrated simulations; historical benchmarks, source receipts and prospective evaluation remain available. Stress variation is user-chosen, not calibrated uncertainty.

[Direct reference inventory](SOLIO_REBUILD.md), [earlier observed flow](SOLIO_UX.md), [API contract](BACKEND_CONTRACT.md), and [model assumptions](MODEL.md) document what these features mean.

The new Market > Movement view reconstructs timestamped fixture observations from local public archives, with team/source/time filters, goal and clean-sheet graphs, deltas and exports. Extraction and provider times stay separate. Joe has comparable GW1-8 observations with no observed nonzero changes; the Elevenify sheet remains a single-snapshot baseline. Missing latest values disable deltas. [History contract and coverage](MARKET_HISTORY_CONTRACT.md).

## Sources and coverage

Official FPL supplies current IDs, stable player codes, rules, prices, public team state, fixtures and history. FPL Joe supplies near-term fixture markets; the directly accessed Elevenify season sheet supplies full-season team expectations. FPL Form supplies a five-GW player-point window, blended at a configurable default 50%. Later player adjustments fade through the future fixture schedule. Direct input and extrapolation have separate provenance. Authorised uploaded projections remain optional.

Elevenify's five published player-reference feeds matched 176 unique current players, including 112 with attacking views, at the original extraction. Market → Provider shortlists retains supplied GW labels, conditioning, units, coverage, extraction times/hashes and separate series. These selected-player references are not complete per-GW point exports and do not alter forecasts. Their old source windows are never shifted forward.

FPL Review's authenticated free view and premium CSV gate were verified on October 3. No complete Review CSV or Massive Data feed was acquired. Solio's signed-in free GW7–11 planner was directly inspected on October 12; gated Opta/stats/rules/chip controls and public full-season membership descriptions provide an inventory, not access to its proprietary forecasts or optimiser. [Provider access evidence](PROVIDER_ACCESS.md).

The October 13 coverage check verified **21,344/21,344 player-GW forecasts: 667 players × all 32 GWs from 7 through 38**. It also checks current IDs, fixture membership, finite values, component reconciliation, blank-week zeros, probability ranges and source labels. Re-run it after source/model changes:

```powershell
python tools/verify_forecast_coverage.py
```

The fresh pre-deadline capture `2026-27_gw7_20261013T045716140829Z.json.gz` contains all 667 players through GW38. Component, FPL Form and ensemble acquisition receipts passed the declared freshness policy. Extraction freshness is not proof of provider publication time or accuracy. Seven older GW6 snapshots were restored into ignored local storage; old plain/gzip formats remain readable.

## Verification

- **320 backend tests passed, 55 frontend tests passed, and the production TypeScript/Vite build passed** after the seed, persistence and review changes.
- A real entry-2200722, 32-GW, 30-second native joint solve returned four transfers and **1,796.78 expected net points**, with a **1.755% MIP gap**. This is one feasible planning result under current forecasts/objective/candidate screening, not a performance benchmark or proof of optimality.
- Real stat-scenario API checks changed exactly one of the 21,344 player-weeks; all other rows stayed equal. Scenario-aware player detail and CSV export carried the adjusted value/provenance. Browser save/reset restored the original forecast and the test override was removed.
- Earlier verified flows include imports, transfer rejections, captain/vice, manual chips, watchlists, minutes schedules, CSV import/export, draft adoption from a frozen branch, preserved earlier GWs, background stress completion/cancellation and transient-polling recovery. October 3 suites contained 216 backend/22 frontend tests; those are historical checks, superseded by the current counts above.
- Rebuilt flows were inspected in the user's Chrome. Desktop includes the connected tree, draft pitch, Plans insights and market graphs. At 390 x 844, GW38 selection, branch switching and all 32 projection columns worked without document overflow; pitch rows have 6px clearance. Market history shows observed zero Joe deltas, missing latest values and single-snapshot sheet values correctly.
- Production paste import round-tripped six branches/settings while preserving its existing branch. A real six-GW FH timing search completed 3/3: baseline 329.7 net xPts, FH7 best 332.3, +3.2 discounted net xPts, gap 0.16%. Switching the active branch during the search retained its original source. Adoption independently validated a new branch; FH7 kept the exact permanent squad and GBP1.5m bank and GW8 applied transfers against those restored holdings.
- The updated 32-GW transfer branch received TC in GW16, TC in GW27 and BB in GW34, +21.3 expected points on fixed transfers/lineups, for 1818.1 expected net points. Nine production branches survived reconnect/reload. Backup text and paste import work without extension file-upload permissions.
- ./start.ps1 rebuilt and restarted its owned API, then verified the production HTML. Its Windows UTF-8 comparison was corrected. Production is running at 127.0.0.1:8000, with the user's saved season plan open. Final coverage was rerun after the last backend restart: 21,344/21,344 records passed. Desktop/mobile proof images and plan receipts remain in ignored data/exports/qa/.

## Historical evaluation and prospective status

The fixed 2025/26 holdout contains 7,720 player-fixture rows with **projected** minutes of at least 45. The ML challenger fits 2023/24–2024/25; feature states update after an entire GW. No current provider forecasts are backfilled into history.

- Component: MAE **2.289**, RMSE **3.076**.
- ML challenger: MAE **2.331**, RMSE **3.084**.
- Recent five-match form: MAE **2.575**, RMSE **3.358**.
- Appearance-adjusted PPG: MAE **2.310**, RMSE **3.156**.
- Component-minus-PPG MAE: **−0.021**; GW-cluster bootstrap 95% interval approximately **[−0.043, −0.0002]**. This is a small improvement.
- Minutes MAE: **24.3 minutes**. Automatic appearance forecasting remains a weakness.

These numbers evaluate the historical component model, not the default live blend, manual scenarios or long-range extrapolation. No paid-provider superiority has been demonstrated.

GW6 was captured before its official October 10, 10:00 UTC deadline. The latest original GW6 capture preserved 667 players for 33 remaining GWs, with raw FPL Form points only for GW6–10. On October 13, scoring still returned no eligible completed results and no scanner diagnostics: unchecked/incomplete official outcomes remain pending rather than producing a fabricated accuracy score. The new GW7 capture is also pending.

Prospective scoring keeps component, raw provider and ensemble forecasts separate, uses identical matched players, and predeclares six lead-time windows. Deadline/schedule changes, unknown publication times, stale inputs, manual assumptions and incomplete outcomes remain disclosed. A season of deadline-aligned evidence is needed before tuning weights or claiming competitive accuracy.

## Material gaps and next work

1. Wildcard/Free Hit timing search is bounded to one chosen chip allowance and sampled candidate weeks. It does not jointly enumerate every multi-chip schedule or reproduce Solio's proprietary stochastic optimisation. Baseline and candidates share frozen forecasts, resources and gameweeks; validated partial results retain their search limits.
2. Solio's proprietary forecasts, effective ownership, disruption/risk model, calibrated distributions and exact optimisation objective are unavailable. Local presets/insights use their stated assumptions; matching screen structure cannot establish numerical parity. Natural-language rules and every Solio Plans chart are not reproduced.
3. Player stat editing covers GW points/xG/xA/CS plus minutes/availability. It does not yet expose a complete per-90 component model editor, automated press-conference ingestion or reliable injury-recovery forecasts.
4. Score completed captured weeks, compare the live blend with its own inputs, and obtain further authorised snapshots before changing model weights. Calibrate uncertainty, correlated appearances/clean sheets and bonus/BPS on a fresh holdout.
5. Public hosting, accounts/sync and redistribution licences are outside this laptop-only delivery.

The MILP uses a linear bench/fallback approximation; displayed totals use fuller expected squad scoring. Future prices are fixed and ownership preference is heuristic. No transfers are submitted to FPL.
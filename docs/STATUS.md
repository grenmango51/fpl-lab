# Current handover

Updated 2026-10-02. **The local application is operational. Paid-model accuracy parity remains unproven.**

## Open and run

Production: http://127.0.0.1:8000. Development: http://127.0.0.1:5173.

From `fpl-lab/`, run `./start.ps1 -Install` once, then `./start.ps1`. An existing Open FPL server is detected. Development uses `./start.ps1 -Development`. See the README for separate-terminal commands.

Root `AGENTS.md` and `.cursor/rules/open-fpl.mdc` explain the new scope. The legacy football research and StatsBomb folders were preserved; their staged changes were not altered.

## Delivered

- Original Open FPL branding, using Solio's dark navy/orange planner, pitch, timeline, compact panels and analytical tabs as visual references.
- Planner branches, public team import, bank/FT editing, profit-aware transfers, hits, legal XI and club/squad constraints, captain/vice selection, bench priority and all four chips. Public chip history is imported. Importing after Free Hit restores the permanent squad and bank.
- Expected autosubs and vice fallback, respecting bench order and formation, under the documented independent-appearance approximation.
- Forecasts, manual planning and fixture grids through GW38. The current pool is 667 players across 20 clubs. The optimiser supports 1–14 GWs, locks/exclusions, decay, saved-FT value, bench weight and ownership preference. Results become separate branches after review.
- Real FPL Joe near-term fixture expectations and the direct public Elevenify season sheet. Public FPL Form player forecasts match all 667 current IDs; the next three weeks supply an optional 50% default blend.
- Short-range provider and uploaded CSV anchors extrapolate through future fixture forecasts with fading influence. Direct and extrapolated weeks have distinct labels. FPL Review-style wide CSV exports are accepted.
- The authorised free Elevenify/Substack account is created and confirmed in Ilmari Chrome. Its normal published tables provide 49 attacking baselines and 99 importance/captain shortlist rows, matching 125 unique current players. Market → Provider shortlists exposes them with units, source times, hashes, mapping coverage, filters and CSV export. They do not provide per-GW points and do not change projections.
- Per-GW duration and availability schedules, including explicit human recovery assumptions, take priority over provider/CSV layers in scheduled weeks. Parallel normal forecasts preserve other weeks' extrapolation calibration. CSV accepts weekly schedules and rejects duplicates or availability without a GW. Legacy global duration inputs remain compatible.
- Background seeded strategy stress tests: frozen inputs, progress, cancellation between solves, successful-scenario frequencies, representative branches and JSON reports. Native solves are serialised. Temporary polling failures retain the job and retry; confirmed missing jobs are cleared. User-chosen variation is not calibrated uncertainty.
- Player search/filter/sort, watchlists, price/transfer view, scoring breakdowns, player history, minutes scenarios, uncalibrated simulations, CSV export and validated plan-file import/export.
- Historical charts, source timestamps/hashes, compressed raw archives, pre-deadline snapshots, and prospective comparison of the component model, FPL Form and live ensemble on identical player rows.

## Verification

- **80 backend tests passed:** prior FPL rules/evaluation checks plus weekly minutes/availability, blank/double fixtures, unchanged cached baseline, multi-layer schedule calibration, seeded frozen sensitivity, legal real-MILP scenarios, cancellation/failure/orphan jobs, API bounds, provider mapping/aliases, feed validation and cached/unavailable references.
- **14 frontend tests passed:** CSV edge cases and weekly schedules, provider export formats, duplicate GW rows, legal lineups, expected squad scoring, transient stress polling recovery and confirmed-404 handling.
- Production TypeScript/Vite build and Python undefined/unused-name checks passed.
- Real API checks: prior checks plus both reference feeds and a scheduled zero-minute GW passing through provider plus sourced CSV layers. Every other 32 GW forecast record remains exactly equal to normal output, including minutes, components and provenance. An unknown scheduled player is rejected with HTTP 422.
- Browser checks: imports, transfers/rejections, captain/vice changes, chips, watchlists, minutes scenarios, optimiser review/application, fixtures, analysis, 33-week timeline, provider/extrapolation labels and wide CSV import using real FPL Form values. Test-only branches and CSV settings were removed.
- New browser checks: reference pagination/units/provenance, selected-GW minutes save/reset, completed 8/8 stress scenarios, independent server-validated branch adoption, restart/404 recovery and simulated one-request connection failure followed by successful polling recovery. Original plans remain preserved; test branches and minutes assumptions were removed.
- A 20-scenario, six-GW cancellation check stopped after 4 completed scenarios and displayed partial results with the correct denominator.
- Mobile DOM layout checked at 390×844: no document overflow, all five midfield tiles fit, timelines scroll internally and branch switching is available. Desktop layout also inspected.
- Reference tables also pass mobile DOM checks at 390×844: no document overflow; wide data tables scroll internally. The shared browser intermittently fails screenshots. Desktop captures succeeded, but the bitmap is visibly blurred, so detailed pixel/readability QA remains incomplete.
- Warm full-season forecasts were measured at approximately **0.9 seconds** after response/copy improvements; initial data acquisition is slower and depends on upstream feeds.

## Historical evidence

The fixed 2025/26 holdout contains 7,720 player-fixture rows with **projected** minutes of at least 45. The ML challenger fits 2023/24–2024/25. Features update after an entire GW; no current provider forecasts are backfilled into history.

- Component model: MAE **2.289**, RMSE **3.076**.
- ML challenger: MAE **2.331**, RMSE **3.084**.
- Recent five-match form: MAE **2.575**, RMSE **3.358**.
- Appearance-adjusted PPG: MAE **2.310**, RMSE **3.156**.
- Component-minus-PPG MAE difference: −0.021; GW-cluster bootstrap 95% interval approximately [−0.043, −0.0002]. The improvement is small.
- Minutes MAE: **24.3 minutes**. Appearance quality is a major weakness and a reason to use external player forecasts and human updates.

These numbers evaluate the historical component model. They do **not** evaluate the default live blend or long-range extrapolation. No superiority over FPL Review, Solio or another paid provider has been demonstrated.

GW6 was captured before its official 2026-10-10 10:00 UTC deadline. The latest final-build capture is `2026-27_gw6_20261002T163932263530Z.json`. Scoring correctly returns no completed result yet. Snapshots and raw provider data stay local and ignored by Git.

## Next research priorities

1. Capture updates near deadlines and score completed weeks. Compare the live blend with its component and FPL Form inputs before changing weights or decay.
2. Inspect FPL Review's authorised free Patreon login and export availability, and Elevenify's linked fixture-specific goal/assist views. Free Elevenify signup and baseline/shortlist integration are complete; no premium point export is claimed.
3. Improve automatic minutes, injury recovery and team-selection news. Human weekly scenarios now work, but scalar point anchoring cannot identify future minutes or attacking rates by itself.
4. Check uncertainty calibration, bonus/BPS reconstruction and correlated appearance/clean-sheet outcomes on a fresh holdout.
5. For public hosting, add accounts/sync and appropriate provider redistribution rights. This deliverable is a local personal tool.

The MILP's linear objective approximates bench/fallback effects; displayed totals use the fuller squad calculation. Candidate-pool optimality is distinct from accuracy. Future prices are fixed, ownership preference is heuristic, and no transfers are submitted to FPL.

# Current handover

Updated 2026-10-03. **The local application is operational. Paid-model accuracy parity remains unproven.**

## Open and run

Production: http://127.0.0.1:8000. Development: http://127.0.0.1:5173.

From `fpl-lab/`, run `./start.ps1 -Install` once, then `./start.ps1`. An existing Open FPL server is detected. Development uses `./start.ps1 -Development`. See the README for separate-terminal commands.

Root `AGENTS.md` and `.cursor/rules/open-fpl.mdc` explain the new scope. The legacy football research and StatsBomb folders were preserved; their staged changes were not altered.

## Delivered

- Original Open FPL branding, using Solio's dark navy/orange planner, pitch, timeline, compact panels and analytical tabs as visual references.
- Planner branches, public team import, bank/FT editing, profit-aware transfers, hits, legal XI and club/squad constraints, captain/vice selection, bench priority and all four chips. Public chip history is imported. Importing after Free Hit restores the permanent squad and bank.
- Expected autosubs and vice fallback, respecting bench order and formation, under the documented independent-appearance approximation.
- Forecasts, manual planning and fixture grids through GW38. The current pool is 667 players across 20 clubs. The optimiser supports 1–14 GWs, locks/exclusions, decay, saved-FT value, bench weight and ownership preference. Results become separate branches after review.
- Real FPL Joe near-term fixture expectations and the direct public Elevenify season sheet. Public FPL Form player forecasts match all 667 current IDs; the next five weeks supply an optional 50% default blend.
- Short-range provider and uploaded CSV anchors extrapolate through future fixture forecasts with fading influence. Direct and extrapolated weeks have distinct labels. FPL Review-style wide CSV exports are accepted.
- The authorised free Elevenify/Substack account is created and confirmed in Ilmari Chrome. Five published reference feeds match 176 unique current players, including 112 with attacking views. Market → Provider shortlists exposes baseline/importance tables and separate next-GW / three-GW goal/assist series, labelled weeks, start conditioning, unknown duration, units, source times, hashes, mapping coverage, filters and CSV export. These are not per-GW point exports and do not change projections.
- Review's assigned Chrome profile was already Patreon-connected without premium access. Its free planner showed GW6–9 and 50 visible DOM rows; complete-pool coverage is not established. The CSV action explicitly showed a premium gate. No Review CSV or Massive Data feed was acquired.
- Per-GW duration and availability schedules, including explicit human recovery assumptions, take priority over provider/CSV layers in scheduled weeks. Parallel normal forecasts preserve other weeks' extrapolation calibration. CSV accepts weekly schedules and rejects duplicates or availability without a GW. Legacy global duration inputs remain compatible.
- Background seeded strategy stress tests: frozen inputs, progress, cancellation between solves, successful-scenario frequencies, representative branches and JSON reports. Native solves are serialised. Temporary polling failures retain the job and retry; confirmed missing jobs are cleared. User-chosen variation is not calibrated uncertainty.
- Player search/filter/sort, watchlists, price/transfer view, scoring breakdowns, player history, minutes scenarios, uncalibrated simulations, CSV export and validated plan-file import/export.
- Historical charts, source timestamps/hashes, compressed raw archives, pre-deadline snapshots, and prospective comparison of the component model, FPL Form and live ensemble on identical player rows.
- Capture refreshes live inputs through fresh TTL caches, freezes one dataset for all models, and records extraction ages, refetch/content-change flags and target-specific eligibility. A 30-minute freshness policy is acquisition evidence, not provider publication time or accuracy proof.
- Full-season future targets preserve deadlines, fixture membership, configuration hashes and provider/extrapolation labels. Lead-time evaluation selects the latest valid capture per target GW in six predeclared windows, shows pending coverage, scores matched player-GW rows, and separates primary from exploratory results. Changed deadlines are disclosed; captures after an earlier current deadline are excluded. Schedule changes stay in the error. Raw provider points remain missing beyond supplied weeks.

## Current UI and rules update

Solio's free optimiser was tested with entry 2200722 in the assigned Chrome profile; its official optimiser video was inspected. Open FPL now removes hero/slogan text and large planner cards, keeps a pitch visible in Optimise, defaults to five weeks, and uses a draft/Apply flow. Advanced objective controls, stress tests, source receipts and method text start collapsed. Analysis has Overview/Benchmarks/Sources tabs. [Observed flow and limitations](SOLIO_UX.md).

Optimisation starts at the selected GW and freezes the source branch. Validated earlier decisions determine holdings, profit-aware prices, bank, FTs and used chips; adopting a result preserves that prefix and ends at the solved horizon. Fresh future-start branches survive reload. The Solio comparison revealed and fixed an extra-FT bug across Wildcard/Free Hit in imports, validation and the solver; entry 2200722 now imports £0.2m and three FTs. The five-week provider window corrects our previous request cap, not a change in provider entitlement.

Analysis charts and totals now align branches by their actual shared gameweeks. Future-start, longer and sparse plans no longer shift points under another plan's GW labels or compare different-length totals. Disjoint horizons show no comparison.

## Verification

- **216 backend tests passed:** prior checks plus five-feed reference parsing/mapping, five-week FPL Form exports/missing headers, WC/FH transfer preservation, source refresh/frozen-dataset capture, deadline crossings, target-specific provider availability, sparse matched comparisons, lead-bin boundaries, latest selection, changed deadlines/schedules, malformed inputs, legacy/gzip compatibility and player-GW weighted metrics. The sole warning is a Starlette TestClient dependency deprecation.
- **22 frontend tests passed:** CSV edge cases and weekly schedules, provider export formats, duplicate GW rows, legal lineups, expected squad scoring, transient stress polling recovery and confirmed-404 handling, future-start branch restoration, and shared-GW comparisons across different starts, gaps and disjoint horizons.
- Production TypeScript/Vite build and Python undefined/unused-name checks passed.
- Current checks: desktop pitch and compact draft controls were inspected in a clear screenshot at 1280×800. Mobile planner, five-midfielder pitch and Analysis were checked at 390×844 without document overflow. A real five-GW solve was compared and adopted for entry 2200722; a GW8–12 solve retained GW6–7 and adopted from its frozen source even after switching the active branch during the solve. Source and original branches remain intact. The useful five-week and future-start plans are saved locally.
- Real API checks: prior checks plus both reference feeds and a scheduled zero-minute GW passing through provider plus sourced CSV layers. Every other 32 GW forecast record remains exactly equal to normal output, including minutes, components and provenance. An unknown scheduled player is rejected with HTTP 422.
- Browser checks: imports, transfers/rejections, captain/vice changes, chips, watchlists, minutes scenarios, optimiser review/application, fixtures, analysis, 33-week timeline, provider/extrapolation labels and wide CSV import using real FPL Form values. Test-only branches and CSV settings were removed.
- New browser checks: reference pagination/units/provenance, selected-GW minutes save/reset, completed 8/8 stress scenarios, independent server-validated branch adoption, restart/404 recovery and simulated one-request connection failure followed by successful polling recovery. Original plans remain preserved; test branches and minutes assumptions were removed.
- A 20-scenario, six-GW cancellation check stopped after 4 completed scenarios and displayed partial results with the correct denominator.
- Mobile DOM layout checked at 390×844: no document overflow, all five midfield tiles fit, timelines scroll internally and branch switching is available. Desktop layout also inspected.
- Reference tables also pass mobile DOM checks at 390×844: no document overflow; wide data tables scroll internally. The shared browser intermittently fails screenshots. The current optimiser's desktop capture is clear; detailed reference-table pixel QA remains incomplete.
- Warm full-season forecasts were measured at approximately **0.9 seconds** after response/copy improvements; initial data acquisition is slower and depends on upstream feeds.
- Desktop DOM checks confirmed all three attacking series, labelled GW selection, missing values, fresh-input receipts and six lead windows. Current mobile checks also cover Projections, Analysis and the compact reference view; page widths remain within the viewport. Screenshot capture remains intermittent, while navigation, interaction and DOM checks work.
- A restarted-server three-scenario native stress job completed 3/3 with no failures. An earlier Windows access-violation diagnostic motivates the one-thread HiGHS mitigation; the fresh full suite and live job ran without that diagnostic. Its underlying cause is not conclusively established.

## Historical evidence

The fixed 2025/26 holdout contains 7,720 player-fixture rows with **projected** minutes of at least 45. The ML challenger fits 2023/24–2024/25. Features update after an entire GW; no current provider forecasts are backfilled into history.

- Component model: MAE **2.289**, RMSE **3.076**.
- ML challenger: MAE **2.331**, RMSE **3.084**.
- Recent five-match form: MAE **2.575**, RMSE **3.358**.
- Appearance-adjusted PPG: MAE **2.310**, RMSE **3.156**.
- Component-minus-PPG MAE difference: −0.021; GW-cluster bootstrap 95% interval approximately [−0.043, −0.0002]. The improvement is small.
- Minutes MAE: **24.3 minutes**. Appearance quality is a major weakness and a reason to use external player forecasts and human updates.

These numbers evaluate the historical component model. They do **not** evaluate the default live blend or long-range extrapolation. No superiority over FPL Review, Solio or another paid provider has been demonstrated.

GW6 was captured before its official 2026-10-10 10:00 UTC deadline. The latest capture `2026-27_gw6_20261003T053201197777Z.json.gz` preserved 667 players for all 33 remaining GWs, with raw FPL Form points for GW6–10 and none for GW11 onward. All live-ensemble target receipts passed the declared freshness policy. Both scoring views correctly read the compressed archive and return no completed results; all 33 targets are pending, with no scanner diagnostics. The five-week capture is 1,444,655 gzip bytes. The previous three-week capture remains readable and is not relabelled. Older plain captures remain intact and readable. Snapshots and raw provider data stay local and ignored by Git.

## Next research priorities

1. Capture updates near deadlines and score completed weeks. Compare the live blend with its component and FPL Form inputs before changing weights or decay.
2. Obtain additional authorised point forecasts with explicit publication/extraction times and coverage. Review's free view/premium CSV gate and Elevenify's fixture-specific attacking views are now verified; no premium points dataset is claimed.
3. Improve automatic minutes, injury recovery and team-selection news. Human weekly scenarios now work, but scalar point anchoring cannot identify future minutes or attacking rates by itself.
4. Check uncertainty calibration, bonus/BPS reconstruction and correlated appearance/clean-sheet outcomes on a fresh holdout.
5. For public hosting, add accounts/sync and appropriate provider redistribution rights. This deliverable is a local personal tool.

The MILP's linear objective approximates bench/fallback effects; displayed totals use the fuller squad calculation. Candidate-pool optimality is distinct from accuracy. Future prices are fixed, ownership preference is heuristic, and no transfers are submitted to FPL.

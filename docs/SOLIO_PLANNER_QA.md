# Planner follow-up verification - 15 October 2026

This is a bounded functional pass, not a full Solio-parity closeout. The original eight-tutorial mission remains unfinished; [STATUS](STATUS.md) lists the remaining tools.

## Environment and preservation

Actual Chrome was connected through one retained session. The dedicated Ilmari profile was verified using `chrome://version` as `Profile 8`. Additional QA/research tabs inherited that verified profile. The T3 Default/Incognito profiles and the user's personal Chrome profile were not used in this pass. Local mutations used `http://localhost:8000/?qa=ilmari-workflows`, preserving the user's `127.0.0.1:8000` plans. No mock solver/validator responses were installed.

Ignored receipts: `data/exports/qa/ilmari-workflows-20261015/`. Each named JSON records the executed assertions, with corresponding PNGs for visual inspection.

## Verified behaviour

- `planner-checks.json`: direct swaps in both orders, legal goalkeepers, rejected GK/outfield pairs, same-player double-click deselection, Escape, blank pitch, separate Info, drag/drop, exact Undo and persistent left pitch alongside Projections.
- `projection-fixture-checks.json`: equivalent comma/pipe searches; GW8 editor alongside GW7 pitch; preserved horizontal table scroll and query; one-player/one-GW Save and Reset through the actual API; exclusion of an interior fixture week; total sorting; club multiselect.
- `quick-solve-checks.json`: a real left solve at GW9 changed the captain, preserved GW7-8, the original GW11 end, selected GW, Fixtures, headers and horizontal scroll. Undo restored the exact source. A second solve while switching branches updated only the frozen source and retained the newly selected branch.
- `solver-failure-check.json`: three required goalkeepers produced the real server error `Required players exceed the positional squad limits in GW9.` All saved plans and the right tab were retained. The test rules were removed and settings restored.
- `data-checks.json`: 667 players/20 clubs from the real season endpoint, four substring matches, independent graph axes alongside the table, per-90 labels, comparison/full names/Clear, saved column order through reload/deletion, all club results and explicit missing event-map data.
- `responsive-checks.json`: Data/Fixtures/Projections/Lineup at widths 390, 768 and 1280 without document overflow; actual phone swap/Undo and exact-GW inline editing. Desktop screenshots were also inspected at 1440 x 900.
- `fixture-trend-check.json`: all 20 selected-club trend SVGs and phone containment. Trends share the displayed clubs' scale, use the selected weeks, count double fixtures, and preserve unavailable observations as gaps. The final desktop row height is about 47px; phone fixture actions retain 44px minimum height.

The blank-pitch check initially failed. The pitch wrapper now clears selection only for its background, excluding player tiles/buttons; the complete substitution browser pass then passed.

## Checks and remaining limits

357 backend tests, 94 frontend tests and the production TypeScript/Vite build pass. Full coverage/source validation passes for 21,344/21,344 player-weeks: all 667 players and every GW7-38. These do not prove forecast accuracy, proprietary solver equivalence, calibrated risk/EO or full-season global optimality.

The new source-reference receipts directly confirm the ticker filters/sorts and current Data Pro gate. The reference's paid editing behaviour was not bypassed or purchased. No live candidate streaming is claimed for Open FPL's busy indicator. Immediate undoable quick-solve adoption follows the user's request; the official tutorial shows a separate acceptance step.

## Independent development-browser pass, completed 16 October 2026

This separate pass used the requested T3 preview Incognito profile and `http://localhost:5173`, not the Ilmari session described above. It ran from 15 October 16:38–16:43 UTC and resumed at 21:20–21:24 UTC (16 October locally). The original preview session had ended and port 5173 refused connections on resumption; `./start.ps1 -Development` restored the development server. All mutations used disposable local browser state. No app code or STATUS changes were made, and no native child agents or messaging were used. The live orchestration catalogue reported inherited provider `codex`, model `gpt-6.1-sol`; no further delegation was needed.

Ignored evidence: `data/exports/qa/solio-planner-20261015-r3/`. `first-pass-summary.json` records assertions and API outcomes returned by the first run's actual browser tools; it is explicitly a summary, because the browser instrumentation did not survive session termination. `resumed-results.json` retains the resumed assertions and genuine optimiser/validator requests and responses. Fetch observation forwarded requests unchanged; no API response was mocked.

Verified directly:

- Left Pitch coexists with right Projections and Fixtures. An expanded **QA Source GW8** card selected that source branch and GW8 while the previous active branch was its alternative; Projections and its query stayed selected.
- A real left quick solve from **GW9** requested horizon **3**, preserved GW7–8 exactly and the existing GW11 end, changed the suffix in the same branch ID, and kept Projections plus `a | saka`. Baseline validation, optimise and adopted-plan validation each returned 200. Undo restored the exact original saved plan.
- A second solve froze QA Source; the active branch changed to its alternative at **16:39:54.462 UTC**, while validation was still pending. The optimiser request began at **16:39:55.119 UTC**. Only QA Source changed, its prefix stayed equal, the alternative stayed byte-for-byte equal, and that alternative remained selected. This checks switching during an in-flight operation, not merely after a completed solve.
- Mbeumo's **GW15** cell opened GW15 controls below Projections while the left pitch and view stayed **GW7**. Query `a | saka` and table offsets **450px horizontal / 180px vertical** survived opening and closing. Comma and pipe versions of `Haaland, Saka` returned the same four substring matches.
- Shirt selection and same-shirt deselection operate without a dialog. Escape clears selection. Explicit Haaland Info beside Fixtures opened Haaland/GW8 while Fixtures remained selected. At **390 × 844**, the player sheet fitted **x=8–382, y=8–836**, and document width stayed 390.
- The resumed current layout again passed mobile shirt selection/Info. Haaland's **GW38** cell opened a fitted inline editor at **x=50–380**, independently of selected plan GW9. Closing retained `Haaland, Saka`, **2174.5px** horizontal table scroll and the exact saved plan.
- Real infeasibility: include **Leno, Pickford and Kelleher**, select GW9, retain right Fixtures, then press left Optimise. `/api/plan/validate` returned 200; `/api/optimise` returned **422**, `Required players exceed the positional squad limits in GW9.` Every saved plan stayed exactly equal and Fixtures stayed selected. Removing the three constraints restored the original solver settings exactly.

No new actionable bug was reproduced in these requested flows. Some automation attempts used an ambiguous player match or a horizon outside the remaining range; corrected selectors and the actual 30-GW remaining horizon succeeded. Those tool-input failures are not application bugs. The existing Ilmari pass above separately covers the core desktop/mobile swap matrix; this pass does not claim to have repeated that full matrix.

Screenshot capture times below are the saved files' UTC write timestamps, so concurrent CSS work can be correlated without treating an earlier image as the final layout:

- `desktop-20261015T1638.png`: **16:38:20.560 UTC**.
- `inline-20261015T163859.png`: **16:38:59.486 UTC**.
- `mobile-info-20261015T164257.png`: **16:42:57.328 UTC**.
- `mobile-lineup-20261015T212107.png`: **21:21:09.783 UTC**.
- `infeasible-20261015T212226.png`: **21:22:26.264 UTC**.
- `mobile-inline-20261015T212400.png`: **21:23:59.990 UTC**.

Material unverified cases in this pass: cancelling a long quick solve; editing/deleting its source or changing forecast assumptions while it runs; long-horizon/chip combinations; comprehensive keyboard/touch swap coverage; save/reset propagation from the latest inline editor. The three full suites and forecast coverage were not rerun by this documentation-only test worker; their independent results are recorded above. Source comparisons rely on [the captured live-tool evidence](SOLIO_LIVE_TOOLS.md) and [the eight-tutorial audit](SOLIO_TUTORIALS.md), not a fresh source-site connection. Team-strength/penalty modelling, schedule scenarios, event Maps and proprietary solver/forecast parity remain outside this pass and are not certified.

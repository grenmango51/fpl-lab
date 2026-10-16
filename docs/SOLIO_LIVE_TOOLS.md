# Solio live tools audit — 15 October 2026

This is a **partial signed-in audit**. The original pass directly inspected Projections Players, Teams, penalty tiers and fixture permutations. A later parent pass recovered Ilmari and exercised the separate Fixtures filters/sorts and the Data entry gate. Premium editing and the gated Data tools themselves remain unverified. Do not report all tutorial tools as live-verified.

## Recovered live checks at 17:10 UTC

A new research tab was opened from a dedicated Ilmari QA tab. Both paths were verified as Chrome `Profile 8`; the original Solio tab was retained. This pass changed only the research tab's view/filter/sort state, not squads, forecasts, subscriptions or account settings.

- Team filter: opened All Teams, selected None, then Arsenal; the button became **1 Team** and the ticker retained only Arsenal.
- Gameweek filter: keyboard-moved the start handle from 7 to 8 while leaving the end at 11. The individual-gameweek menu then exposed GW8-11; deselecting GW9 produced **GW8-11 (1 out)** and columns **GW8, GW10, GW11**. Defence showed Arsenal's 49%, 59%, 37% with **1.44 Total**, confirming an expected-count total rather than a percentage average. Displayed probabilities are rounded, so their printed sum need not match the more precise total exactly. The team and GW filters were reset afterward.
- The ticker includes a Trend sparkline. Clicking Team changed alphabetical ascending to descending. After horizontal scrolling, clicking Total sorted Attack with Man City **11.10** first and Arsenal **10.24** next. Clicking GW8 instead put Arsenal **2.05**, Man Utd **2.02**, Man City **1.98** first. Header coordinates came from the immediately inspected canvas screenshots; no inaccessible DOM click was claimed.
- The `/data` route currently shows **OPTA DATA IS A PRO FEATURE**, Upgrade to Pro and View Plans for season 2026/2027. No purchase or upgrade was attempted. This verifies the current entry gate, not today's paid Graph/Compare/Maps/custom-view implementation.

Receipts: ignored `data/exports/qa/ilmari-workflows-20261015/source-03-week-filter.png`, `source-06-week-selection.json`, `source-07-filtered-cs.png`, `source-08-data.png`, and `source-09-team-sort.png` through `source-12-week-sort.png`. Earlier connection errors below are historical; the direct Chrome connection recovered for this pass. Open FPL's independent official-FPL Data tools were browser-tested separately and do not require a local subscription gate.


**Earlier recovery attempt, 15 October at 16:32 UTC:** a new CUA session and one kernel reset both rediscovered Ilmari by profile name, but tab inventory again failed with the same request-header-policy error. No new live result or screenshot was obtained. The saved tutorial frames were re-inspected; the additional findings and exact recovery sequence are recorded below. Fixtures filters/sorts, current Opta gates and player row-name behaviour remain pending.

The prior T3 Default-profile sign-in block no longer describes access in this audit. The user explicitly authorised their connected Chrome **Ilmari** profile. `cua.getState()` discovered it by profile name and extension instance; browser numeric IDs were not assumed. Research used its own tab **547473856**, created at `https://fpl.solioanalytics.com/`. The original user tab **547473800** was not operated. The parent agent owns pitch, substitutions and left Optimise testing.

Read global/project AGENTS, MODEL_PROVIDERS, STATUS, [tutorial audit](SOLIO_TUTORIALS.md) and [interaction replay](SOLIO_INTERACTION_REPLAY.md). No delegation was performed. This document is the only tracked file owned by this research task. No application code, model assumptions, provider data or other documentation was changed.

## Directly clicked actions and results

Saved screenshots and DOM text are in ignored `data/exports/qa/solio-live-tools-20261015/`. `actions.json` records extraction times, URLs, actions and filenames. Saved receipts span **11:31:54–11:33:15 UTC**. The following is the actual action sequence, rather than a proposed replay.

1. **Opened own Solio tab → Projections → Players.** The signed-in planner rendered an expanded pitch on the left and the projections workspace on the right. Table columns were Name, Team, Price, Avg and GW7–11. Base Scenario, Points metric, Search and Filter players were visible. The scenario/metric menus and player filter were not opened. Evidence: `01-players-baseline.jpg`.
2. **Filled Search with `Haaland, Saka`.** Once results rendered, rows were Haaland, Saka, Wan-Bissaka and Sakamoto. This is OR matching over substrings, not an exact shortlist of two players. The early `02-comma-search.jpg` precedes settled results; use `03-comma-results.jpg` as the result receipt.
3. **Replaced Search with `Haaland|Saka`.** The same four rows remained. Both comma and vertical bar separate alternatives. Case/accent handling, empty tokens and semicolons were not tested. Evidence: `04-pipe-results.jpg` and the returned accessibility state.
4. **Attempted AX click on Haaland GW8 cell.** The canvas cell exposed data but its AX click failed with `Node does not have a layout object`. No editor opened from that attempt. A fresh screenshot located the cell; a normal click at viewport **(1257, 195)** then selected it.
5. **Clicked Haaland GW8 Points cell.** The GW8 cell became orange; an editor opened **below the table inside the right workspace**, without covering/replacing the left pitch. It showed **Aston Villa (A)** while the left pitch still showed GW7. Thus the editor followed the clicked projection cell's week, independently of the pitch week. Close player details and `Upgrade to edit now!` were visible. Evidence: `05-haaland-gw8-editor.jpg`.
6. **Clicked Next slide in that editor.** The navigation affordance changed to Previous slide. The accessibility tree exposed Minutes 86, Bonus 0.96, DefCon 0% and Penalties 0.13 alongside the per-90 fields. The immediate screenshot captures carousel transition clipping; it does not prove final resting placement of every summary. No slider/handle was moved. Evidence: `06-editor-next-slide.jpg` and `.txt`.
7. **Clicked Penalties 0.13.** This navigated the right workspace to **Projections → Teams → Man City**, URL containing `team=15&projectionsTab=teams`. It showed penalty-taker ranking, Add penalty taker, tiers 1/2/3, New Tier and Remove targets, and a separate **GW7–11 Penalty Taker (Minutes-Adjusted)** chart. `Upgrade to edit penalty shares now!` was visible. No tier, share or player was changed. Evidence: `07-penalty-ranking.jpg`.
8. **Clicked Back to all teams.** The right panel showed a labelled team-strength scatter: **Better Defence to the right**, **Better Attack upward**. A team Search, `Upgrade to edit team strengths now!`, Projected Points ranking and From Current Standings / From Clean Slate tabs were visible. No drag or standings-tab change was made. Evidence: `08-team-strengths.jpg`.
9. **Single-clicked the MCI scatter point.** A contextual **View Man City** button appeared with **2.08 / game** and **1.08 conceded**. Undo team strength change was disabled. This was selection, not a strength edit. Evidence: `09-team-selection.jpg`.
10. **Clicked the Fixtures subtab under Projections.** This opened the fixture permutation workspace: columns **Unset, 7, 8, 9, 10, 11**, club-pair blocks exposed as draggable, a checked **Show all fixtures**, and `Upgrade to edit the fixture schedule now!`. No block was dragged or fixture rescheduled. Evidence: `10-fixture-permutations.jpg`.
11. **Unchecked Show all fixtures.** Fixture blocks disappeared while the columns remained. This verifies the display filter in this state; its exact rule for which exceptional/permuted fixtures remain is unproven. Evidence: `11-fixture-permutations-filtered.jpg`. The checkbox was then checked again before leaving the subview.
12. **Clicked the separate top-level right Fixtures tab.** URL changed to `?tab=fixtures&projectionsTab=fixtures`. Accessibility exposed **Filter by team**, **Filter by gameweek**, and the metric tabs **Attack (G)**, **Defence (CS)**, **Overall (GD)**, with Attack selected. The ticker canvas was present. This final step returned UI text but was interrupted before a screenshot/menu/sort capture could be saved.

Other branches/totals changed in the background during concurrent parent work. This research never clicked Create, Copy, Delete, a pitch shirt, a chip, a solve, a forecast slider, an upgrade button or account controls. Background changes must not be attributed to the search/display-filter actions above. No browser storage, cookies, authentication data or raw network payloads were read.

## Player editor: verified units, placement and limits

The live editor labels are **NP Goals p90**, **Assists p90**, and **DefCons p90**. In the selected Haaland/GW8 receipt, the displayed values were **0.58**, **0.21** and **3.3**. These are not fields labelled unconditional GW xG/xA or direct expected points. Internal slider values exposed by accessibility did not equal every displayed rate; they are not a documented model transformation and should not be copied as one.

The minutes graphic showed three handles/labels: **>0 mins 100%**, **>67 mins 100%**, **90 mins 66%**. This is a distribution/survival-style input, rather than one plain expected-minutes number. The numeric threshold is observed for this player/week; do not hard-code 67 as a universal threshold. Minutes 86 is separately exposed as a summary.

The editor, its minutes handles and stat sliders remained visible under the explicit upgrade banner. Reset projection controls were disabled in this unedited state. No edit was attempted, so this audit establishes a visible entitlement gate and available preview, not whether a particular slider would reject, prompt, or silently block a change. No Save/Apply success, propagation, reset execution or paid entitlement was tested.

The selected-GW cell scope is live-verified. **Apply to Future**, goal/assist team-share mode, player Reset versus global Reset Projections, and teammate/opponent propagation come from tutorials 03/07 as recorded in SOLIO_TUTORIALS; they were not exposed/executed in this live pass. Retain that evidence distinction.

## Team strengths and penalties: separate tools

The all-team scatter is a strength input workspace with a Projected Points ranking. It is not a team/GW clean-sheet heatmap. Selection exposes a team drilldown and scoring/conceding summaries. Strength editing itself is upgrade-labelled; no numerical effect was tested.

The team drilldown separates **designated-taker tiers** from **minutes-adjusted penalty shares over the selected horizon**. For example, the live ranking displayed Haaland 95% in tier 1, Enzo/Ndiaye/Semenyo 30% in tier 2, and Foden/Doku/Anderson 20% in tier 3. The separate adjusted chart displayed Haaland 91%, Enzo 4%, Semenyo 4%, Ndiaye 1%, others rounded to 0%. These are display examples, not a recovered penalty algorithm. Do not collapse the two concepts into one ownership/probability field.

The add/tier/remove controls are visible previews. Their selectors and all mutations remain untested; the upgrade banner is explicit. Tutorial 07 demonstrates moving tiers, adjusting shares and adding takers, with downstream forecast changes. Reproducing that requires real team/taker/minutes inputs and an independently documented local model.

## Separate right Fixtures ticker: observed versus still pending

**Live observed:** it is a top-level tab distinct from Projections → Fixtures, with its own team/GW filters and three metrics. Attack was the default selection in this visit. The permutation workspace has a Show all fixtures checkbox and draggable club-pair blocks; the ticker has analytical filters. They must not be implemented as one interchangeable view.

**Tutorial 05 evidence, not re-executed live:** Attack (G) is expected goals, Defence (CS) clean-sheet percentages, Overall (GD) goal difference. Clicking a GW heading ranks that week; clicking Total ranks the selected horizon. Teams and Gameweeks menus filter the ticker; Gameweeks has a range slider, Select GWs and Reset, allowing non-contiguous weeks such as excluding a Free Hit. Filtering does not reschedule matches. See the linked tutorial audit and its saved frames at 1:18, 1:39 and 1:50.

**Pending live clicks:** open Filter by team; inspect/select/reset a team; open Filter by gameweek; inspect range and explicit GW options; exclude one interior week; choose Defence and Overall; click a GW heading twice and Total; read first/last row order and units; verify totals use only selected weeks; return to Attack and reset filters. No claims about sort direction, totals arithmetic or cross-tab filter persistence should be added until those actions have results.

## Data: tutorial inventory and current gate unknown

The live left rail exposes **Opta Data** (`/data`) and **Market Data** (`/market`). Neither destination was opened by this research before the browser failure. Current Opta access, season availability, free/paid boundaries, downloadable data and the behaviour of each Data control are **unverified**, not evidence of absence or an account gate.

Tutorial 08 already provides the functional inventory required by the user's request to copy all tutorial tools:

- A separate historical **Season Stats** workspace with **Players/Teams**, season context, comma/vertical-bar search, position/team/minimum-minutes filters, and a **Per 90** toggle.
- **All/FPL/Attacking/Defending/Goalkeeping** column groups and a sortable table.
- **Graph** with independent X and Y metric selectors alongside the table.
- **Compare** with plus/check selection, side-by-side metrics, full-name toggle and Clear.
- **Maps** with Touches/Passes/Shots; defensive-touch filters; completed/incomplete pass distinction; goal/save/block/miss/post shot symbols; recorded trajectories/keeper context. Continuous shot animation and exact event semantics remain unproven.
- **New/saved views**, named custom views, column reorder/remove/add controls. Saving/deleting a view was outside this read-only live task.

This is historical event data, not forecast editing or prospective evaluation. A locally sourced history table alone does not reproduce the graph, comparison, maps or custom-view tools. Event coordinates/trajectories/keeper positions need real available data; do not manufacture them or label public FPL summaries Opta. When unavailable, expose the specific data limitation and retain an honest partial tool.

## Concrete implementation requirements

These are functional requirements for Open FPL, not instructions to purchase Solio access or copy its proprietary forecasts. The live gates are reference access limits, **not reasons to gate the local personal implementation**.

1. **Search equivalence:** split player queries on comma or vertical bar, trim tokens and OR substring matches. Add a concise placeholder/example. Verify the four-row `Haaland, Saka` case and the equivalent pipe query; preserve existing team/position filters.
2. **Contextual projection editing:** a selected row/cell opens a bottom editor in the projections pane, independently of left pitch state. A GW cell targets that exact GW; retain scenario, metric, query, filters and table scroll. Provide an explicit close control. Row-name default week still needs a live result.
3. **Honest forecast inputs:** retain unconditional local GW inputs under their own units until a per-90/distribution model is designed and validated. Matching slider labels without corresponding semantics is a factual mismatch. If adding survival minutes, team goal/assist shares or penalty tiers, read PLAN/MODEL first and document scope, conservation/normalisation, multi-fixture behaviour and recomputation. Add selected-GW/Apply to Future and individual/global reset as distinct actions.
4. **Team tool coverage:** implement a strength-scatter drilldown and tiered/minutes-adjusted penalty view if claiming tutorial tool coverage. Existing team projection tables and independent player edits are not equivalent. Provide keyboard/numeric alternatives to drag and keep observed versus manual values/provenance separate.
5. **Schedule scenarios:** separate fixture permutation inputs from ticker filters. A scenario move must preserve fixture identity and both participating clubs, recompute blank/double player/team weeks and downstream plan scores, expose move/reset state, and leave official sourced schedule unchanged. This is a required independent model feature, not a cosmetic rearrangement of the ticker.
6. **Ticker completeness:** independent team selection and arbitrary GW selection/range/reset; G/CS/GD units; GW and selected-horizon Total sorting; totals and row order reflecting the selected weeks. Test excluding an interior week, not only a contiguous horizon.
7. **Data tools:** track Players/Teams + filters/per-90, column groups, sortable table, independent-axis Graph, Compare, event Maps and saved/custom column views separately. State unavailable datasets precisely. Do not mark all eight tutorial areas delivered because a general table or market chart exists.
8. **Scope and reversibility:** forecast edits, schedule permutations and saved-data mutations need explicit local scenario scope, undo/reset and server validation. Searching/selecting/filtering should not alter saved teams. No solve should be needed just to inspect these tools.

Cosmetic details are secondary to cell-week targeting, units, multi-search semantics, penalty modelling, schedule scenarios, ticker selection/sorting and actual Data-tool availability. This audit does not certify present Open FPL parity; concurrent source changes were intentionally not reviewed under this file-only ownership.

## Browser interruption and next research steps

After a user continuation, the CUA JavaScript runtime had reset (`auditTab is not defined`). Fresh inventory found the Ilmari extension but failed to enumerate tabs with **`Unable to load browser request-header policy. Retry the browser command.`** A lightweight retry and one kernel reset/reinitialisation returned the same error. No further browser input was attempted, and no alternate profile, sign-in, policy bypass or lower-level browser transport was used. This is an automation connection failure, not a Solio login/subscription result. The original tab was never touched.

Resume with fresh `cua.getState()` and identify **Ilmari** by profile/extension instance, never an old browser numeric ID (it changed during recovery). Rebind only the research-owned tab if it still exists; otherwise create a new own Solio tab. Finish right Fixtures menus/metrics/sorts, then open Opta Data and inventory each available/gated tool. Also inspect player metric/filter menus, row-name versus GW-cell selection, and any visible scope control without moving input values. Save new numbered receipts alongside the existing evidence and replace the specific pending claims above only when verified.

No application checks were run: this task produced documentation and ignored browser receipts only. Production checks, forecast coverage and application acceptance remain the implementation owner's responsibility. Only this document was edited; STATUS was left to its owner.

## Recovery follow-up: bounded retry and saved-frame inspection

The follow-up read global/project AGENTS, MODEL_PROVIDERS, STATUS, this audit, the tutorial audit, interaction replay, and the computer-use skill/guidance/confirmation policy. It changed only this document and new ignored evidence under `data/exports/qa/solio-tools-retry-20261015/`. No delegation was performed. Any future child must use T3 `delegate_task` with the same provider/model from `orchestrator_capabilities`, carry that restriction in its brief, and preserve the existing file ownership boundaries; native agents/messaging are not authorised for this task.

Actual browser actions:

1. A fresh `cua.getState()` returned the Chrome profile name **Ilmari** and its extension instance, but could not enumerate its tabs: **`Unable to load browser request-header policy. Retry the browser command.`** Empty `tabs` in this failed inventory does not mean the user's tabs were closed.
2. `cua.getBrowser` selected the extension instance discovered for Ilmari and returned its browser documentation. This metadata selection succeeded; it did not establish working page access.
3. A sequence requesting session naming followed by creation of a new tab at `https://fpl.solioanalytics.com/` returned the same policy error. No Tab handle, page state or screenshot was returned. The failed sequence did not expose which operation failed; successful tab creation is not claimed.
4. One CUA kernel reset followed by exactly one fresh `cua.getState()` rediscovered Ilmari and returned the same tab-inventory error. The temporary numeric browser IDs had swapped between inventories, reinforcing the requirement to select by profile/extension identity. Recovery stopped here.

There was no `getTab`, `claimTab`, navigation, click, drag, typing or storage/network inspection against the original user tab **547473800**. Source branch **A** was not operated. The parent's reported disposable branch **B** was not inspected or cleaned up; its current existence and cleanup remain the parent's responsibility. No alternate personal profile, lower-level transport, policy bypass, purchase or account edit was used. The errors establish an automation connection blocker, not a Solio sign-in, subscription or feature result. No new application-browser pass was attempted in this file-only research task.

`connection.json` records the calls/results without the unrelated verbose telemetry payload. `frame-review.json` identifies the eight existing frames inspected in this follow-up; these are earlier tutorial captures, not new live screenshots or actions performed by this researcher. The separate existing `solio-live-tools-r2-20261015` receipts were read as inherited artifacts only; this follow-up neither executed their scripts nor treats them as a newly replayed interaction.

### Additional tutorial-frame findings, not live verification

- **Fixtures 05, 1:39 (`05-99.png`):** Defence (CS) is selected; weekly cells show percentages and the selected **Total** column shows decimal totals (for example Arsenal 2.07). Do not append a percent sign to this horizon total merely because its weekly cells are percentages. This frame does not establish the total formula, blank/double-week handling, or sort toggle direction.
- **Fixtures 05, 1:50 (`05-110.png`):** the open Gameweeks popover visibly contains **Reset**, **Gameweek range: 1 to 5**, two range handles and **Select GWs**. The latter control is not expanded in this frame. The narration describes removing a Free Hit week, but the explicit multiselect layout, checked values and recomputed total are not verified by this still.
- **Data 08, 0:40 (`08-40.png`):** the open Filter popover has **All positions**, **All teams** and a **Min minutes** slider showing 900. The Players workspace and **2025/2026** season are visible. This is recorded season context, not evidence that today's workspace offers 2026/27 or a season selector.
- **Data 08, 0:57 (`08-57.png`):** **Defending** changes the table column group while **Graph** remains beside it; X is **Minutes**, Y is **Defensive Contribution**. This directly supports independent graph axes rather than one metric selector reused for both axes.
- **Data 08, 1:13 (`08-73.png`):** **Compare** shows **2 selected**, Leno and Verbruggen in adjacent columns, individual remove controls, **Full stat names**, **Clear**, and plus/check row controls. With **Per 90** visibly active, App/Starts remain 38 and Min remains 3420 beside fractional defensive rates. A local implementation must define which metrics are rates instead of dividing every numeric column by minutes. Selection limits and toggle behaviour still need interaction evidence.
- **Data 08, 1:34 (`08-94.png`):** **Maps → Passes**, Anderson selected, **2583 passes**, and separate completed/incomplete colours are visible. The right table remains available for selecting a different player. This requires event-level coordinates; public FPL summary history cannot supply these plotted paths.
- **Data 08, 1:55 (`08-115.png`):** **Maps → Shots** shows Anderson, **44 shots**, plotted trajectories and a legend distinguishing goal, saved, blocked, miss and post. A still does not prove continuous hover animation or the exact keeper-position event schema.
- **Data 08, 2:12 (`08-132.png`):** **My view** and its editor are visible, with a name field, **Shown**, **Clear**, drag handles and per-column remove controls; additional FPL fields include FPL Pts, Bonus and BPS. The map says to select a player. This supports separately managed custom column views, but does not prove save persistence across reloads or a paid/free boundary.

The live pending list above remains unchanged. Resume only after normal Ilmari tab access works: create an own tab, inspect/reset the ticker filters and sort results, inventory Opta destinations/gates, then compare row-name and exact-GW cell selection. Do not borrow the original tab to finish these checks or report the tutorial stills as current signed-in interaction results.

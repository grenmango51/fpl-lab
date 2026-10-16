# Solio tutorial audit

Audited **2026-10-15**, for the pitch-click and left Optimise follow-up. Receipt inventory verified at **11:29:31 UTC**. Research only; no application, forecast, subscription or account changes.

## Findings to implement first

- **Left Optimise runs the selected decision's solver in place.** In tutorial 06, the right panel remains **Fixtures** while the orange button over the selected GW starts a solve, shows its candidate on the tree, and offers acceptance. Selecting **Lineup** afterward reveals the adopted team. Routing that button to right-side settings misses the demonstrated workflow. [06, 1:18–1:39](https://www.youtube.com/watch?v=x7wbyB7Lu7c&t=78s).
- **Keep pitch manipulation separate from opening detailed information.** Tutorial 01 demonstrates dragging a bench shirt onto a starter; clicking a shirt opens C/VC/Lock/Ban and Transfer/Edit actions. It does contain a player popover, so it is **not evidence that Solio never opens one**. The user's request to avoid an obstructing default popup should govern Open FPL: select/highlight the player in place, expose compact actions, and make detailed information an explicit action. Drag completion must not also fire the click-to-open handler. [01, 0:29–0:43](https://www.youtube.com/watch?v=EtL1kwUbq04&t=29s).
- **Preserve both workspaces.** The footage shows an expanded pitch on the left while Analysis, Projections, Optimise or Fixtures remains usable on the right; it also shows the compact decision tree with Lineup on the right. Selecting a GW, expanding its pitch, choosing a player and choosing a right tab are separate pieces of state. [01, 0:27](https://www.youtube.com/watch?v=EtL1kwUbq04&t=27s), [06, 1:39](https://www.youtube.com/watch?v=x7wbyB7Lu7c&t=99s).

### Acceptance checklist for the implementation owner

- [ ] Left Optimise freezes the selected branch/GW/settings, starts the solve immediately, and retains the existing right tab and tree/pitch context. Show progress and a stop action; prevent duplicate submissions.
- [ ] Candidate previews are visibly provisional. Offer Accept/Apply and Reject locally; adoption validates and updates the intended plan. A later branch selection must not redirect the result to another branch.
- [ ] A normal pitch click can select without covering the XI. Provide explicit C, VC, lock, ban, transfer and info controls. Support legal drag substitutions and a keyboard/click alternative; the latter is an Open FPL design recommendation, not a demonstrated Solio click-then-click gesture.
- [ ] An expanded GW pitch stays associated with that decision and can collapse back to its card. Right-side navigation and projection editors do not unexpectedly replace it.
- [ ] Make lock/ban scope explicit: selected GW versus this GW onward. Keep chip generation, solving generated plans, previewing a result and adopting it distinct.
- [ ] Preserve search, filters, metric, selected GW and scenario through contextual actions. Place projection editors below their table; distinguish one-player reset from all-projection reset and selected-GW edits from Apply to future.
- [ ] Label local objective, uncertainty, ownership and stat-edit units honestly. Solio's risk/disruption distributions, goal-share propagation and penalty model cannot be inferred from similar controls.

## Evidence and completeness

**V** = directly inspected recorded video frames or short playback; **T** = full English auto-caption transcript read, paraphrased here; **D** = video description/metadata; **W** = official website text; **R** = implementation recommendation; **U** = unverified.

All **eight accessible playlist entries** had readable descriptions and full English auto-captions. Actual frames were inspected in every video, with **80 saved video screenshots**, including a short playback of tutorial 06 at 1:17–1:33. This is a transcript-plus-key-frame audit, **not continuous end-to-end viewing of every video**. No listed video was unavailable.

The supplied playlist ID is valid as given: [Getting started with Solio: FPL tool tutorial series](https://www.youtube.com/playlist?list=PLIoI27k8Vvkg). Both that page and the [official channel's Playlists page](https://www.youtube.com/@SolioAnalytics/playlists) report **8 videos**. The channel links back to the same ID; no longer replacement ID was needed. Older third-party references to six tutorials omit 07 and 08. Other channel playlists are season discussions/evergreen content, not additional entries in this tutorial playlist.

Ignored receipts: `data/exports/qa/solio-tutorials-20261015/`. Files `01-receipt.json` through `08-receipt.json` retain public metadata/descriptions and transcript segments; `playlist-receipt.json` and `channel-receipt.json` record discovery. Screenshot names `NN-seconds.png` identify video/time; `06-play-0.png` through `06-play-5.png` capture approximately 1:19, 1:22, 1:25, 1:27, 1:30 and 1:33. Finnish transcript timestamps such as `1.18` mean **1:18**, not decimal seconds. No signed caption URLs, cookies, account tokens or credentials were retained.

## Complete playlist inventory and interaction audit

The durations below are the playlist's displayed durations; player metadata can round a second differently. Titles and publication dates come from the video's public metadata.

### 01 — Login & Navigation — 1:35 — 2026-07-30

[Video](https://www.youtube.com/watch?v=EtL1kwUbq04). **D:** login, team management and navigation.

- **T, 0:08–0:22:** find a team using FPL ID, manager name or team name, then Google verification. This research did not log in.
- **V+T, 0:27–0:34:** left expanded pitch coexists with right Projections. Drag **McBurnie from bench onto Calvert-Lewin**; McBurnie enters the XI and Calvert-Lewin moves to the bench. The displayed mean changes.
- **V+T, 0:35–0:43:** click B. Fernandes → an adjacent Transfer/Edit popover with C, VC, Lock, Ban and Undo appears → choose C. Click Szoboszlai → choose VC. Selected shirt has corner brackets; captain/vice markers update.
- **V, 0:37–0:41:** transfer shortlist includes player, team, price, GW value, a truncated horizon-difference heading and per-week difference bars. Replacement purchase/confirmation is **not** demonstrated.
- **V+T, 0:44–0:47:** chip dropdown above pitch → TC; the shown menu contains None, BB and TC. Do not infer the full chip menu from this one state.
- **V+T, 0:49–1:14:** bottom-left gear → Settings or Start Tour. Settings shows Light/Dark/System and sidebar position; tour is an overlay. Subscription is shown only in the recording.

Saved V times: 0:27, 0:30, 0:34, 0:37, 0:41, 0:46, 0:53, 1:02, 1:10.

### 02 — Analysis tab — 1:38 — 2026-07-30

[Video](https://www.youtube.com/watch?v=lriR_ZPYjQ0). **D:** use the analysis tab.

- **V+T, 0:17–0:45:** right Analysis leaves the left pitch visible. Summary groups **Swing, Health, Robustness**; controls switch Horizon/Gameweek. Sticky category summaries remain while the report scrolls.
- **V+T, 0:48–1:01:** Key Bets splits players and clubs into betting for/against the field, with projected EO comparisons and points swings. Visible actions include Reduce/Increase Swing, Lock Haaland In and Force João Pedro In. Their downstream solver effects are **U**.
- **V+T, 1:02–1:07:** Weak Spots lists a starter, a similarly priced/cheaper alternative and expected improvement; Transfer Contribution compares planned transfers with doing nothing.
- **V+T, 1:08–1:16:** robustness shows worst GW, lowest bank buffer, minimum FT, a resilience timeline, problem periods and autosub chance by GW.
- **V+T, 1:16–1:23:** Points DNA breaks down goals, assists, clean sheets, bonus, saves, defensive contributions and appearances, with Total/Per GW. Fixture Distribution uses a strength matrix, You/Field/Delta, Points/Count, Edit Strengths and team-level breakdown controls.

Saved V times: 0:22, 0:39, 0:58, 1:05, 1:15, 1:21. These are **Analysis** views in this footage, not proof of a dedicated Solio tab named Plans.

### 03 — Projections tab — 1:59 — 2026-07-30

[Video](https://www.youtube.com/watch?v=tudLAxLeJfo). **D:** use the projections tab.

- **V+T, 0:17–0:38:** right Projections → Players/Teams/Fixtures and scenario selector. Players is a sortable GW heatmap with price and average; metric choices include points, EO, price and minutes.
- **V+T, 0:41–1:03:** type player names, separated by comma or vertical bar for multiple matches → click a player row → editor opens **below the table** → drag sliders → projections change immediately. Wirtz and Gakpo are shown together.
- **T, 1:05–1:09:** goal/assist inputs can use baseline rates or team shares; detailed controls appear in 07.
- **V+T, 1:09–1:20:** Teams → draggable strength scatter, attack vertically and better defence horizontally; the ranked team projections change. Team selection exposes a View Team button.
- **V+T, 1:21–1:32:** select Manchester City → View Man City → penalty ranking and minutes-adjusted penalty shares.
- **V+T, 1:35–1:44:** Fixtures → drag fixture blocks between GW columns → edit count and Reset Permutations appear. This is an editable schedule scenario, distinct from the read-only fixture ticker.

Saved V times: 0:20, 0:42, 1:00, 1:20, 1:27, 1:36, 1:42.

### 04 — Optimise tab — 1:33 — 2026-07-30

[Video](https://www.youtube.com/watch?v=0ywv0p6itmU). **D:** use the optimise tab.

- **V+T, 0:17–0:34:** right Optimise → **Setup/Results**. Presets: Default, High Risk, Low Risk, Optimistic, Safe, Custom. Details has Risk Preference and Disruption Probability, each with Apply to future decisions.
- **V+T, 0:35–0:46:** select chip types → Auto Generate → progress/Stop → five candidate schedules. Chip generation is separate from the bottom **Optimise 5 Plans** action.
- **V, 0:51–0:59:** Constraints → Locked Players/Add or Banned Players/Add → searchable picker; **GW1** and **GW1 Onwards** each have lock and ban controls. A B. Fernandes future lock is visible in the resulting settings. Transfer Tree/Split diff and Alternatives controls appear; their full semantics are **U**.
- **V+T, 0:59–1:05:** click bottom Optimise → Results shows multiple running rows, progress and Stop, while left pitch previews a candidate.
- **V, 1:05–1:19:** Table → Distribution → Scatter; Absolute/Relative and All/This Decision controls. Select candidate → detail includes settings, chips, distribution, solution transfers, Reject, Apply, Alt and Copy.
- **V+T, 1:19–1:22:** Apply → success toast; run detail clears. Do not treat candidate pitch preview before Apply as adoption.

Saved V times: 0:22, 0:33, 0:46, 0:51, 0:54, 0:59, 1:01, 1:05, 1:08, 1:10, 1:12, 1:16, 1:19, 1:22.

### 05 — Fixtures tab — 2:08 — 2026-08-01

[Video](https://www.youtube.com/watch?v=39OHIqreC2w). **D:** use the fixtures tab.

- **V+T, 0:16–0:39:** right Fixtures is a team/GW ticker; Attack (G) shows expected goals, Defence (CS) shows clean-sheet percentages, Overall (GD) represents goal difference. Opponents and venue appear in cells.
- **T, 0:25–1:09:** narrator claims 15-minute sharp-market updates, direct market lines for the next one/two matches, then a market-based strength model cascading into player projections. These are provider claims, **not a measured refresh/accuracy audit**.
- **V+T, 1:12–1:38:** choose Defence → click GW heading to rank that GW → click Total for the selected horizon.
- **V+T, 1:39–1:51:** Teams and Gameweeks dropdowns filter the table; Gameweeks includes range slider, Select GWs and Reset. Narration suggests omitting a planned Free Hit week when evaluating longer-term fixtures. Filtering analysis is not rescheduling fixtures.

Saved V times: 0:22, 0:42, 1:00, 1:18, 1:39, 1:50.

### 06 — Decision Tree — 2:38 — 2026-08-01

[Video](https://www.youtube.com/watch?v=x7wbyB7Lu7c). **D:** navigate the decision tree.

- **V+T, 1:01–1:17:** bottom-left Create adds a branch; Copy duplicates selected transfers, chips and optimisation settings. Existing branches stay visible. Delete is visible but its confirmation/recovery is **U**.
- **V+T, 1:18–1:33:** selected decision's orange Optimise starts the solver **without switching right Fixtures**. A temporary candidate/control appears above the selected card; accepting populates subsequent GW cards and the terminal distribution. Short playback confirmed this sequence.
- **V, 1:39:** right Lineup shows the resulting squad; the selected tree card still identifies the decision.
- **V+T, 1:37–1:45:** top-right of the **tree** → horizon dropdown/slider → more GW cards. At 19 GWs a warning says horizons beyond 12 GWs reduce reliability/solve performance; this is Solio's warning, not an Open FPL limit.
- **V+T, 1:48–2:10:** root pen → right base-team editor, with FT/bank/player prices described by narration. Filmed slots are empty; clicking a slot opens a player search/Remove control and changes ITB in the example.
- **T, 2:11–2:22:** orange Base Scenario node represents information; GW box represents a decision. Preserve this distinction when implementing branches.

Saved V times: 1:04, 1:10, 1:21, 1:26, 1:31, 1:39, 1:44, 1:54, 2:02, 2:13, plus six playback frames.

### 07 — Your Own Beliefs — 4:12 — 2026-08-01

[Video](https://www.youtube.com/watch?v=WWdXxqe1Az0). **D:** supply personal assumptions.

- **V+T, 0:43–1:20:** Projections → player → bottom minutes editor. Three handles represent no appearance, not starting, and early substitution; selected-GW fixture and Apply to Future are visible. Filter a team → Minutes → inspect Total; narrator stresses coherent team minutes.
- **V+T, 1:28–2:10:** select Goals/non-penalty goals → increase Haaland share → player/team projections and decision totals change. Narrator says teammate shares reduce; assists work similarly. Player Reset and global Reset Projections have distinct scopes.
- **V+T, 2:12–2:38:** drag team strength vertically/horizontally. Narrator says changes affect teammates and opponents; suggests small adjustments. This is not the independent per-GW stat editing used by Open FPL.
- **V+T, 2:39–3:22:** double-click team → penalty tiers → adjust a player's share within tier, drag players between tiers, or plus → player list. Minutes-adjusted shares below differ from designated-taker ranking; both update in the demo.
- **V+T, 3:27–3:45:** Fixtures → drag fixture into another GW → blank/double scenario, Reset Permutations, changed decision scores.
- **T only, 3:45–3:58:** uncertain fixtures should show simulated move probabilities on hover; confirmed moves update automatically. No legible probability tooltip was captured.

Saved V times: 0:22, 0:39, 0:55, 1:14, 1:31, 1:44, 1:58, 2:08, 2:22, 2:46, 3:11, 3:19, 3:24, 3:36, 3:52.

### 08 — Data section — 2:34 — 2026-08-01

[Video](https://www.youtube.com/watch?v=lMvFm23JonA). **D:** navigate the data section.

- **V+T, 0:09–0:41:** left-rail Data opens a separate Opta Season Stats workspace, here 2025/26; Players/Teams, name search with comma/vertical-bar multi-search, position/team/minimum-minutes filter and Per 90 toggle.
- **V+T, 0:45–1:07:** All/FPL/Attacking/Defending/Goalkeeping choose columns. Left **Graph** has independently selectable X/Y metrics; right sortable table remains visible.
- **V+T, 1:10–1:15:** Compare → select table players using plus/check controls → side-by-side metrics, full-name toggle and Clear.
- **V+T, 1:16–1:42:** Maps → select player → Touches/Passes/Shots. Touch filters cover defensive actions; passes distinguish completed/incomplete; shot symbols distinguish goal/save/block/miss/post. Narration describes hover animation with keeper positioning.
- **V, 1:55:** a selected shot and plotted trajectories are visible; continuous shot animation was not independently verified.
- **V+T, 1:54–2:10:** click stat header to sort → New/saved-view menu → name custom view, reorder/remove columns and choose additional columns.

Saved V times: 0:22, 0:40, 0:57, 1:13, 1:34, 1:55, 2:12. This is historical event data, not player forecast editing.

## Known gaps and interpretation limits

- **Live access:** the audit's own T3 tab reached the current planner's Google sign-in/terms gate; `live-login-gate.png` records it. No login, terms acceptance, subscription change or paid action occurred. Earlier signed-in observations in [SOLIO_REBUILD.md](SOLIO_REBUILD.md) are prior evidence, not a fresh signed-in verification by this audit.
- **Premium behaviour:** recorded editors/chip search are visible demonstrations, not proof they are available to a free account today. Access entitlements and exact premium solver behaviour remain untested.
- **Rules:** these eight transcripts do not demonstrate entering or executing natural-language rules. Lock/ban scope is directly visible in 04; general “solver follows your assumptions” narration in 07 does not establish sentence grammar, rule conflict handling or enforcement.
- **Transfer details:** shortlist and solution transfers are visible; manual replacement confirmation, affordability rejection, selling-price accounting, hits, FT carryover, chip conflicts, undo and invalid formations are not comprehensively demonstrated. Follow the existing server-validation contract, not guesses from the videos.
- **Popup geometry:** footage contains editorial zooms. It proves actions and coexistence of views, not exact pixel placement, responsive breakpoints, focus behaviour, dismissal rules or collision avoidance. The requested non-obstructing selection flow is an intentional product choice.
- **Charts:** Table/Distribution/Scatter are shown under **Optimise → Results**; Swing/Health/Robustness/DNA/fixture matrix are under **Analysis**. Current labels may differ. Distribution calibration, EO universe, stochastic objective, disruption simulation and probability calculations cannot be reconstructed from this footage.
- **Data availability:** event coordinates, keeper positions, team goal-share conservation and penalty tiers require real inputs and explicit model design. Do not invent missing data or change assumptions as a UI-polish side effect.
- **Website claims:** the [official website](https://solioanalytics.com/), read on the audit date, describes planning around user beliefs/risk appetite and stochastic programming. This supports product positioning only; it provides no fair accuracy benchmark or proprietary implementation.
- No forecast adjustment was made. This document inventories source behaviour and recommendations; it does not certify feature or numerical parity.


## Implementation checkpoint after the follow-up

The core click-swap/left-run issues, persistent left pitch, inline projection editor, multi-search, ticker selection/sorting/trends and the sourced Data tools now have dedicated Ilmari/Profile 8 browser receipts. See [current handover](STATUS.md) and [planner QA](SOLIO_PLANNER_QA.md). The separate [live audit](SOLIO_LIVE_TOOLS.md) now includes actual club/range/individual-GW filters, ticker sorting and the current Opta entry gate.

This does not complete all eight tutorial areas. Team-strength propagation, conserved goal/assist shares, minutes-adjusted penalty tiers, schedule scenarios and parts of Analysis/results remain unimplemented. The independent GW stat editor is not an equivalent model; missing Opta event maps and proprietary risk/EO/distribution inputs remain explicit data limits.

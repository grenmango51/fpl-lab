# Solio team tools: source reference and implementation gaps

Read-only reference pass, **16 October 2026, 02:40–02:43 UTC**. Source: [signed-in Solio planner](https://fpl.solioanalytics.com/). This task owns only this document and ignored evidence; application code, MODEL and STATUS belong to the active implementation teams. No delegation was used. Future delegation must use T3 `delegate_task`, the same provider/model discovered through `orchestrator_capabilities`, and repeat that restriction and ownership in the child brief; no native spawning/messaging.

Fresh CUA inventory identified **Ilmari**, extension instance `bf22017c-ded2-4443-b4c1-a0e0c9aa49d5`, as browser **2** (numeric IDs change). A new research tab **547474387** was opened. T3 preview offered only Default/Incognito, so neither was used. Existing source tabs, local QA tabs and branches A/B were preserved. No forecast input, squad, branch, solver, subscription or schedule mutation was executed. Search/selection/standings/filter controls changed display state only.

## Live observations

- **Projections → Teams** is a strength scatter beside **Projected Points** standings, with Search and a Base Scenario selector. Better Attack points upward; Better Defence points right. Rendered numeric bounds were attack **0.9 bottom → 2.3 top**, defence **2.1 left → 0.8 right**. Thus a stronger defence corresponds to a *lower conceded-goals rate*, not a larger positive defence factor. These observed bounds are not universal limits. `axis-geometry.json` records DOM positions because the bottom axis fell below the 674px viewport.
- Clicking **MCI** selects it and reveals **View Man City**, **2.08 / game**, **1.08 conceded**, and disabled **Undo team strength change**. Selection does not move the point. No editable numeric strength field was exposed by this selection. The absolute rate display is not evidence that Solio uses Open FPL's independent multiplicative-factor model.
- **From Current Standings** initially ranked Man City 82, Arsenal 82, Chelsea 64, Liverpool 63. Clicking **From Clean Slate** ranked Arsenal 80, Man City 77, Man Utd/Chelsea/Liverpool 65. Scatter positions stayed unchanged and selected MCI still displayed 2.08/1.08. This verifies a standings presentation mode, not a changed forecast input. Returning from the team drilldown remounted **From Current Standings**. Whether these represent exact remaining-season/current-points formulas is unverified; do not derive an implementation from the rounded examples alone.
- **Keyboard:** clicking MCI focused its draggable point; Tab moved focus to MUN. Enter and Space on MUN produced no observed selection/navigation change. No arrow key, drag or numeric input was tried. Escape changed the expanded-pitch layout to tree/right Lineup; Projections was then reopened. This is a bounded observation, not a complete source accessibility audit. Local keyboard selection and numeric alternatives should be explicit, independently designed behaviour.
- **Search:** typing Arsenal retained all team nodes in the accessibility tree; the screenshot dimmed other points rather than yielding a reduced standings table. Search was cleared. Exact matching rules and behaviour for arbitrary queries remain unproven.
- **Horizon:** the tree's **5 GWs** button opened a slider currently at **5**. The drilldown's adjusted penalty chart and fixture list were labelled **GW7–11**. No slider change was made because that could alter existing plan horizons. The pass establishes controls and matching initial labels, not live recomputation/persistence on a horizon change. There was no separately observed team-scatter horizon control.

## Gates and actions are distinct

Three explicit banners were visible: **Upgrade to edit team strengths now!**, **Upgrade to edit penalty shares now!**, and **Upgrade to edit the fixture schedule now!** No banner was clicked, edit attempted, purchase made or gate bypassed. They establish the advertised entitlement boundary, not the exact rejection behaviour of every input.

Team selection, standings-mode switching, team drilldown, the Add penalty taker picker, and Show all fixtures remained inspectable. In particular, **Add penalty taker opens a list despite the penalty banner**; options included Aït-Nouri, Cherki, Donnarumma and others. No option was chosen. The first immediate AX response still said collapsed, but subsequent settled receipts show the list. The historical filename `06-penalty-add-blocked` is transitional and **must not be cited as a blocked action**; `actions.json` explicitly corrects it. Use receipts 07/11 for the open picker.

## Team drilldown and penalties

**View Man City** navigated to `team=15` inside Projections → Teams. Fields were **Penalty Taker Ranking**, numbered tiers **1/2/3**, **Add penalty taker**, **New Tier**, **Remove**, and a separate **GW7–11 Penalty Taker (Minutes-Adjusted)** chart. Tiers displayed Haaland 95%; Enzo/Ndiaye/Semenyo 30% each; Foden/Doku/Anderson 20% each. The adjusted chart instead showed Haaland 91%, Enzo 4%, Semenyo 4%, Ndiaye 1%, others rounded to 0%. These are separate concepts; tier percentages are not directly the displayed horizon allocation and must not be globally normalised as though they were one probability vector.

Below the chart were fixture rows with GW, home team, two numerical goal values, away team: GW7 Man City **2.72 / 0.84** Ipswich; GW8 Aston Villa **1.17 / 1.98** Man City; GW9 Man City **2.13 / 1.04** Brighton; GW10 Nott'm Forest **1.05 / 1.85** Man City; GW11 Man City **2.42 / 0.86** Fulham. The live row has no separate visible column-unit heading. Tutorial context supports expected goals; it does not reveal the exact strength-to-fixture equation, penalty model or minutes weighting.

## Fixture permutations

**Projections → Fixtures** has **Unset**, **7, 8, 9, 10, 11** columns and draggable club-pair blocks. It is distinct from the top-level analytical Fixtures ticker. Unchecking **Show all fixtures** removed all blocks in this unedited state while retaining columns; checking restored them. The rule for exceptional fixtures when unchecked remains unverified. No block was moved, so acceptance/rejection, blank/double propagation, reset execution and probability tooltips were not live-tested. No Reset Permutations action was shown in the unedited live receipt.

## Focused tutorial evidence

The existing eight-video audit is in [SOLIO_TUTORIALS.md](SOLIO_TUTORIALS.md); this pass did not replay it. Five saved frames from [07: Your Own Beliefs](https://www.youtube.com/watch?v=WWdXxqe1Az0) were visually re-inspected:

- **2:22 (`07-142.png`)**: strength selection shows **1.99 / game**, **0.90 conceded**, a **Home Adv 9.5%** control, **Reset Strengths**, an edit count and import/export icons. Do not infer the icon formats or home-advantage formula. The narrator describes changes cascading to players; live propagation was not tested.
- **2:46 and 3:11 (`07-166.png`, `07-191.png`)**: Bournemouth tiers coexist with a different minutes-adjusted ranking and fixture rows. Visible narration says penalty shares are awarded per match; these stills do not recover its conditional-on-pitch algorithm.
- **3:19 (`07-199.png`)**: Tavernier has moved to tier 1; **Reset Penalty Shares**, New Tier and Remove are visible, and the adjusted chart differs. This is recorded demonstration evidence, not a mutation performed in today's account.
- **3:36 (`07-216.png`)**: fixture moves coexist with edit count **2**, **Reset Permutations**, a visible **100%** label and changed decision scores. No legible hover probability explanation was captured. Exact uncertain-fixture probabilities remain transcript-only evidence.

## Requirements and remaining gaps

These requirements describe useful independent local behaviour, not recovered proprietary equations. The active local manual-factor implementation must keep its own units and provenance; **no numerical parity is claimed**.

1. **Strength inspection and editing:** preserve separate source baseline, manual attack/defence factors, derived scoring/conceding rates, selection/drilldown and reset/undo state. A defence factor needs an explicit direction; charting conceded rate requires reversing its horizontal axis. Never silently relabel a unitless factor as goals/game. Expose keyboard selection and labelled numeric controls without requiring drag. State scenario scope and which player/opponent/fixture components are recomputed.
2. **Standings and horizon:** distinguish projected league points from player FPL totals and expected goals. Current-points versus clean-slate calculations need documented season/schedule assumptions and separate display controls. A selected-GW horizon and full-season standings are not interchangeable; label their scope. Test changing a horizon on an isolated local plan, including GW38, rather than assuming the source slider proves the result.
3. **Penalty tiers:** ordered tiers, within-tier shares, add/remove/move, individual/team reset, and a separately computed minutes-adjusted allocation need real team/taker/minutes inputs. Define residual/no-designated-taker handling, simultaneous appearances, per-fixture allocation and multi-fixture aggregation. Validate bounds and invariants server-side. A static bar chart or one independent player penalty edit does not implement this workflow.
4. **Fixture scenarios:** retain stable fixture identity, both clubs, venue and official schedule; store scenario GW separately. Moving one fixture must consistently produce blanks/doubles and recompute affected player/team weeks and plan scores. Provide move count, reset/undo and an accessible move-to-GW alternative. Filtering the ticker cannot substitute for moving a fixture. Do not invent uncertain-move probabilities.
5. **Coherent player shares:** local independent GW xG/xA inputs and team factors do not reproduce the tutorial's conserved teammate goal/assist shares, per-90 rates or minutes survival distribution. Treat these as separate remaining model tools until explicitly designed and validated. Gates in Solio do not justify gating the personal local implementation.

Application integration, all three project checks, forecast coverage and local browser acceptance remain the parent/implementation owners' responsibility. This research did not test or certify their in-progress feature.

## Evidence receipts

Ignored directory: `data/exports/qa/solio-team-reference-20261016/`. `actions.json` contains UTC timestamps and action descriptions. Numbered PNG/TXT pairs cover current standings, selection, keyboard observation, clean slate, drilldown, picker transition, horizon/options, search and fixture display filtering. `axis-geometry.json` preserves rendered numeric axis direction. Raw network payloads, browser storage, cookies, credentials and tokens were not accessed. No other tabs or branches were cleaned up.

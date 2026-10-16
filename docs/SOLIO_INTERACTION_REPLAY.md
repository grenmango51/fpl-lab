# Solio interaction replay — 15 October 2026

Research-only pass on 15 October; comparison source captured at 11:26 UTC. Scope: this document and ignored evidence in `data/exports/qa/solio-replay-20261015/`. No application source, saved plan, account, or FPL submission was changed by this pass.

## Findings to carry into implementation

1. **The left tree Optimise button executes a solve while the right tab stays selected.** This is directly visible in Solio's official Decision Tree recording, not newly exercised in a signed-in live session. With Fixtures selected, the middle branch starts at zero, receives candidate teams/scores during the solve, and ends around 308 total points; Fixtures remains visible throughout. The presenter separately opens Lineup afterward.
2. **The recording has an acceptance step.** Candidate changes in the tree are not evidence that saved plans should be silently overwritten. The narrator asks the viewer to accept the result; the Optimise tutorial separately shows Reject, Apply, Alt and Copy. The task's requested immediate, reversible Open FPL update is an intentional product requirement; do not describe automatic adoption as exact Solio parity.
3. **The requested two-click substitution is a user requirement, not a verified fresh Solio click sequence.** The supplied Login & Navigation recording demonstrates dragging a bench player onto a starter. It also shows clicking a player to open a contextual Transfer/Edit window. It does not establish what a first and second plain shirt click do in today's signed-in planner.
4. At the start of this pass, Open FPL's code had both reported mismatches: tree Optimise called `navigateTab("optimise")`; the first shirt click called `onDetail(id)`. Other workers changed these files during this research. A later source capture already contains execution and direct-selection handlers. **The old mismatch must not be reported as still unfixed solely from the initial read.** The captured new implementation has not been browser-verified by this research pass.

## Access and evidence boundaries

Read the global/project AGENTS instructions, MODEL_PROVIDERS, STATUS and SOLIO_REBUILD. SOLIO_REBUILD is `docs/SOLIO_REBUILD.md`, not a root-level file. No delegation was needed.

Used the T3 collaborative browser: `preview_status` first, then `preview_open(reuseExistingTab=false)`, with the returned own tab ID on every subsequent action. No human-controlled tab was operated. The available profiles were Default and Incognito; the fresh Default tab was signed out.

The first attempted host, `www.solioanalytics.com`, failed DNS resolution. The documented working planner host is [fpl.solioanalytics.com](https://fpl.solioanalytics.com/). Both its root and [tree/lineup URL](https://fpl.solioanalytics.com/?view=tree&tab=lineup) showed a blocking Welcome dialog. The background was an empty sample tree with zero scores and shirt placeholders, not entry 2200722.

Live actions actually performed:

- Pressed Escape: Welcome remained.
- Clicked **Why?**: it opened an explanation that anonymous planning is not currently supported because of its account sync system.
- Attempted a normal Base Team click: T3 returned `Preview automation click timed out after 2000ms.` Welcome remained and no team-ID field was available.
- Inspected the tree button: the left Optimise was disabled in this state. The right Optimise tab existed behind the gate; this was not a runnable team.

Public entry **2200722** was authorised, but no live import form could be reached without sign-in. No Google login, terms acceptance, or account change was performed. No claim is made about hidden signed-in actions. No live Solio swap, captain edit, lock, undo, or solve was executed.

A disposable Open FPL origin at `127.0.0.2:8000` was tried in an independent Incognito tab; connection was refused. That tab was closed. No production-origin storage was cleared or mutated. This pass compares Open FPL source, not a newly tested production build.

## Official recordings inspected

These were opened and visually inspected in the browser, using paused video frames at the listed timestamps. They are source demonstrations, not actions performed against a live Solio team. Some captions said unavailable in the player while visible subtitle text still appeared; no complete transcript is claimed.

- [01: Login & Navigation](https://www.youtube.com/watch?v=EtL1kwUbq04), the requested fallback, duration 1:34.7. Frames inspected at 0:14, 0:24, 0:26, 0:32, 0:35, 0:38, 0:42, 0:44, 0:52, 0:58, 1:08, 1:20, 1:29.
- [06: Decision Tree](https://www.youtube.com/watch?v=x7wbyB7Lu7c), discovered on the [official channel](https://www.youtube.com/@SolioAnalytics/videos), duration 2:37.3. Inspected 0:20, 0:40, 1:00, 1:18, 1:20, 1:22, 1:24, 1:26, 1:28, 1:30, 1:34, 1:40, 1:49, 2:00, 2:20.
- [04: Optimise tab](https://www.youtube.com/watch?v=0ywv0p6itmU), duration 1:32.6. Inspected 0:12, 0:25, 0:40, 0:55, 1:10, 1:22.

## Replay cases and Open FPL comparison

### R1 — Normal entry/import

**Source:** Live Welcome blocks the planner; Why explicitly describes the lack of anonymous access. The Login recording discusses ID/name-based team entry but does not visibly demonstrate importing 2200722 in the frames inspected.

**Open FPL:** `importTeam` calls `/teams/{teamId}`; the UI exposes FPL team ID. This is an independent public-team import, not a Solio account connection.

**Expected:** A disposable Open FPL scenario can import 2200722 without replacing existing saved plans. A successful Solio import replay remains unverified, not a missing Open FPL implementation requirement.

### R2 — First starter click

**Source:** Live blocked. Recording 01 at 0:35–0:38 shows B. Fernandes selected and a contextual window containing C, VC, Locked, Ban, Undo, Transfer and Edit. This verifies a detail-window path in that recording, not today's exact hit-area mapping.

**Initial Open FPL mismatch:** `PlannerBoard` passed `selected === id ? onSelect(null) : onDetail(id)` to `Pitch`. With no selected player, a shirt click opened details instead of entering substitution selection.

**Task expectation:** First plain shirt click selects the starter in place and exposes legal bench targets; no large dialog. The captured new source uses `interactionMode="substitute"` and `onSelect(id)`, which is consistent at code level.

### R3 — First bench click

**Source:** Live blocked. Recording 01 at 0:32 shows a bench-to-XI drag; the recording alone does not prove bench-first plain-click behaviour.

**Initial Open FPL mismatch:** The bench uses the same `Pitch` tile callback, so it also opened details first.

**Task expectation:** First bench shirt click selects that player and highlights legal starters. It must work in either order, including the two goalkeepers. The captured new selection code supports both starter and bench selection; browser confirmation remains required.

### R4 — Second legal opposite-side click

**Source:** A two-plain-click swap was not replayable in live Solio and is not demonstrated by the sampled recording. The recording does visibly support a direct drag substitution.

**Open FPL:** `Pitch` already routes a selected legal target to `onBenchSwap`. `swapPlayers` exchanges XI/bench IDs, handles a substituted captain/vice, calls server-backed `updatePlan`, and clears selection. The original blocker was entering this selection state without going through the player window's Sub action.

**Task expectation:** Starter → legal bench player, and bench → legal starter, each complete immediately after the second click; one server-validated reversible change; no confirmation dialog. Squad ownership, bank, transfers and unrelated GWs stay unchanged.

### R5 — Click the same player twice

**Source:** Not live-verified; do not attribute a specific deselection rule to Solio.

**Open FPL:** The original same-ID deselect branch existed but was normally inaccessible on first click. The captured new `PlannerBoard` explicitly calls `onSelect(null)` for the selected ID. `Pitch` suppresses double-click detail opening in substitute mode.

**Task expectation:** Second click clears selection with no squad change and no dialog. Rapid double-click must not race into a detail popup.

### R6 — Illegal swaps and same-side clicks

**Source:** Live blocked. The recording does not demonstrate illegal formations, GK/outfield swaps, or two starters/two bench players.

**Open FPL:** `canSwap` rejects identical IDs, missing squad IDs, same-side substitutions, GK/outfield combinations, and illegal formations. It allows exactly one GK, 3–5 DEF, 2–5 MID and 1–3 FWD after the move. `swapPlayers` repeats the check before validation.

The captured new UI retains selection for an illegal opposite-side target, and changes selection when clicking another player on the same side. That is a reasonable Open FPL interaction choice, not observed Solio parity.

**Expected:** Illegal pairs must never change the lineup, captain, bank or history. Do not open details as a side effect of an invalid substitute click. Decide explicitly whether same-side clicks reselect or reorder; do not accidentally transfer a player. Bench priority remains a distinct action.

### R7 — Clear selection

**Source:** Escape was tested only against the Welcome gate and did not dismiss it. This says nothing about signed-in shirt selection.

**Open FPL:** Existing App Escape handling clears selection when a detail dialog is absent; the substitution banner has Cancel. The captured new `PlannerBoard` adds outside-background and Escape handling while avoiding editable fields, menus and dialogs.

**Expected:** Same-player click, Cancel, Escape and a blank pitch/background click clear selection without editing the plan. Test that closing a detail/menu does not unexpectedly consume or trigger a substitution.

### R8 — Info/transfer trigger and hit areas

**Source:** Recording 01 at 0:38 shows the small adjacent player window and Transfer shortlist. The selected shirt has corner brackets. This confirms contextual detail and transfers, but does not establish a separate live info-icon hit area. The purple name strip also contains an arrow in the recording; its exact independent click action was not tested.

**Initial Open FPL:** The entire shirt/name/meta button opened details and also had a double-click detail callback.

**Task expectation:** The broad shirt hit area serves selection; an explicit, separately labelled info control opens the existing detail/transfer window. Captured new `Pitch` adds `Info for {name}` outside the shirt button. Transfer/Edit/Breakdown/History and affordability/confirmation logic can remain reachable there. The info action must not also count as the first/second swap click. Keep an adjacent desktop window and a fitted mobile sheet.

### R9 — Compact captain/vice and locks

**Source:** Recording 01 at 0:38 visibly has C, VC, green Locked, red Ban and Undo in the adjacent window. By 0:42–0:44 the pitch shows Fernandes as captain and Szoboszlai as vice. This verifies the recorded control path and visible result. It does not prove that captain badges on the shirts themselves are clickable, nor the scope/persistence of a lock.

**Open FPL:** Player details expose C/VC/Lock/Ban. `setCaptain` requires a starter and exchanges conflicting C/VC assignments. Locks/exclusions are global optimiser settings with their own explicit titles, not demonstrated Solio per-decision semantics.

**Expected:** Keep these actions compact and reachable from explicit details. They must operate on the intended plan and GW, not accidentally swap shirts. Do not claim that Open FPL's global ownership lock has identical Solio semantics.

### R10 — Left Optimise: execute, progress, result, unchanged right panel

**Source sequence:** [Decision Tree, 1:18–1:34](https://www.youtube.com/watch?v=x7wbyB7Lu7c&t=78s).

1. Fixtures is selected on the right. Three branches are visible; the middle branch is selected and empty.
2. At 1:22, the cursor is on the orange Optimise above the selected middle node. The visible narration describes starting the solver.
3. At 1:24–1:26 the run is active; the middle branch still has provisional zero values. An exact progress percentage was not readable and must not be invented.
4. At 1:28, candidate teams/transfer lines and scores populate that branch, around 306.7 total.
5. At 1:30, values update again, around 308.0 total. The narration requests acceptance.
6. At 1:34, the right panel still shows Fixtures; the cursor has moved to the Lineup tab. At 1:40, Lineup is selected and the resulting team is visible.

This establishes that **running and updating the left tree does not require navigation to the right Optimise tab**. The recording's values are examples, not forecast-quality evidence.

**Initial Open FPL mismatch:** `PlanTree.onOptimise` was wired to `navigateTab("optimise")`. That displayed setup; it did not call the solver. `runSolve` then stored a draft needing Apply, and `applySolve` navigated to Lineup.

**Captured working source:** `PlanTree` is now wired to `runSolve(false, true)`; `runSolve` validates an in-place optimised suffix, saves history, updates the source plan, and does not call `setTab` in that path. It has request/source/forecast checks. This appears to address the user's requested execution route; it is not a fresh browser result.

**Expected:** One left click starts the bounded solve using the selected branch/GW and current settings. Show honest busy/completion/failure state without tab navigation. A successful, validated result changes the intended team's planned weeks and is undoable. Preserve right tab/subview/filter/scroll, all unrelated plans and the frozen run source if selection changes while solving. Do not claim Solio-style live candidate streaming from a spinner alone.

### R11 — Configure and optimiser settings remain explicit

**Source:** Decision Tree shows top-left Configure and top-right horizon throughout. At 1:49 it also shows a horizon slider. Around 2:00, the root-team edit path shows an empty squad with a player-search popup. Recording 04 at 0:12–0:55 shows the separate right Optimise Setup screen with presets, chip planning, sliders and constraints; at 1:10 it shows Results and Apply/Reject/Alt/Copy. Recorded paid/ungated-looking chip controls do not establish current free-account entitlement.

**Open FPL:** Tree Configure opens team configuration, with starting bank/FT context. The captured new source adds `onOptimiseSettings` separately from execution.

**Expected:** Keep execution distinct from settings navigation. The right Optimise tab and an explicit settings menu item may navigate to setup. Configure must not become a disguised Run command. Keep the model's own settings labels and limitations; Solio risk/disruption controls are not numerical equivalents.

### R12 — Undo and recovery

**Source:** The player window visibly contains Undo at 0:38, but it was not clicked in a live session and the recording frames do not prove its exact scope. The optimiser recording does show Apply and Reject. No fresh Solio undo execution is claimed.

**Open FPL:** `travelPlan` restores an earlier validated plan; `updatePlan` records per-plan history. The captured in-place solve path saves a pre-solve copy into that history. `togglePlayerConstraint` changes solver settings rather than plan history, so plan Undo is not automatically a lock/ban undo.

**Expected:** Undo after a direct substitution and after a successful left solve must restore the exact preceding team/resources while keeping the current right view. Failure or rejected validation must leave no partial mutation or misleading undo entry. Test lock reversal separately through its own toggle; do not advertise universal Undo without supporting it.

## Evidence inventory and handoff

Ignored evidence includes:

- `01-solio-login-why.png`: live blocking Welcome and Why explanation.
- `access-check.json`: gate text, disabled left action and failed normal Base Team click.
- `yt{seconds}.png`: requested tutorial frames; especially `yt32.png` for drag substitution, `yt38.png` for contextual actions, `yt44.png` for C/VC result, `yt52.png` for Settings.
- `tree{seconds}.png`: especially 82/84/86/88/90/94/100 for execute → provisional result → explicit Lineup navigation.
- `optimise{seconds}.png`: Setup and Results, including Apply/Reject at 70.
- `screenshots.json`: original browser artifact paths mapped to local frame names.
- `source-*.tsx`, `source-plannerInteractions.ts` and `source-capture.json`: frozen later source copies with hashes/time. Other workers continued editing; use functions/labels rather than assuming stable line numbers.

The live access limitation is **not** evidence that signed-in Solio lacks these interactions. Prior signed-in notes in SOLIO_REBUILD remain historical observations, not re-executed proof. The unverified behaviours are specifically plain first/second shirt clicks, same-player click, illegal targets, deselection, current hit areas, lock scope and undo execution.

No application checks were run for this documentation-only research. The implementing agent should run the project checks and use a disposable imported scenario for browser acceptance: both swap orders; GK swap; illegal formation; same-player/double-click; blank/Escape clearing; explicit info; C/VC; lock toggle; left solve from Lineup and Fixtures; source switch during a solve; failure preservation; and undo. Existing saved plans must remain intact.


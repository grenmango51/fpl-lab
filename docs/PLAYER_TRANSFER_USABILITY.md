# Player transfer/editor handoff — issue #10

Implementation handoff, 6 November 2026. **Parent desktop/390px transfer and actual editor save/reload/reset checks pass; remaining native inputs and independent code/blind acceptance are pending. The report is not closed.** `docs/STATUS.md` consolidation belongs to the parent. No browser/server was started, no deployment/merge occurred, and no Jam/issue comment was posted by this branch.

## Evidence and scope

Read issue [#10](https://github.com/grenmango51/fpl-lab/issues/10) and Jam [a0887aa4-9144-41ba-8183-a6c684045a7e](https://jam.dev/c/a0887aa4-9144-41ba-8183-a6c684045a7e) details, full voice transcript and frames at 00:18, 00:35, 00:48, 01:03 and 01:12.

- 00:15–00:57 shows Open FPL: too many clicks to find transfers, hidden eligibility toggle, repeated Over budget labels and an unnecessarily expanded resource row.
- 01:03 onward shows **Solio as reference**, with one-click adjacent player tools and Transfer/Edit tabs. Its subscription gate is not an Open FPL defect; the narrator explicitly requests working editing in Open FPL.
- Additional accepted parent finding: show the numeric proposed GW transfer hit before confirmation, including cancellations and WC/FH exemptions.

## Production changes

- Idle pitch primary click/Enter/Space opens the existing adjacent player window, initially on Transfer for squad players, with Edit alongside. Removed the redundant inspect double-click handler. Other pitch consumers retain their ordinary inspection behavior.
- The visible swap icon selects a player for deliberate substitution. While selected, primary pitch actions retain select/deselect, legal target substitution and explicit info. The existing window also offers **Substitute**; explicit info remains available while validation is busy. Drag legality, keeper/formation checks, rejection, cancel feedback and server validation remain in place.
- Search and **Affordable / All players** are outside disclosures. Affordable includes the club limit, disclosed in its tooltip. Club, horizon, sort and zero projected minutes remain under **Filters**. Candidate selection uses the existing native arrow button, followed by confirmation; no row-click commit gesture was added.
- **Available £…** is prominent. Native **Details** discloses selling/cancelled-buy value and reconstructed bank. Ineligible rows are muted, with disabled choose buttons and title/accessible reason; repeated visible warning lines are removed. Inspection and watch actions remain usable.
- Confirmation shows **GWn hit −4 pts** (or **0 pts**) and the previous total when it changes. It counts final-squad buys against the reconstructed entering permanent squad and canonical selected week's `free_transfers`; WC/FH exempt the cost. It does not subtract the hit from player xPts and call that team gain. Financial reconstruction and Python rounding from `9ea0bbe` are preserved.
- Picker state is keyed by source plan + player + exact player GW. The projection-inline editor and existing editing/scenario application are unchanged. Parent async-operation work still needs integrated concurrent-navigation acceptance; this branch does not claim that gate.

## Checks and limits

- `npm test`: **178 passed**, including six real-component handler/state tests and shared financial/hit fixtures.
- `npm run build`: pass. `npm run typecheck:hosting`: pass.
- `python -m pytest backend/tests -q`: **605 passed**, including **34 shared picker cases through actual `/api/plan/validate` requests**. One existing Starlette/httpx deprecation warning; no dependency changes.
- Hit fixtures cover first ordinary move, third/fourth net move at two FTs, cancellation reducing/zeroing a hit, changing a new buy, cross-slot cancellation, WC/FH at two and zero FTs, restored post-FH holdings and later-week canonical FT consumption.
- Isolated copied-cache offline forecast coverage passes Solio on/off: **670 players × GW10–38 = 19,430/19,430 cells** each, including fixture membership, finite/reconciled values and probability bounds. Extraction dates and fallback labels are retained; this is not a fresh provider acquisition. Receipt: ignored `data/transfer-ui-coverage-qa.json`.
- Test harness exercises production callbacks and state transitions without DOM geometry or native event dispatch. Actual keyboard/touch focus, window positioning, responsive layout, browser rejection/retry, projection save/reload and concurrent plan/GW navigation remain for parent capture. No independent review was performed by this implementation thread.

## Selectors for native capture

- Idle pitch primary: `.planner-board .player-select`, accessible name **Open {name}**, tooltip **Transfer / Edit {name}**. The old primary **Select {name}** now exists only during deliberate substitution.
- Idle swap icon: `.player-substitute`, accessible name **Select {name} for substitution**, tooltip **Substitute {name}**. During substitution, `.player-info` retains **Info for {name}**, and legal primary targets retain **Substitute {name}**. Cancel remains **Cancel substitution**; Escape clears selection.
- Window substitution action text changed **Sub → Substitute**.
- Search: input **Search replacements**, immediately rendered. Eligibility group **Replacement eligibility** has native **Affordable** and **All players** buttons with `aria-pressed`.
- Advanced disclosure: `.transfer-options > summary`, text **Filters**. Existing **Replacement club**, **Replacement horizon**, **Replacement sort** select names remain.
- Budget: `.transfer-budget > span`; supporting native summary has accessible name **Budget details** and text **Details**. Removed `.transfer-resources` and `.transfer-limit`.
- Eligible choice name stays **Choose {name}**. Disabled name is **Choose {name}: Over budget** or **Choose {name}: 3 players from club**; use a prefix/regex when inspecting blocked choices. `.transfer-pick:disabled` must never select or commit.
- Hit preview: `.transfer-hit-preview[role="status"]`, contains **GWn hit**, proposed signed numeric cost and optional **was … pts**. **Confirm transfer** remains a native button; while blocked its accessible name includes the reason, and while pending its text is **Checking…**.

Parent acceptance should capture idle pitch → immediate shortlist/Edit; search/toggle without disclosure; muted inaccessible choices; available-budget disclosure; real editor save/reset at exact GW and inline Projections; deliberate click/keyboard/mobile substitutions and drag cancel/illegal/keeper cases; confirmation hit/cancellation/WC/FH against accepted receipts; failure/retry and plan/GW navigation while validation is pending. Keep the issue open until those gates pass.

# Player transfer/editor handoff — issue #10

Implementation handoff, 6 November 2026. **Parent desktop/390px transfer and actual editor save/reload/reset checks pass; native keyboard/drag/touch checks also pass, with fresh independent code/blind acceptance pending after the first blind review found material issues. The report is not closed.** The implementation thread started no browser/server. Parent acceptance later used isolated app tabs in the existing signed-in Chrome and temporary development services; recordings and receipts are linked from PR #11. No deployment or GitHub merge occurred.

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
- Picker state is keyed by source plan + player + exact player GW. The default comparison covers the remaining planned weeks, and the list/review label the exact range; manually extending the comparison remains possible.
- Edit discloses that assumptions affect all plans, shares one target week between player header, stats and minutes, collapses supplementary news/minutes, and keeps Save/Reset visible. Assumption scope and forecast mathematics are unchanged.
- Current PR #9/#8/#5 parents are integrated through PR #7. Recalculation status explicitly marks prior player figures and plan totals, offers Retry after failure, and adopts new player figures and rescored plans in one render. Slow initial loading offers a truthful stage and Retry while retaining saved inputs. Broader concurrent-navigation acceptance remains open.

## Checks and limits

- Combined `npm test`: **298 passed**, including eleven real-component UI handler/state cases, inherited operation/forecast closure cases and shared financial/hit fixtures. The focused UI corrections passed 181 before parent integration.
- `npm run build`: pass. `npm run typecheck:hosting`: pass.
- `python -m pytest backend/tests -q`: **605 passed**, including **34 shared picker cases through actual `/api/plan/validate` requests**. One existing Starlette/httpx deprecation warning; no dependency changes.
- Hit fixtures cover first ordinary move, third/fourth net move at two FTs, cancellation reducing/zeroing a hit, changing a new buy, cross-slot cancellation, WC/FH at two and zero FTs, restored post-FH holdings and later-week canonical FT consumption.
- Fresh parent coverage at 18:32 UTC passes Solio on/off: **670 players × GW10–38 = 19,430/19,430 cells** each, including fixture membership, finite/reconciled values and probability bounds. Extraction dates and fallback labels are retained; this is not a fresh provider acquisition. Receipt: ignored `data/transfer-ui-coverage-qa.json`.
- The implementation harness uses production callbacks without native geometry. Parent native checks additionally pass desktop/390px transfer opening/eligibility/hit disclosure, injected rejection and real retry, canonical source adoption and other-plan preservation; actual GW11 stat save/reload/reset; keyboard opening/tabs/focus return, deliberate swap/Undo, legal/illegal/cancelled drag, and CDP touch opening/eligibility/Edit. Both layouts have no document overflow. Parent fresh source coverage at 13:00 UTC passes all 19,430 cells in both configurations. Fresh independent reviews and combined concurrent plan/GW acceptance with the separate async fixes remain pending.

## Selectors for native capture

- Idle pitch primary: `.planner-board .player-select`, accessible name **Open {name}**, tooltip **Transfer / Edit {name}**. The old primary **Select {name}** now exists only during deliberate substitution.
- Idle swap icon: `.player-substitute`, accessible name **Select {name} for substitution**, tooltip **Substitute {name}**. During substitution, `.player-info` retains **Info for {name}**, and legal primary targets retain **Substitute {name}**. Cancel remains **Cancel substitution**; Escape clears selection.
- Window substitution action text changed **Sub → Substitute**.
- Search: input **Search replacements**, immediately rendered. Eligibility group **Replacement eligibility** has native **Affordable** and **All players** buttons with `aria-pressed`.
- Advanced disclosure: `.transfer-options > summary`, text **Filters**. Existing **Replacement club**, **Replacement horizon**, **Replacement sort** select names remain.
- Budget: `.transfer-budget > span`; supporting native summary has accessible name **Budget details** and text **Details**. Removed `.transfer-resources` and `.transfer-limit`.
- Eligible choice name stays **Choose {name}**. Disabled name is **Choose {name}: Over budget** or **Choose {name}: 3 players from club**; use a prefix/regex when inspecting blocked choices. `.transfer-pick:disabled` must never select or commit.
- Hit preview: `.transfer-hit-preview[role="status"]`, contains **GWn hit**, proposed signed numeric cost and optional **was … pts**. **Confirm transfer** remains a native button; while blocked its accessible name includes the reason, and while pending its text is **Checking…**.

Parent recordings now cover direct pitch → transfer/Edit, ordinary third-transfer −4-point disclosure, failure/retry and GW11 editor save/reload/reset; keyboard/drag/touch receipts cover the input regressions above. The reference ordinary transfer uses a temporary copy, deleted afterward. Monetary setup differs, and its visible upgrade boundary does not establish editing behavior beyond that gate. The first isolated blind review returned PASS_WITH_ISSUES. Its six consequential Y findings were accepted: comparison range, shared scope, recalculation feedback, week consistency, Save/Reset visibility and loading recovery. Four L findings concern the reference interface. Corrective native checks cover real held forecast responses, an explicit injected 503/retry, atomic pitch/both-plan totals and initial-load retry rejecting an obsolete response. Fresh independent source/blind rechecks and broader combined async navigation acceptance remain open. The issue stays open until those gates pass.

The first isolated source audit of the earlier candidate found no introduced correctness regression, a P3 concern about hidden disabled-row explanations, and five existing material defects. Current inherited async parents address its pending-receipt/navigation findings. Corrective `502615e` derives a chosen transfer player from refreshed data instead of retaining an obsolete object and routes inline Substitute to the lineup; selected-player refresh/removal tests pass. Native evidence and independent recheck remain pending for those corrections. The refreshed-price saved-plan resource discrepancy stays open for a focused follow-up.

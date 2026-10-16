# Manual fixture permutations

This is a local HUMAN planning assumption, not a public schedule update, a fitted postponement probability or numerical parity with Solio.

## Contract

Every `ForecastRequest` and inheriting request accepts `fixture_moves`, default `{}`. Each key is the canonical string of a stable official FPL fixture ID, and its value is a strict JSON integer remaining GW through 38 or `null` for Unset. Boolean, float and string destinations, unknown/noncanonical IDs, completed fixtures/events and past origin/destination weeks are rejected. `finished_provisional` also counts as completed. An unplayed Unset fixture can be assigned a remaining GW. Empty maps and assignments equal to the official event are exact forecast no-ops. Reset removes the map and rebuilds from the official inputs; moves never accumulate onto a previous scenario.

Example: `{"fixture_moves":{"123":15,"124":null}}`, only when those IDs are unplayed current official fixtures and GW15 remains available. Both clubs and home/away identity stay attached to the fixture. No synthetic fixture, uncertain-move probability, kickoff date, injury recovery or congestion effect is inferred.

## Frozen forecasting phases

1. Calculate the ordinary component forecast with the request's global minutes, per-GW duration/availability, scoring and market settings, then apply all ordinary provider and optional CSV calibration/extrapolation. This calibrated baseline is frozen.
2. Make a read-only dataset view with copied fixture dictionaries whose events reflect the requested moves. Build a component forecast without reading/writing the global projection cache. Market context always resolves against the **original fixture and entire original official schedule**, never the edited target event or edited per-GW fixture count.
3. Replace only each moved club's origin/destination GW rows with that new component forecast. This includes all teammates and all fixtures in those affected weeks. Drop provider/CSV point residuals and provider appearance calibration **only in those player-weeks**; those anchors have no fixture-level decomposition. Other clubs/weeks keep exactly their original calibrated dictionaries, extrapolation ratios, probabilities and points. The normal baseline anchor set is not recalculated after a move.
4. Apply existing team-strength assumptions, then individual stat schedules. Minutes/availability are interpreted in the **target GW** before components are calculated. Stat schedules also remain attached to their selected target GW, with the existing blank/appearance safeguards and direct-point precedence.

Affected GW points/components, minutes and at-least-once appearance/60-minute probabilities are recomputed from actual scenario fixture membership. Moving into a double can create a triple; removing all fixtures produces a true zero blank. Moving to Unset removes a fixture from all remaining GW forecasts while retaining it in the schedule receipt. All remaining GWs and players are still present.

## Source integrity

Joe expectations already matched to the original fixture may be reused with the original source timestamp. Original single-fixture Elevenify sheet inputs may likewise be reused as assumptions for **that same fixture**, carrying `source_event`; they are not relabelled as a newly sourced destination-GW/opponent aggregate. An original double-GW aggregate remains ineligible as a single-fixture input even if the scenario separates the double. Conversely, an originally single fixture retains its original context when entering a double. Existing destination fixtures retain their own original fixture context. An Unset-origin fixture lacking identifiable fixture inputs uses the ordinary historical fallback; it does not borrow a destination sheet cell.

Source names, timestamps, extraction metadata and original inputs stay intact. The whole source schedule is used to decide whether a sheet cell identifies one fixture. This is a deliberate frozen-fixture assumption: real rescheduling could change markets, lineups, player form, recovery and team strength. No such updated data is claimed.

## Response and integration

For active moves, top-level `fixture_scenario` contains canonical active `moves`, timestamp, scope and receipts (`id`, both clubs, `original_event`, `source_event`, `target_event`, `original_kickoff`, null `hypothetical_kickoff`). `fixture_schedule` contains every official fixture with scenario `event`, original/source event and original kickoff. A moved fixture's `kickoff_time` is null; this includes moves to Unset. Finished fixtures remain present with their unchanged schedule and finished flag.

Affected player-week `fixture_scenario` records base points/source, delta, before/after fixture IDs, the relevant move receipts and `anchors_bypassed`. Its fixture rows retain `original_event`, `source_event`, `target_event`, `original_kickoff`; `kickoff` is null for moved fixtures. These fields distinguish a source observation from the manual destination. `prediction_source` identifies the HUMAN layer and retains the previous calibration receipt. Top-level forecast layers and limitations disclose the change.

Projection POST, player detail, CSV export, lineup/optimise, plan validation, chip recommendation, sensitivity and chip-strategy requests all inherit the field and consume `forecast_for`. Background jobs acquire the frozen payload/configuration through the existing request-field mechanism. Team/ticker consumers should aggregate the returned player fixture contexts and use `fixture_schedule` for scenario membership, including Unset; they must not reread official membership as if it were the scenario. Frontend persistence, move controls and browser acceptance are the parent integration task.

CSV scenario JSON retains the relevant move receipts even on an emptied origin week. Snapshots freeze the input map in their configuration/hash and retain top-level scenario/schedule receipts. Affected current/future Live ensemble targets are marked exploratory. Future target fixture membership follows the scenario and carries original events/kickoffs; affected player targets retain source contexts and move metadata. The separate Component model remains the ordinary official-schedule component forecast. Raw FPL Form targets remain their original supplied GW values; they are not reassigned to a new event.

The player-detail simulation consumes scenario components and retains the existing independent-event/default-scoring limitations. It is not a calibrated scenario distribution or a fixture rescheduling probability model.

## Verification

Backend tests cover strict validation, identity/reset, cached/dataset immutability, both clubs, blanks, triples, Unset origins/destinations, GW38, actual fixture-count consistency, destination minutes/stat precedence, team strengths, unchanged CSV/provider anchors and extrapolation elsewhere, original Joe/sheet context, original-double safeguards, request inheritance, detail/CSV provenance and snapshot membership/hash/exploratory receipts. No frontend/STATUS edits or server restart belong to this backend task.

# Manual team-strength scenarios

This is an independently specified local **HUMAN assumption** tool. It does not recover Solio's numerical strengths, acquire new market odds, or establish forecast accuracy. Public source data remains the baseline.

## Request contract

Every `ForecastRequest` accepts `team_strengths`, default `{}`. Keys are canonical strings of the stable official FPL club **code**, not current-season team IDs, abbreviations or provider IDs. Up to 20 current clubs are accepted. Each value accepts only `attack` and `defence`, with omitted factors defaulting to 1. Factors must be finite JSON numbers from 0.5 through 2; booleans and numeric strings are rejected. For example, `{"team_strengths":{"3":{"attack":1.1,"defence":1.05}}}` applies only if official club code 3 is in the frozen dataset. Bounds are input safeguards, not fitted uncertainty limits.

Factors cover every remaining forecast GW through GW38. An empty map or factors of exactly 1 return the original forecast payload unchanged, including metadata. Reset removes the factors and forecasts again from original inputs; it does not invert a previously adjusted payload. Always apply the helper to the ordinary calibrated payload, never to its prior scenario output.

## Propagation and precedence

1. Resolve official inputs and manual minutes/availability using the existing model.
2. Apply all normal provider/CSV point and appearance calibration, including extrapolation, unchanged.
3. Apply team strengths as component deltas.
4. Apply individual per-GW stat assumptions last; explicit player xG/xA/CS/point assumptions take precedence.

For club A facing B, let `g = attack_A / defence_B` and `h = attack_B / defence_A`:

- Team goals, player xG and player xA multiply by `g`.
- Goals conceded multiply by `h`.
- Clean-sheet probability becomes `base_CS ** h`. This rescales the implied clean-sheet hazard while retaining the source baseline, which need not equal `exp(-base_conceded)`. Source boundary probabilities 0 and 1 remain exact.
- Goals, assists and clean-sheet points use the frozen official/custom scoring dictionary. Clean-sheet points retain fixture P60 exposure.
- GK/DEF conceded deductions use the existing model's exact Poisson-pair calculation in the separate short and long minutes states. Conditional durations are recovered with the same `appearance_profile` helper, current-season history selection and manual duration precedence as the component model. Fixture state probabilities retain their original component meaning; a provider's GW probability does not invent new component state durations.

The same rules apply from B's perspective. Thus changing one club can affect its teammates and opponents, including opposing CS/conceded components. Multipliers combine before application when both clubs have assumptions. Unavailable players retain zero events/points; blanks remain identical; doubles sum their actual fixture deltas. A changed fixture's teammates share the same strength factors, but this is not a conserved goal/assist-share model: historical player event rates remain independent. Scenario factors scale baseline player events directly, without applying the historical team-rate clipping again.

Appearance/minutes, bonus, saves, penalty saves, cards, own goals and defensive-contribution rates stay fixed. No newly inferred tactical, selection, penalty-share or goal-share behaviour is claimed.

## Reconciliation and provenance

GW-only provider/imported point-anchor adjustments retain their component names and numerical values. On an affected week, they are allocated to changed fixtures by expected-minute shares using the existing scenario allocation helper. Equal shares are the zero-minute fallback. Untouched fixtures, players and weeks retain their exact original dictionaries/values. Fixture components sum to fixture points, and fixture totals reconcile to the adjusted GW components and points. The function does not mutate its input, cached source forecasts, source records, or official schedule.

Affected fixtures retain `source`, `source_at`, source-time scope and extraction time. `team_strength_scenario.base` separately retains original goals, conceded, CS, xG, xA, points, components and source/time fields. Fixture metadata includes attack/conceded factors and an application timestamp. GW metadata includes original points, delta and affected fixture IDs; `prediction_source.previous` retains the original point-anchor provenance. The top-level `team_strength_scenario` records the canonical active adjustments, label, time, scope and affected player-fixture count. `forecast_layers` and limitations disclose the human layer.

CSV scenario cells also include the canonical active team factors alongside the GW delta, timestamp and fixture IDs, so exported rows retain the actual assumptions. Unaffected and blank rows do not acquire team-scenario metadata.

Scenario-aware projection, player-detail and CSV POSTs, optimiser/lineup requests, plan validation, fixed-plan chip recommendations, sensitivity jobs and chip-strategy jobs all inherit the same field and call `forecast_for`. Jobs acquire one frozen scenario payload. Chip strategy stores the forecast configuration through the existing dynamic `ForecastRequest` field set; its source plan supplies prior decisions, while the top-level request controls forecasts. Frontend branch persistence and controls are integrated separately.

Snapshot configuration hashes include the input map; full forecast rows and future targets retain scenario metadata. Affected live-ensemble targets are explicitly exploratory, including the current target's receipt. The component-model baseline stays separate. Identity factors do not mark a target exploratory.

Player-detail event simulations consume the changed event components. Their existing independent-event engine uses default scoring and omits provider/imported point residuals unless an individual stat scenario is present; the response explicitly labels that limitation for team scenarios. Simulation means therefore need not match a calibrated scenario point forecast. No calibrated distribution or proprietary numerical parity is claimed.

## Verification scope

Focused backend tests cover strict inputs, stable codes versus IDs, identity/reset, all remaining fixture weeks, teammate/opponent effects, unchanged clubs/weeks/fixtures, input immutability, probability boundaries, zero appearances, blanks/doubles, mixed short/long conceded deductions, custom scoring, preserved provider residuals, individual-stat precedence, API schema inheritance, detail/CSV provenance and exploratory receipt marking. Full suite, real-data coverage, frontend integration and browser acceptance belong to the parent integration pass. No server restart is required for these tests.

Adversarial review additionally checks legacy global durations 0/25/59/60/90, both alone and inherited by availability-only schedules. The component builder already stores the resolved global duration in `minutes_scenario`; no request-duration fallback is needed. Mixed historical duration states are tested with a provider-calibrated GW appearance probability that differs from fixture appearance: conceded deltas retain the original fixture state probabilities and conditional means.

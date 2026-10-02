# Forecast derivation, version 0.1

This is a component-based statistical model, with a gradient-boosting challenger evaluated separately. It does not use the old international Elo/Dixon-Coles ratings as Premier League player forecasts.

## Inputs and time

Official FPL bootstrap provides the current scoring dictionary, squad rules, prices, status and player news. Per-fixture historic xG/xA, minutes, bonus, saves and cards come from official live endpoints and vaastav archives. Season-specific IDs are mapped through stable player `code`. Team expectations use FPL Joe fixture-level market data first, then the directly accessible Elevenify public sheet (or its attributed copy in FPL Joe), then historical team xG estimates. Numeric provider IDs are never treated as FPL IDs.

Sources carry UTC extraction time, SHA-256 and a content-addressed compressed raw payload. A failed feed may fall back to its stale cached payload, with an explicit status. Archived payloads and vendor data stay local and ignored by Git. Optional vendor schema failure drops to historical estimates.

## Appearance

Minutes have three states: no appearance, short appearance (1–59 minutes), long appearance (60+). Recency weights are `w_i = 0.5 ** (age_in_matches / 3)` across ten recent recorded team fixtures, including zero-minute rows. A zero-appearance pseudocount of 0.25 prevents absolute certainty from a short sample. `P60` and `Pshort` are weighted state counts divided by weighted rows plus that pseudocount.

Conditional durations are the corresponding weighted observed means, shrunk by one pseudo-match toward 80 minutes (long) and 20 minutes (short). `xMins = P60 * E[M|long] + Pshort * E[M|short]`. The official next-round availability percentage multiplies the state probabilities. Once three current-season games exist, that season determines the live appearance profile; rate estimates retain longer history.

Manual minutes set a conditional scenario duration and select the corresponding short/long state. Official availability still applies. This is explicitly an assumption, rather than a calibrated mean forecast. A 0-minute scenario gives 0 points.

## Player rates and team adjustment

Rate estimates use the most recent 45 recorded fixture rows, with a 15-match half-life. For an event E:

`rate90(E) = 90 * (sum(w_i * E_i) + prior_rate90(E) * 450/90) / (sum(w_i * minutes_i) + 450)`.

The positional prior is an observed aggregate of preceding seasons. The 450-minute prior weight is a declared regularisation choice. Fixture goals and assists are the rate times expected minutes, multiplied by team goal expectation / the player's historical team xG. The team adjustment is clipped to 0.5–2.0 to limit extreme transfer/small-sample effects. These choices have not been optimised on the 2025/26 holdout.

## Expected points

- Appearance: `2 * P60 + 1 * Pshort`, using the official configured values.
- Goals: expected goals times configured position goal score (including 10 for goalkeepers).
- Assists: expected assists times the official assist score.
- Clean sheets: team CS probability times P60 times the configured position score. This approximates full-match CS exposure and does not reconstruct the exact time of each goal.
- Defensive contributions: a player's empirical per-appearance threshold-hit frequency (10 for DEF, 12 for MID/FWD), shrunk toward the preceding-season position hit rate by three appearances. Multiply by appearance probability and the configured score. Keeper contribution is zero. Current-season rule changes remain a model caveat.
- Bonus, cards, own goals and penalties: preceding weighted event rates times minutes. Bonus is not a full reconstructed BPS ranking and cannot yet incorporate every 2026/27 BPS change.
- Conceded-goal deductions: if `N ~ Poisson(lambda)`, `E[floor(N/2)] = lambda/2 - (1-exp(-2*lambda))/4`. The identity follows from `floor(N/2)=(N-(N mod 2))/2` and `P(N odd)=(1-exp(-2*lambda))/2`. Apply this to each minutes state for keepers and defenders.
- Saves: for each minutes state, sum `floor(n/3) * PoissonPMF(n; save_rate * duration/90)`, then weight by the state probability. Numerical summation stops at 44 saves; this truncation is immaterial at observed FPL save rates.

Summing each fixture's components gives a GW forecast. Blank gameweeks are zero. Double gameweeks sum fixture forecasts. A team GW aggregate from a season sheet is never copied onto both fixtures in a double; fixture-specific markets or the historical fallback are used instead.

## Provider anchors and extrapolation

The default live forecast blends the normal public **FPL Form** export for the next three GWs at 50%. IDs, clubs, positions and prices are checked against the current official pool; at least 80% of rows must match. Source values and hashes stay local. Explicit manual minutes scenarios bypass this automatic provider blend for the affected player. User CSV projections can form a further weighted layer.

For each player's nonblank anchor weeks with base points at least 0.5, use `w_g = 1/(g - next_gw + 1)` and `r = clip(sum(w_g * provider_points_g)/sum(w_g * base_points_g), 0, 3)`. Beyond that player's last supplied week, `a_g = blend_weight * 2 ** (-(g-last_anchor)/half_life)` and `forecast_g = base_g * (1 + a_g * (r-1))`. The default half-life is six GWs. Direct weeks use an ordinary weighted blend. Blanks stay zero, and tiny/zero base forecasts do not identify an extrapolation scale.

The future component forecast carries the fixture schedule, team attack and clean-sheet expectations. This avoids repeating the same short-range point value against every opponent. The scalar ratio is a practical heuristic: it does not identify underlying attacking rates, future minutes, or injury recovery from point totals alone. Both the ratio cap and decay are declared choices needing prospective validation.

FPL Form's appearance probability is blended only in single-fixture GWs; its column describes the first fixture, so it is not used as a full-GW probability in doubles. Later appearance adjustments fade as well. xMins scale with that probability while retaining the base conditional duration. Base event components and simulations remain intact; an explicit provider/imported adjustment reconciles the point total. The historical benchmark remains the component model, and the live ensemble is captured separately for prospective scoring.

## Squad scoring and optimisation

Binary variables select owned players, starters, captain, purchases and sales in each gameweek. Integer variables track bank (tenths of millions), free transfers and hits. Constraints enforce 15-player 2/5/5/3 composition, legal XI formations, three per club, a single starting captain, balanced transfers, nonnegative bank, exact hits `max(0, moves - FTs)` and the 5-FT cap. Profit-aware initial sale values follow official half-profit rounding. Prices are held fixed across the horizon.

The objective discounts successive GWs, scores the XI and captain, weights bench points linearly, subtracts transfer-hit points and values saved free transfers. Optional ownership preference is a heuristic, not calibrated relative-rank utility. Candidate screening retains the top 24 and cheapest 8 per position plus held/locked players. Optimality is only relative to that pool; solver status and MIP gap are shown.

Wildcard changes become permanent without using saved FTs. Free Hit creates a temporary squad and then restores the preceding permanent squad/bank. BB counts all 15, TC adds two extra copies of captain points. Chip schedules are supplied by the user. Rebuying and later selling an original player is conservatively valued by the optimiser; server plan validation uses tracked purchase values and independently checks every result.

Displayed team totals include expected autosubs and vice-captain fallback. Under independent player appearances, compute the distribution of missing starters by position, enumerate the eight bench appearance states, and select the first-priority feasible bench subset preserving a legal nominal formation. Conditional bench points are `unconditional_points / P(appearance)`. Reserve goalkeeper contribution is `P(starting keeper absent) * reserve keeper points`. Vice contribution is `P(captain absent) * vice points`, multiplied by two for TC. Any cameo blocks an autosub; double-GW appearance is `1 - product(P(absent in each fixture))`. BB counts all 15 without an extra autosub term.

These are exact expectations **within the independent-appearance approximation**, not calibrated probabilities or a reconstruction of correlated team selection. The MILP objective still uses a linear bench weight and omits nonlinear fallback interactions; its output totals are recomputed with the fuller squad-scoring calculation. The “Best XI” shortcut compares legal formation candidates and bench orders; it is not a full enumeration of every possible XI.

## Honest evaluation

The 2025/26 season is held out. Gradient-boosting parameters fit only 2023/24–2024/25 rows. Features for an entire GW are created before its outcomes update any player/team state. Historical price features use the preceding observed fixture price. First-season training uses no end-of-season positional prior; subsequent priors use the earliest training archive only. Assistant managers are excluded.

Report cohorts include all player-fixture rows and the players with **projected** minutes ≥45. This avoids selecting on known target minutes. Current market/Elevenify values are not projected backwards. Historical injury/news snapshots are unavailable, so minutes forecasts have a meaningful limitation. Captain evaluation sums fixture forecasts and outcomes by player/gameweek before selection, including doubles; its undoubled point totals are not a simulated full-squad strategy. MAE differences include a 5,000-replicate gameweek-cluster bootstrap interval to preserve within-week error dependence.

Probabilities and independent-event simulation bands are labelled uncalibrated. Historical error does not establish competitive accuracy against paid tools. A prospective test must compare immutable forecasts with the same deadline, identical player cohort and the same eventual FPL outcomes.

## References

- Official scoring: https://www.premierleague.com/en/news/2174909/fpl-basics-explained-scoring-points and the current bootstrap `game_config.scoring`.
- Defensive contributions: https://www.premierleague.com/en/news/4361991/
- Current BPS changes: https://www.premierleague.com/en/news/4679946/
- FPL Review projection and solver methodology: https://docs.fplreview.com/the-model/projections/massive-data-model/ and https://docs.fplreview.com/the-model/solvers/solver-comparison/
- Historical records: https://github.com/vaastav/Fantasy-Premier-League
- Player forecast input and export semantics: https://www.fplform.com/export-fpl-form-data
- Formation, autosubs and captain fallback: https://www.premierleague.com/en/news/2174899
- Optimisation engine implementation: SciPy `optimize.milp`, HiGHS. All modelling choices not supplied by an external source are explicitly derived or declared above.

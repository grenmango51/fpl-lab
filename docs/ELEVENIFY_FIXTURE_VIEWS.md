# Elevenify fixture-specific attacking views

Verified **2026-10-02, 19:14–19:17 UTC**. Read-only research; no production changes, browser automation, credentials, upstream private-sheet requests or tracked raw datasets. These views are ordinary links in the published [attacking-baseline chart](https://datawrapper.dwcdn.net/tDC0G/5/). Its parent [Premier League resource](https://www.elevenify.com/p/premier-league-data) describes values as average expected outcomes and says updates follow each gameweek's final fixture.

## Access and parsing

Followed only the chart's actual links and returned explicit redirects:

- `https://datawrapper.dwcdn.net/YmfDr/` → [YmfDr/8](https://datawrapper.dwcdn.net/YmfDr/8/), labelled **Next GW Goal Involvement**.
- `https://datawrapper.dwcdn.net/ALYf8/` → [ALYf8/6](https://datawrapper.dwcdn.net/ALYf8/6/), labelled **3GW Goals**.
- `https://datawrapper.dwcdn.net/VK19h/` → [VK19h/7](https://datawrapper.dwcdn.net/VK19h/7/), labelled **3GW Assists**.

Each chart's published HTML declares the corresponding `https://static.dwcdn.net/data/<chart-id>.csv` asset. All returned HTTP 200, `text/csv`, without cookies. This is the normal published `externalData` mechanism documented by [Datawrapper](https://www.datawrapper.de/developer/connecting-to-external-data-sources), not its authenticated owner API.

**Important parser difference:** all three CSVs begin with one all-empty row before the actual header. A plain `csv.DictReader` wrongly treats the empty cells as duplicate header names. Skip only leading wholly empty rows, then validate the real header and every row's width. Do not reinterpret arbitrary rows as a header. All observed rows had the expected five/six cells.

## Next gameweek goal involvement

[Published data](https://static.dwcdn.net/data/YmfDr.csv), fetched **19:14:20 UTC**; HTTP Last-Modified **2026-09-30 19:49:20 UTC**.

The chart describes next-GW player goal involvement **assuming the player starts**. The actual header is `Player`, an unnamed club-badge column, `GW6 Goals`, `GW6 Assists`, `GW6 Involvement`.

- **99 player rows.** Expected goals range 0.16–0.58, assists 0.07–0.30, involvement 0.35–0.70.
- This is an expected-outcome/count view, not a probability of any return, FPL points, or per-90 xG/xA. A duration or starter-minutes distribution is not supplied.
- Current deterministic matching resolves **98/99** rows with no ambiguities or duplicate IDs. `Y. Pino` is the sole unmatched provider spelling.
- The GW6 header agrees with the current official next event. There is no fixture ID, opponent, home/away, price, position, player ID, availability probability or minutes column.

SHA256: `ece9bda3fe0579ee66705bcee1df69f5c52a942b6086d54ffa2a4e7902b85e29`.

## Three-gameweek goals

[Published data](https://static.dwcdn.net/data/ALYf8.csv), fetched **19:14:20 UTC**; HTTP Last-Modified **2026-09-30 19:49:23 UTC**.

The chart describes predicted goals **assuming the player starts**. The actual header is `Player`, unnamed club badge, `6`, `7`, `8`, `TOTAL`. These are separate labelled GWs, not only one multiweek aggregate.

- **49 rows; all 49 match uniquely** to current players using the existing deterministic matcher and documented aliases.
- GW6 goals range 0.22–0.56; GW7 0.22–0.96; GW8 0.18–0.69; total 0.79–2.21.
- `TOTAL` differs from the sum of the three rounded cells by at most 0.01. Retain per-GW cells; do not spread the total uniformly.
- No start probability, duration, player ID, fixture ID or FPL points are supplied. Missing players were excluded from this selected-player table; they do not have zero expected goals.

SHA256: `7b02cfd8658905d839363bcbc92c2342344a703bfb089b4a3ec07c8338820647`.

## Three-gameweek assists

[Published data](https://static.dwcdn.net/data/VK19h.csv), fetched **19:14:20 UTC**; HTTP Last-Modified **2026-09-30 19:49:25 UTC**.

The chart describes predicted assists **assuming the player starts**. The header is `Player`, unnamed club badge, `6`, `7`, `8`, `TOTAL`.

- **49 rows; 47 match uniquely** with no ambiguities or duplicate IDs. `Y. Pino` and `Savinho` require separately documented alias decisions.
- GW6 assists range 0.13–0.30; GW7 0.14–0.46; GW8 0.09–0.30; total 0.48–1.03. Total rounding discrepancies are at most 0.01.
- Only **15 matched players** occur in both the goals and assists three-GW tables; completeness of one component does not imply completeness of the other.
- This is not a full player projection pool. No minutes, start probability, fixture ID or FPL points are supplied, and the page does not specify whether its assist definition exactly equals the FPL fantasy-assist rules.

SHA256: `d9aa545268b50391500de92e35890de5b95b1b956ceacf28c44fd15569916219`.

## Identity and fixture checks

Comparison used the current [official FPL bootstrap](https://fantasy.premierleague.com/api/bootstrap-static/) with 667 players and next GW6, and [official fixtures](https://fantasy.premierleague.com/api/fixtures/). All current clubs have exactly **one fixture in each of GW6, GW7 and GW8**. Club badge codes plus the header GW therefore identify one current fixture. The provider does not publish fixture identifiers, so this is a verified join to today's schedule, not a promise about later double/blank gameweeks or rearrangements. Validate that join again at every capture.

The matcher already resolves `J. Pedro` and `K. Mitoma` through guarded aliases. Two additional identities were inspected directly in the official pool but **not added to production**:

- `Y. Pino`: official ID **211**, stable player code **488024**, CRY/club code 31, MID; first/second names **Yéremy Pino Santos**, web name **Yeremy**. Palace's [current official player profile](https://www.cpfc.co.uk/teams/first-team/y-remy-pino/) confirms Yéremy Pino. A documented exact alias can be guarded by stable code, current club and position.
- `Savinho`: official ID **403**, stable code **510281**, TOT/club code 6, MID; official name **Sávio Moreira de Oliveira**, web name **Sávio**. Spurs' [official August 2026 profile](https://www.tottenhamhotspur.com/news/1087070/from-the-farmyard-to-premier-league-this-is-savios-story) explicitly explains the return from the Savinho name to Sávio after his move. The [Premier League profile](https://www.premierleague.com/en/players/510281/savinho/career) uses the same stable player code. This supports a guarded documented alias, without general fuzzy matching.

Season is not explicitly provided in the files. The current club/identity matches and GW6–8 labels are consistent with 2026/27, so retain `season_inferred: true`.

## Consistency and actual point exports

The next-GW and three-GW tables do not produce identical GW6 components. Among matched overlaps, the largest absolute difference is **0.03 goals** and **0.02 assists**. Preserve them as distinct provider series with individual hashes and timestamps. For example, Haaland's GW6 goal count is 0.58 in the next-GW view and 0.56 in the three-GW goals view. These differences exceed a single-cell rounding error; the reason is not documented. Do not silently overwrite one series with the other.

No numerical FPL-point export was found in these three actual datasets, the previously inspected attacking baselines, or Fast Fantasy Model. Fast Fantasy's use of Review Massive Data does not expose the underlying per-GW point matrix. This is a bounded statement about the inspected published views, not proof that no other authorised export exists.

## Recommended integration

The most useful new inputs are the **labelled conditional-on-start goal and assist counts**, especially the broader next-GW view and the explicit three-GW component cells. They provide real fixture context that the average-opponent baseline and importance ranking do not.

First extend `reference_data` with separate `next_gw_attack`, `three_gw_goals` and `three_gw_assists` series, using the existing optional source cache/archive/provenance workflow. Preserve provider name, current ID match evidence, header GWs, conditional-start flag, unknown duration, missing components, HTTP Last-Modified and source hash. Keep rejected rows as diagnostics. Use the same narrowly guarded alias process for any approved additional identities.

For a subsequent forecasting experiment, these may anchor **attacking event components**, while Open FPL supplies availability, cameos, clean sheets, bonus and the remaining scoring events. That requires a stated assumption about what “starts” includes and an explicit start/cameo probability model. Current appearance probability alone does not identify start probability. Multiplying these counts by appearance probability, treating them as per-90 rates, or adding goal/assist scoring multipliers and calling the result total expected points would hide those gaps.

Keep such a blend opt-in until it is captured before deadlines and evaluated against the current component model and FPL Form on the same player/GW cohort. Preserve the two near-term series separately so their prospective evidence can choose a source precedence or blend; do not choose weights from these current in-sample comparisons. Longer-range extrapolation can subsequently fade separately for goals and assists through the existing fixture model, with its assumptions and extrapolated weeks labelled.

# Open FPL

A free, local-first Fantasy Premier League planner with real forecasts, a constrained multiweek optimiser and an honest evaluation view. The dark navy/orange interface takes visual cues from Solio, with original Open FPL branding and code.

## Run

Requires Python 3.11+ and Node 20.19+ / 22.12+. Tested here on Python 3.11.9 and Node 24.13.1.

From this folder in PowerShell:

```powershell
./start.ps1
```

This checks Python/Node versions, installs missing or changed dependencies, rebuilds missing or outdated production files, and serves the app at **http://127.0.0.1:8000**. The API stays running in the background after the command returns. Its logs and process record are under ignored `data/cache/runtime/`.

`./start.ps1 -Install` reinstalls dependencies. `./start.ps1 -Rebuild` forces a production rebuild; `./start.ps1 -Restart` restarts an API started by this script. Routine startup also refreshes its own API when backend files have changed. Unfamiliar processes are never stopped. If an older API was started manually, restart its original terminal before retrying; the script reports an outdated or API-only server instead of silently returning a stale app.

For development, run the API and frontend in separate terminals:

```powershell
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

```powershell
npm run dev
```

The development app is **http://127.0.0.1:5173**. `./start.ps1 -Development` checks dependencies, starts a hidden API helper if port 8000 is free, then runs Vite in the current terminal. An existing Vite instance for this checkout is detected; dependency or Vite configuration changes require restarting that terminal. No cloud service or paid subscription is required. Data access failures are shown, with labelled cached fallbacks where available.

## What works

- Connected scenario/gameweek canvas beside Lineup, Projections, Optimise, Plans and Fixtures, with a compact mobile branch selector and scrolling GW cards.
- Current official players, prices, fixtures, news, defensive contributions and price signals.
- Player forecasts through GW38, with per-event breakdowns, minutes scenarios, blank/double fixtures and provenance.
- Per-gameweek conditional minutes and availability assumptions, including user-defined recovery schedules. Scheduled weeks take priority over provider/CSV points.
- Per-gameweek player stat scenarios for expected points, xG, xA and clean-sheet probability, with the original forecast preserved for comparison. These human assumptions apply after provider/CSV calibration and carry an explicit scenario label.
- Public FPL Form player forecasts for the next five GWs, blended at a configurable weight. Longer-range player adjustments follow future fixtures and fade toward the component baseline; direct and extrapolated weeks are labelled. Team inputs use near-term FPL Joe markets and the full-season Elevenify sheet.
- Public FPL team-ID import, bank / FT adjustments, legal squad and formation checks, captain and vice-captain selection, bench swaps and bench priority. Expected totals include formation-aware autosubs and vice fallback under an explicit independent-appearance approximation.
- Transfers across future GWs, profit-aware selling prices, hits, 5-FT carryover, and Wildcard / Free Hit / Bench Boost / Triple Captain planning. Free Hit restores the permanent squad and bank. Current prices are held fixed.
- Named independent planning branches and forecast/solver settings saved in browser storage; export/import of validated plan files, copyable backup text and paste import. After a GW advances, expired decisions are archived and remaining plans recover using saved permanent holdings, bank, FTs and purchase receipts. Legacy missing receipts have a labelled fallback.
- A SciPy / HiGHS MILP solver through GW38, with global and per-week player locks/exclusions, captain locks, per-week transfer limits, budget, position and club limits, transfer costs, FT retention value, time decay and ownership preference. Solver results are reviewed before becoming a new branch. Long solves have a bounded time limit and disclose the feasible incumbent, candidate pool and optimality gap; a full-season request does not guarantee proven optimality.
- Automatic Triple Captain/Bench Boost placement within a fixed validated plan, preserving manual chips and first/second-half allowances. Save the result as a separate branch. A separate bounded Wildcard/Free Hit search reoptimises sampled legal placement weeks against a frozen baseline, with progress, cancellation and validated branch adoption. It searches one chip allowance at a time; [search scope and API](docs/CHIP_STRATEGY_CONTRACT.md).
- Timestamped fixture-market history and movement graphs, with source/time filters, explicit missing/single-snapshot states and local exports. Player scenarios do not change sourced market observations.
- Plans insights for matched-GW holding comparisons, weaker starters, points components, expected bench/fallback contributions, FT/bank pressure and player/club exposure. Ownership uses official selection percentages; appearance estimates are independent and uncalibrated.
- Background strategy stress tests with seeded assumptions, progress/cancellation, transfer/captain frequencies, JSON reports and separate validated branches. The variation is user-defined, not calibrated uncertainty.
- Searchable/sortable/filterable player projections, watchlists, fixture heatmaps, captain comparisons, player history, and explicitly uncalibrated event simulations.
- CSV model import/blending, CSV export, official transfer/price view, historical benchmark charts, immutable forecast snapshots and a prospective scoring command.
- Elevenify's five selected-player references under Market → Provider shortlists: average-opponent baselines, importance/captain ranks, next-GW attack and three-GW goals/assists. View supplied weeks with start conditioning, coverage, extraction times and hashes; export the selected series. These references remain separate from points forecasts.
- Responsive mobile planning, including branch switching.

Plans do not submit transfers to FPL. Local data caches and vendor payloads are ignored by Git. The original World Cup research and StatsBomb folders are preserved.

## CSV format

Point forecasts use `player_id,gameweek,expected_points`. FPL Review-style wide exports (`ID,6_Pts,7_Pts,…`) and FPL Form exports (`ID,6_with_prob,…`) are also accepted. Use **current official FPL numeric IDs**, not IDs from previous seasons or other providers. Duplicate player/GW rows are rejected; sum fixture forecasts for doubles before importing.

A weight blends matched forecasts. With extrapolation enabled, later weeks carry a player-level adjustment through the future fixture schedule. The adjustment's default half-life is six GWs; both weight and half-life are configurable. Blank weeks remain zero. This is a declared heuristic, not a verified reconstruction of the provider's hidden model. CSV xMins columns are not silently treated as conditional minutes.

Weekly scenarios use `player_id,gameweek,conditional_minutes,availability`. Supply at least one of duration (0–90) or availability (0–1); `0` remains a valid value. Availability requires a gameweek, and duplicate player/GW scenarios are rejected. `player_id,conditional_minutes` remains the legacy all-horizon format. Conditional duration is distinct from the model's unconditional `expected_minutes` export column. Scheduled weeks bypass provider/CSV blends; other weeks retain normal calibration. Uploaded points do not change underlying xG/xA components or simulation distributions. The app labels the imported adjustment.

Player stat edits are separate planning scenarios. xG and xA are unconditional gameweek totals, including all fixtures in a double gameweek; clean-sheet probability applies to each fixture and still respects the player's 60-minute appearance state. Blank weeks stay zero, and positive points/attack edits cannot restore a player with zero appearance probability without a minutes/availability edit. A direct points edit appears as a separate adjustment in the scoring breakdown. Unedited player-weeks stay unchanged. API fields, ranges, provenance and per-week optimiser constraints are documented in [docs/BACKEND_CONTRACT.md](docs/BACKEND_CONTRACT.md).

## Evaluation

```powershell
python -m backend.evaluate
```

The fixed 2025/26 holdout uses 2023/24–2024/25 for ML fitting; player and team feature states update only after an entire gameweek. No held-out final-season aggregates, same-GW outcomes or current market data enter those forecasts. The resulting report is `data/evaluation.json`, shown in Analysis. Assistant manager rows are excluded from the player game. Sample selection uses projected minutes, not observed minutes.

The component model supplies the base forecasts; the ML challenger was weaker on this holdout. The **default live forecast also blends FPL Form at 50%**, then extrapolates its adjustment beyond the supplied weeks. The historical benchmark does not test this live ensemble. A small component-model improvement over an appearance-adjusted points-per-game baseline is encouraging, not evidence of paid-provider superiority.

```powershell
python -m backend.prospective
python -m backend.prospective --watch
python -m backend.prospective --score
python -m backend.prospective --cached
```

The first command refreshes live inputs and saves a strictly pre-deadline snapshot from one frozen dataset. It preserves component/live forecasts through GW38 and raw FPL Form points only where supplied. `--watch` repeats every 15 minutes while running; it does not install a Windows scheduled task. `--cached` skips refresh and records existing extraction ages. Source-freshness eligibility uses a declared 30-minute extraction policy; refetching is not proof of a provider's publication time.

New snapshots are compressed `.json.gz` files under ignored `data/snapshots/`. Both scoring views retain support for older plain JSON archives; raw vendor payloads are not committed.

`--score` compares the latest next-GW capture for each **completed** gameweek. The cohort uses captured component projected minutes of at least 45, never observed appearances. Each provider-versus-live comparison uses identical player IDs and reports missing coverage. A separate Analysis lead-time scorer selects the latest valid capture per target GW in six fixed windows: under 24 hours, 1–3 days, 3–7 days, 1–2 weeks, 2–4 weeks and 4+ weeks. Target deadlines, fixture membership, source receipts and configuration are frozen. Changed deadlines and stale/legacy inputs stay visibly exploratory; unchecked/pending outcomes produce no fabricated score. Aggregate errors weight individual matched player-GW rows. Different windows may have different cohorts and reuse outcomes, so their metrics alone do not establish that accuracy improves nearer the deadline.

## Checks

```powershell
python -m pytest backend/tests -q
npm test
npm run build
python tools/verify_forecast_coverage.py
```

The checks cover squad legality, scoring, sale rounding, transfer hits, FT caps, Free Hit restoration, weekly constraints, stat scenarios, chip placement, saved-state recovery, source blending and strictly pre-deadline evaluation. The separate coverage script checks every current player in every remaining GW, fixture membership, component totals, blank weeks and provenance against the running API; it writes an ignored report under `data/`.

Research and build plan: [docs/PLAN.md](docs/PLAN.md). Model derivation and limits: [docs/MODEL.md](docs/MODEL.md). Provider access findings: [docs/PROVIDER_ACCESS.md](docs/PROVIDER_ACCESS.md). Current handover and verification: [docs/STATUS.md](docs/STATUS.md).

## Attribution and scope

Official player/fixture data: [Fantasy Premier League](https://fantasy.premierleague.com/). Archived player-fixture data: [vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League). Team expectations: [FPL Joe](https://www.fpljoe.com/) and [Elevenify](https://www.elevenify.com/p/premier-league-data). Player forecast input: [FPL Form](https://www.fplform.com/export-fpl-form-data). Methodology reference: [FPL Review](https://docs.fplreview.com/). Visual reference: [Solio Analytics](https://solioanalytics.com/).

Vendor forecast caches are for this personal project. Public access is not a redistribution licence. Hosted accounts, cross-device syncing, press-conference ingestion and a verified head-to-head paid-model benchmark are future work, not features claimed by this local build.

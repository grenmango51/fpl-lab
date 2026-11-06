# Open FPL

A free, local-first Fantasy Premier League planner with real forecasts, a constrained multiweek optimiser and an honest evaluation view. The dark navy/orange interface takes visual cues from Solio, with original Open FPL branding and code.

Personal website: **https://open-fpl.hoaianh517.workers.dev**. Cloudflare serves the site and private Google sign-in; the existing Ubuntu server runs forecasting/optimisation and shared plan storage. See [hosted setup and operations](docs/HOSTED.md). No additional hosting subscription is used.

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
- Named independent planning branches and forecast/solver settings saved in browser storage, with shared server saving on the hosted installation, revision checks and daily backups; export/import of validated plan files, copyable backup text and paste import. After a GW advances, expired decisions are archived and remaining plans recover using saved permanent holdings, bank, FTs and purchase receipts. Legacy missing receipts have a labelled fallback.
- A SciPy / HiGHS MILP solver through GW38, with global and per-week player locks/exclusions, captain locks, per-week transfer limits, budget, position and club limits, transfer costs, FT retention value, time decay and ownership preference. Solver results are reviewed before becoming a new branch. Long solves have a bounded time limit and disclose the feasible incumbent, candidate pool and optimality gap; a full-season request does not guarantee proven optimality.
- Short solves start from checked legal incumbents. The left quick action uses up to five budget seconds for short plans; the full workspace offers 2–45 seconds, Auto transfer limits and a Max XI points objective. [Five-week Solio benchmark, reproducible runner and feature gaps](docs/SOLIO_OPTIMISER_BENCHMARK.md).
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

`python -m backend.fit` refits the version 0.3 sub-models from archived seasons and rewrites `backend/model_params.json`. The evaluation refits them on 2023/24–2024/25 only, then walks forward through 2025/26; player and team feature states use earlier gameweeks only, and availability uses the archived flags from before each deadline. No held-out final-season aggregates, same-GW outcomes or current market data enter those forecasts. The resulting report is `data/evaluation.json`, shown in Analysis. Assistant manager rows are excluded from the player game. The main cohort is recent starters (2 of the last 3 fixtures started), which does not depend on either model.

The headline metric is RMSE: expected points are means, and MAE rewards predicting the median of skewed FPL scores. The report also scores appearance probabilities (log loss and Brier, by flag level), picks each forecast's best legal £100m squad per gameweek and scores its actual points, and gives gameweek-resampled 95% intervals for every difference.

The component model supplies the base forecasts and is compared with the previous version 0.2 rules on identical player-fixtures. The **default live forecast also blends FPL Form at 50%**, then extrapolates beyond its supplied weeks. When enabled, validated Solio cells replace supplied points; the complete signed-in five-week window also anchors labelled local projections for later weeks. The public shortlist never anchors extrapolation. Version 0.2 adds fixture-date availability and separates appearance from provider scoring calibration; see [MODEL](docs/MODEL.md). The historical benchmark does not validate these live changes or establish paid-provider accuracy.

```powershell
python -m backend.prospective
python -m backend.prospective --watch
python -m backend.prospective --score
python -m backend.prospective --cached
```

The first command refreshes live inputs and saves a strictly pre-deadline snapshot from one frozen dataset. It preserves component/live forecasts through GW38 and raw FPL Form points only where supplied. `--watch` repeats every 15 minutes while running; it does not install a Windows scheduled task. `--cached` skips refresh and records existing extraction ages. Source-freshness eligibility uses a declared 30-minute extraction policy; refetching is not proof of a provider's publication time.

New snapshots are compressed `.json.gz` files under ignored `data/snapshots/`. Both scoring views retain support for older plain JSON archives; raw vendor payloads are not committed.

`--score` compares the latest next-GW capture for each **completed** gameweek. The cohort uses captured component projected minutes of at least 45, never observed appearances. Each provider-versus-live comparison uses identical player IDs and reports missing coverage. A separate Analysis lead-time scorer selects the latest valid capture per target GW in six fixed windows: under 24 hours, 1–3 days, 3–7 days, 1–2 weeks, 2–4 weeks and 4+ weeks. Target deadlines, fixture membership, source receipts and configuration are frozen. Changed deadlines and stale/legacy inputs stay visibly exploratory; unchecked/pending outcomes produce no fabricated score. Aggregate errors weight individual matched player-GW rows. Different windows may have different cohorts and reuse outcomes, so their metrics alone do not establish that accuracy improves nearer the deadline.

## Solio capture and automatic refresh

Settings → Forecast inputs has an automatic-refresh switch, interval selector (default **30 minutes**) and **Use available Solio predictions** switch. The API refreshes live inputs while running, and an open browser adopts newer data without replacing saved squad/transfer decisions. Manual minutes and stat assumptions retain precedence. Refresh settings persist on the API host; forecast preferences persist with the browser's plan configuration.

Every scheduled acquisition now freezes both full-season forecast configurations (with/without Solio anchoring), including targets outside the observed window. Raw source points remain separate from extrapolated cells. GW13 is the next frozen agreement test; the target is 95% of matched forecasts within one point, with outlier and top-pick checks. Development replays are not prospective results. Reproduce an archived-input diagnostic with `python tools/replay_forecast.py BASELINE OBSERVATION --archive-root ORIGINAL_CHECKOUT --output NEW_REPORT.json`; it refuses to overwrite a report and never fetches current data.

The server now reads Solio's **signed-in free five-week planner**, using the existing dedicated Ilmari Chrome login. Current supplied coverage is **562 purchaseable players across GW8–12**; Solio omits 105 unpurchaseable players, and newly listed official players may not yet appear there. These omissions are disclosed separately and retain local forecasts, as do GW13–38 forecasts. The helper reads every virtual Points-table row and validates identities, coverage, the exact GW window, unchanged Base Scenario inputs and a live source sync. Provider publication time is unknown; extraction does not invent it.

The optional helper needs a Python interpreter with `playwright` installed and an existing signed-in dedicated Chrome session with a loopback debugging endpoint. The server is already configured. Local configuration lives in ignored `data/cache/solio-browser.json`, with `enabled`, `python` (absolute interpreter path) and `cdp_url` (for example `http://127.0.0.1:9222`). It opens/closes its own tab and keeps account credentials in Chrome. Failed/expired access falls back to the [public next-GW shortlist](https://fpl.solioanalytics.com/api/data/latest.json), then local forecasts for missing cells. The public report's advertised four-hour cadence does not establish the signed-in planner's update cadence.

Each successful refresh saves usable pre-deadline Solio observations under ignored `data/snapshots/solio/`, with all supplied target weeks/deadlines, raw provider points, stable identities, source receipts and an independent Open FPL forecast calculated **without Solio**. The main full-season snapshots also keep available raw Solio cells, without backfilling other weeks. Agreement after direct replacement is not an independent benchmark; the independent observations are separate from the existing prospective scorer. Compare earlier frozen predictions with later Solio observations for a long-range test.

The server's persistent one-minute timer uses the configured acquisition interval, including when the API is closed:

```bash
python -m backend.live_updates --interval 30
python -m backend.live_updates --tick
python -m backend.live_updates --disable
```

The installed unit definitions are in `deploy/open-fpl-live-updates.*`. On the server they run this checkout; the older GW12 checkpoint campaign at `/home/user/projects/fpl-lab` remains separate. On Windows the API worker runs while the app is running; no Windows scheduled task is installed by these commands.

## Checks

```powershell
python -m pytest backend/tests -q
npm test
npm run build
python tools/verify_forecast_coverage.py
```

The App saved-plan regressions use real in-process FastAPI receipts without starting a server. `npm test` uses `.venv` when present; set `FPL_TEST_PYTHON` to use another Python environment with the backend dependencies installed.

The checks cover squad legality, scoring, sale rounding, transfer hits, FT caps, Free Hit restoration, weekly constraints, stat scenarios, chip placement, saved-state recovery, source blending and strictly pre-deadline evaluation. The separate coverage script checks every current player in every remaining GW, fixture membership, component totals, blank weeks and provenance against the running API; it writes an ignored report under `data/`.

Research and build plan: [docs/PLAN.md](docs/PLAN.md). Model derivation and limits: [docs/MODEL.md](docs/MODEL.md). Provider access findings: [docs/PROVIDER_ACCESS.md](docs/PROVIDER_ACCESS.md). Current handover and verification: [docs/STATUS.md](docs/STATUS.md).

## Attribution and scope

Official player/fixture data: [Fantasy Premier League](https://fantasy.premierleague.com/). Archived player-fixture data: [vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League). Team expectations: [FPL Joe](https://www.fpljoe.com/) and [Elevenify](https://www.elevenify.com/p/premier-league-data). Player forecast input: [FPL Form](https://www.fplform.com/export-fpl-form-data). Methodology reference: [FPL Review](https://docs.fplreview.com/). Visual reference: [Solio Analytics](https://solioanalytics.com/).

Vendor forecast caches are for this personal project. Public access is not a redistribution licence. The hosted installation remains private to the configured owner accounts. Press-conference ingestion, public multi-user hosting and a verified head-to-head paid-model benchmark remain future work.

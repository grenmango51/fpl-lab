# Fixture market history contract

Integration entrypoints (no model/scenario inputs):
- `backend.market_history.market_history(*, gameweek=None, team=None, source=None, since=None, until=None, fixture_id=None, roots=None)` returns JSON-safe history.
- `backend.market_history.capture_market_history()` records already acquired public cache inputs into ignored `data/history/market/`; no network refresh. GET also reads content-addressed raw archives. Wire GET `/api/market-history` with optional integer gameweek/fixture_id, club-code team, source (`fpljoe`/`elevenify_sheet`), timezone-aware ISO since/until. Invalid filters raise ValueError (HTTP 422).
- POST `/api/market-history/capture` calls capture helper; this does not imply a fresh provider fetch.
- Frontend `MarketMovement({gw}: {gw:number})` is self-contained, imports its own `MarketMovement.css`, fetches endpoint, offers filters and local JSON/CSV export. Root can render next to FixtureMarkets. No Bootstrap/type changes required.

Response: `series` rows have `season, fixture_id, gameweek, home, away, team, source, metric` (`goals` or `clean_sheet_probability`), `unit` (`goals` or `percentage_points`), `points` with `extracted_at, provider_at, provider_time_kind, value, sha256, mapping_sha256, fixture_mapping_sha256`; values are goals or CS percent, not fractions. Each row has `latest, previous, delta, state` (single_snapshot/comparable/missing_latest). `coverage` reports snapshots, fixtures, series, comparable series, teams, gameweeks, time span. `diagnostics` contains count-only exclusion reasons. No raw payloads/filesystem paths returned.

Comparability: same season + official fixture ID + home/away/current club codes + source + metric + units; each observation must map against official fixture/bootstrap archives available by extraction time. Elevenify GW totals become fixture observations only for a unique single fixture for that club/GW. Missing values stay null. Same hash repeats do not create movement; source archives retain first extraction rather than invent repeated publication. Filters constrain comparison window. Provider timestamps are distinct from extraction time; unknown provider time stays null. No player scenarios or historical model fallbacks enter history.

Implementation and verified coverage will be recorded below.

## Verified delivery, 2026-10-13

- Files: backend helper + ten offline tests; self-contained MarketMovement.tsx and MarketMovement.css. Root owns routes, App integration and browser verification. No server restart/browser interaction/solver tests were performed by this worker.
- Local read-only reconstruction uses current data plus the previous D: data folder by default. `roots=[Path(...)]` overrides data roots for tests/tools. Prior originals were not changed. If the previous folder becomes unavailable, its extra archives become unavailable; no fake backfill is substituted.
- 15 usable distinct public payloads (14 Joe, one Elevenify sheet), 380 official fixtures, 20 clubs, all GW1?38. 3,040 metric series: 1,520 sheet series are single snapshots; Joe has 320 comparable series (GW1?8) and 1,200 series with missing latest values (GW9?38). **No nonzero Joe changes are observed in these archived values.** Different whole-feed hashes can carry the same fixture snapshot; these are observed unchanged values, not independent provider updates.
- Extraction span: 2026-10-02T15:48:10.632257Z to 2026-10-13T04:56:58.877144Z. One earliest Joe archive lacks an already-acquired official mapping and is excluded. No provider embedded 12/24/48-hour comparison values are backfilled into a timeline without independently archived timestamps.
- GW7 check: ten fixtures, all 20 clubs, 40 Joe comparable metric series and 40 sheet single-snapshot metric series. The full-season sheet is a GW aggregate; unique single-fixture mappings only, doubles/blanks excluded.
- Comparisons use the previous **available** observation in the selected extraction window; an unavailable latest value disables delta. Graph lines do not bridge explicit missing observations. Snapshot kind is retained as `provider_time_kind` (`fixture_snapshot` / `http_last_modified`); missing provider/HTTP times stay null.
- Verified: `python -m pytest backend/tests/test_market_history.py -q`: 10 passed. `npm test`: 55 passed. `npm run build`: passed; TypeScript checked again after final UI changes. Full backend/coverage/browser checks belong to integration because the native solver worker is active.

- Capture helper executed once against current laptop caches: four receipts saved into ignored data/history/market, fresh_fetch=false; reconstruction coverage unchanged.

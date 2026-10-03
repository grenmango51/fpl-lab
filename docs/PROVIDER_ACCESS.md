# Provider access and integration

Initial research 2026-10-02; updated **2026-10-03, Europe/Kiev**, with the primary agent's confirmed assigned-browser findings. A free Elevenify/Substack signup revealed its normal published forecast embeds. The HTTP verification below used those exact embeds and their declared public assets, without transferring any browser credentials or cookies. Ilmari Chrome was already connected to Patreon for FPL Review, without premium membership; no new Review account was needed. No paid subscription was purchased.

## FPL Review

The [Free Model documentation](https://docs.fplreview.com/the-model/projections/free-model/) describes a **three-gameweek** outlook with a simpler model and fewer solver capabilities than Massive Data. **The current free app observation showed four labelled weeks, GW6–9**, as confirmed in assigned Ilmari Chrome during the 2026-10-03 update. Retain that distinction between published documentation and the observed current interface; it does not establish a permanent four-week entitlement.

Massive Data remains a separate premium model, documented with an outlook up to 14 weeks, hourly refreshes and pre-deadline news updates. No MDM access or point export was acquired. These are provider descriptions, not an independent accuracy assessment. [Massive Data documentation](https://docs.fplreview.com/the-model/projections/massive-data-model/)

The [official login guide](https://docs.fplreview.com/the-site/logging-in/) permits an ordinary Patreon account without an active FPL Review subscription for saving team ID/settings. The assigned profile was already Patreon-connected, so the primary agent opened the [free app](https://app.fplreview.com/free) and loaded public sample team ID **1**. Its Projections view contained **50 DOM player rows**, sorted by total, with **one-decimal** displayed points for GW6–9. The table may be virtualised; this observation does not establish the full player pool, full-precision values or a complete forecast matrix.

**The normal CSV action was verified as premium-gated.** Clicking **Export to CSV** opened a **Premium Feature** dialog explaining that downloading the complete dataset requires premium. The dialog was dismissed with **Maybe Later**. No CSV was downloaded or imported. This agrees with the [premium feature list](https://docs.fplreview.com/getting-started/premium-features/), which lists data export as a premium benefit.

Visible free forecasts remain a possible authorised reference, with recorded display precision and player/GW coverage. No documented anonymous complete-player export endpoint was found in the reviewed primary sources. That is a bounded research finding, not proof that none exists.

For an export obtained through authorised access, the [export guide](https://docs.fplreview.com/the-model/planner-interface/export_projections/) describes FPL IDs, player details, buying/selling prices, EV and xMins, with separate GW columns. Its scope follows the current table filters. The [upload/template guide](https://docs.fplreview.com/the-model/planner-interface/upload_projections/) documents `Pos`, `ID`, `Name`, `BV`, `SV`, `Team`, `GW_xMins`, `GW_Pts`, and `Elite%`; only `ID` and `GW_Pts` are required. Here `GW` means the numeric gameweek, for example `6_Pts`.

Open FPL already accepts `ID` with numeric `GW_Pts` columns. Review's unconditional expected minutes must not be relabelled `conditional_minutes`. The current importer intentionally does not make that conversion.

## Elevenify

The [Premier League data page](https://www.elevenify.com/p/premier-league-data), dated 2026-03-13 and checked 2026-10-02, states that access is free. Anonymous visitors can see match/team/rating embeds; **Player Predictions** and **Fast Fantasy Model 2.0** show a free-subscriber gate. The page promises a free Google Sheet of team goals and clean sheets for GW1–38, and says predictions update after each gameweek's final fixture.

Free signup is now complete. The signed-in page revealed Player Predictions at `https://datawrapper.dwcdn.net/tDC0G/2/` and Fast Fantasy Model at `https://datawrapper.dwcdn.net/MmYOs/17/`.

Fast Fantasy Model incorporates FPL Review Massive Data predictions adjusted to Elevenify team strengths. The actual released table is an importance ranking, as verified below; that lineage does not provide complete Review MDM player forecasts.

The revealed embeds and their ordinary links expose **five** declared, publicly readable player-reference CSVs. None supplies per-gameweek FPL expected points. Older-season articles and World Cup tables are not current FPL inputs.

### Published Datawrapper access

The two supplied embed pages returned HTTP 200 with explicit JavaScript/meta-refresh redirects, which were followed without guessing versions: `tDC0G/2/` → `tDC0G/4/` → [tDC0G/5](https://datawrapper.dwcdn.net/tDC0G/5/), and `MmYOs/17/` → `MmYOs/21/` → [MmYOs/22](https://datawrapper.dwcdn.net/MmYOs/22/). Their published HTML declares the CSV `externalData` URLs used below.

Datawrapper's [official external-data guide](https://www.datawrapper.de/developer/connecting-to-external-data-sources) documents `externalData` as the URL the published chart reads, with `https://static.dwcdn.net/data/{CHART_ID}.csv` used when the publisher enables its CDN. These are normal chart assets. The [authenticated chart-data API](https://www.datawrapper.de/developer/reference/get-charts-id-data) instead requires `chart:read`; it is unnecessary here. Both charts also declare upstream Google export URLs, but those specific upstream requests returned HTTP 401 and were not probed further. There was no visible enabled download link in the returned chart HTML; the declared published data assets nevertheless returned HTTP 200.

### Player attacking baselines

Verified [published CSV](https://static.dwcdn.net/data/tDC0G.csv) at **2026-10-02 18:38:24 UTC**; HTTP `Last-Modified`: **2026-10-02 11:01:15 UTC**. The chart describes outcomes conditional on the player starting against an average Premier League team. It does not specify a per-90 duration or a gameweek.

- 49 rows; headers: `Player`, an unnamed badge column, `Goal Baseline`, `Assist Baseline`, `Goal Involvement Baseline`.
- Goal range 0.22–0.70; assist range 0.09–0.34; goal-involvement range 0.42–0.89. All three fields are present for all rows. Do not assume goal involvement equals the sum of the other two fields.
- No FPL ID, position, price, availability or GW column. Team identity comes from the badge asset's Premier League club code, for example `t43.png`; this is not an FPL numeric team ID.
- 47/49 rows match uniquely using normalised name variants plus current official club code. Two explicitly checked aliases complete 49/49: `J. Pedro` → official ID 165 (CHE), `K. Mitoma` → ID 121 (BHA). The latter's official first/second names are stored in reversed order. No duplicate IDs or ambiguous matches remain.

CSV SHA256: `895ad01e000bd7948b9d89474dcd49a45e6ea86eb81c3bab2d76d3121e9a8831`.

### Fast Fantasy Model

Verified [published CSV](https://static.dwcdn.net/data/MmYOs.csv) at **2026-10-02 18:38:25 UTC**; HTTP `Last-Modified`: **2026-10-02 18:01:10 UTC**.

- 99 rows; headers: `Player`, `Team`, an unnamed badge column, `Position`, `Future Importance`, `GW6 Captaincy Option?`.
- `Future Importance` ranges 51–100; the page provides no point units, mathematical definition or forecast window for this score. It is not established as expected points or a probability.
- Positions: 10 GK, 36 DEF, 38 MID, 15 FWD. Five rows contain a captaincy star; the other 94 are blank. The GW6 label matches the current official next event.
- No FPL ID, price, xMins or numeric per-GW points. All 99 rows join uniquely to the current 667-player pool using name, club and position, with no team conflicts or duplicate IDs. Use `Team` for club matching when the badge is absent; Thomas and Pinnock are the two COV rows without a usable badge.

CSV SHA256: `27a5c8d233f8f7610e32ca6ee0bd84080c78feaf40a73f3b3909f4a04255a1cb`.

The current club/position matches and GW6 caption establish compatibility with the live 2026/27 pool, but neither file explicitly labels its season. Chart `lastModifiedAt` is a chart-edit timestamp, not the live CSV freshness timestamp. Preserve fetch time, HTTP Last-Modified and source hash separately.

### Fixture-specific attacking views now integrated

The baseline chart's actual links led to three additional normal declared assets:

- [Next-GW goals, assists and involvement](https://static.dwcdn.net/data/YmfDr.csv): **99/99** current players matched, with explicit **GW6** component headers.
- [Three-GW goals](https://static.dwcdn.net/data/ALYf8.csv): **49/49** matched, with separate **GW6, GW7 and GW8** counts and a total.
- [Three-GW assists](https://static.dwcdn.net/data/VK19h.csv): **49/49** matched, with separate **GW6, GW7 and GW8** counts and a total.

All three descriptions assume the player **starts**. Their duration and start probabilities are unspecified, and an identical FPL fantasy-assist definition is not established. Current official fixtures contain one match per club in each supplied GW; future doubles/rearrangements need fresh checks.

The implementation skips only leading all-empty CSV rows, validates labelled windows/counts, and guards aliases by identity/club/position; the new Pino/Savinho aliases additionally require their verified stable player codes. Original GW headers remain intact when stale. Each series retains its own provenance because next-GW and three-GW values differ on the same GW. No conditional count becomes a per-90 rate, availability probability or total expected-points forecast.

All **five feeds** are integrated as optional references: **176 unique players**, of whom **112 have fixture-specific attacking views**, from the current 667-player pool. Baseline and importance coverage remain 49 and 99. Missing players/components are unavailable rather than zero. Market displays separate series and source coverage; references do not modify numerical forecasts. Full access, schemas, conditioning, timestamp/hash evidence and alias sources are documented in [ELEVENIFY_FIXTURE_VIEWS.md](ELEVENIFY_FIXTURE_VIEWS.md).

## Already accessible team export

The existing `backend/data.py` legitimately reads the public [Elevenify Google Sheet CSV](https://docs.google.com/spreadsheets/d/1rJaMd03-t5ovug0Zn8fY9jJ1_H0C8PDSC10HqbdwSyk/export?format=csv&gid=0), whose source link was discovered in FPL Joe's public attribution metadata. It parses two tables, matches all club codes to the current official season, and validates goal/clean-sheet ranges. This provides **team** expectations, not player expected points. Existing source timestamps and ignored local caches should remain the provenance record.

## Integration decisions

1. Preserve the implemented five-feed Elevenify references as distinct analytical series, including inferred season, extraction time, HTTP Last-Modified, ID/club matches, missing rows, units and source hash. Normal bounded refresh/cache handling records stale, invalid and unavailable sources.
2. Review's free view and premium export gate are now confirmed. Any future authorised visible-value capture must record its one-decimal display precision, actual player/GW coverage and extraction time. No premium dataset or MDM access is claimed; FPL Form remains the working direct points feed.
3. For a points export, map current FPL IDs and import `ID,<gw>_Pts` or `player_id,gameweek,expected_points`. Sum fixture rows before importing doubles, preserve blanks, and retain unavailable weeks as unavailable. A ranking, baseline goals/assists rate, star marker or multiweek aggregate is not a per-player/per-GW point forecast.
4. Treat Review and Elevenify Fast Fantasy as related inputs. Additional weight on both can double-count the same MDM information; record their lineage and compare on the same pre-deadline player cohort before tuning weights.
5. Continue the existing fading anchor extension beyond supplied weeks, visibly marking extrapolations. Longer coverage alone does not establish better accuracy. Public/free viewing does not establish a redistribution licence; keep source datasets local until hosting rights are settled.

**Forecast recommendation:** keep FPL Form as the directly verified player/GW points anchor. Do not feed `Future Importance` into the points importer or divide it into fabricated GW values. Fixture-specific counts are stronger attacking references than an average-opponent baseline, but an optional event-component blend needs explicit start/cameo and duration assumptions, separate source handling and prospective evaluation before becoming a default forecast.

The capture endpoint now freezes available future targets with target-specific receipts. Fixed lead-time bins and matched model comparisons are implemented, with pending coverage and separate primary/exploratory results. Future-GW outcomes remain pending; neither wider capture coverage nor borrowed inputs establishes competitive accuracy. See [STATUS.md](STATUS.md) for verification rather than treating this access note as benchmark evidence.

## Five-week FPL Form correction and Solio workflow

The normal FPL Form form supports a selectable GW range. Our former three-week request was a local cap. On 2026-10-03, POST fields firstgw=6, lastgw=10, all=1 and submit=submit returned 667 current players with explicit GW6–10 point/probability headers. The default importer now requests five weeks, clips at GW38 and preserves absent headers/cells rather than supplying fabricated zeroes. A fresh pre-deadline archive records all 33 future targets, with raw provider values only in the five supplied weeks. Historical ML training remains unchanged. [Official export](https://www.fplform.com/export-fpl-form-data).

The authorised Solio free account was tested with entry 2200722, including default optimisation, draft comparison and projected lineup changes. Its official optimiser demo was inspected. Solio's newly advertised anonymous report has a next-GW shortlist (57 unique matched players), not a complete five-week matrix. It remains a research reference rather than a production forecast source. [Scope, UI observations and limitations](SOLIO_UX.md).

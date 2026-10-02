# Provider access and integration

Verified 2026-10-02, Europe/Kiev. Initial research used primary public pages and the existing integration code. The primary agent subsequently completed a free Elevenify/Substack signup in the assigned Ilmari Chrome profile; the signed-in article confirmed access and revealed its normal published forecast embeds. The HTTP verification below used those exact embeds and their declared public assets, without transferring any browser credentials or cookies. No paid subscription was purchased. Review's signed-in export availability remains outstanding.

## FPL Review

The [Free Model](https://docs.fplreview.com/the-model/projections/free-model/) provides expected points over three gameweeks, with a simpler model and fewer solver capabilities than Massive Data. Massive Data is a separate premium model with an outlook of up to 14 weeks; its documentation describes hourly refreshes and pre-deadline news updates. These are provider descriptions, not an independent accuracy assessment. [Massive Data documentation](https://docs.fplreview.com/the-model/projections/massive-data-model/)

Free account access does **not** require a paid membership. The [official login guide](https://docs.fplreview.com/the-site/logging-in/) explicitly permits an ordinary Patreon account without an active FPL Review subscription, for saving a team ID and settings:

1. In the assigned browser, open [FPL Review](https://fplreview.com/) or the [current app](https://app.fplreview.com/) and choose Login/Connect with Patreon.
2. Use an existing Patreon account, or create a free Patreon account if needed. Follow the displayed authentication/authorisation flow.
3. Return to Review and inspect the Free Model. Do not select a paid tier merely to authenticate.

The current app shell could be reached anonymously, but this research did not obtain a full current player forecast response. No documented anonymous player export endpoint was found in the reviewed primary pages. This is a bounded finding, not proof that no such endpoint exists.

**CSV access is an unresolved free-tier limitation.** The [premium feature list](https://docs.fplreview.com/getting-started/premium-features/) lists data export as a premium benefit. The separate [export guide](https://docs.fplreview.com/the-model/planner-interface/export_projections/) describes export contents but does not establish free-tier permission. After login, verify whether a free CSV control is actually enabled; do not assume the three-week free outlook is automatically downloadable.

The export contains FPL ID, name, team, position, buying/selling prices, expected points and expected minutes, with separate gameweek columns. It covers the currently displayed table, so clear filters before exporting a complete pool. The [upload/template guide](https://docs.fplreview.com/the-model/planner-interface/upload_projections/) documents `Pos`, `ID`, `Name`, `BV`, `SV`, `Team`, `GW_xMins`, `GW_Pts`, and `Elite%`; only `ID` and `GW_Pts` are required. Here `GW` means the numeric gameweek, for example `6_Pts`.

Open FPL already accepts `ID` with numeric `GW_Pts` columns. Review's unconditional expected minutes must not be relabelled `conditional_minutes`. The current importer intentionally does not make that conversion.

## Elevenify

The current [Premier League data page](https://www.elevenify.com/p/premier-league-data), dated 2026-03-13 and rechecked today, states that access is free. Anonymous visitors can see match/team/rating embeds; **Player Predictions** and **Fast Fantasy Model 2.0** show a free-subscriber gate. The page promises a free Google Sheet of team goals and clean sheets for GW1–38, and says predictions update after each gameweek's final fixture.

Free signup is now complete. The signed-in page revealed Player Predictions at `https://datawrapper.dwcdn.net/tDC0G/2/` and Fast Fantasy Model at `https://datawrapper.dwcdn.net/MmYOs/17/`.

Fast Fantasy Model incorporates FPL Review Massive Data predictions adjusted to Elevenify team strengths. The actual released table is an importance ranking, as verified below; that lineage does not provide complete Review MDM player forecasts.

The revealed embeds' declared CSV assets are publicly readable. Neither of the two files contains per-gameweek FPL expected points. Older-season articles and World Cup tables are not current FPL inputs.

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

## Already accessible team export

The existing `backend/data.py` legitimately reads the public [Elevenify Google Sheet CSV](https://docs.google.com/spreadsheets/d/1rJaMd03-t5ovug0Zn8fY9jJ1_H0C8PDSC10HqbdwSyk/export?format=csv&gid=0), whose source link was discovered in FPL Joe's public attribution metadata. It parses two tables, matches all club codes to the current official season, and validates goal/clean-sheet ranges. This provides **team** expectations, not player expected points. Existing source timestamps and ignored local caches should remain the provenance record.

## Integration decisions

1. Integrate the revealed Elevenify CSVs as distinct analytical inputs: an attacking-baseline comparison and a ranked shortlist/captaincy reference. Save inferred season, extraction time, HTTP Last-Modified, ID/club matches, missing rows, units and source hash. Refresh normally with a bounded cache and record validation/fallback status. Do not turn absent players into zero forecasts.
2. Recheck Review free login and export availability separately. If no free CSV exists, use only legitimately visible values or an export obtained through an authorised account; retain the working FPL Form feed meanwhile.
3. For a points export, map current FPL IDs and import `ID,<gw>_Pts` or `player_id,gameweek,expected_points`. Sum fixture rows before importing doubles, preserve blanks, and retain unavailable weeks as unavailable. A ranking, baseline goals/assists rate, star marker or multiweek aggregate is not a per-player/per-GW point forecast.
4. Treat Review and Elevenify Fast Fantasy as related inputs. Additional weight on both can double-count the same MDM information; record their lineage and compare on the same pre-deadline player cohort before tuning weights.
5. Continue the existing fading anchor extension beyond supplied weeks, visibly marking extrapolations. Longer coverage alone does not establish better accuracy. Public/free viewing does not establish a redistribution licence; keep source datasets local until hosting rights are settled.

**Forecast recommendation:** keep FPL Form as the directly verified player/GW points anchor. Do not feed `Future Importance` into the points importer or divide it into fabricated GW values. Use Elevenify baseline values to inspect attacking-rate disagreements first; automatic event-component blending needs a verified duration/conditioning interpretation. The baseline chart links to actual next-GW goal involvement and three-GW goals/assists views, which are appropriate follow-up sources to inspect rather than extrapolating a ranking as points.

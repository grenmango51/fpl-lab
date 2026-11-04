"""Sourced Solio observations. Missing players/weeks never become zeroes."""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import unicodedata
from datetime import datetime, timedelta, timezone

from .capture import source_time

URL = "https://fpl.solioanalytics.com/api/data/latest.json"
SOURCE_KEY = "solio_public"
NAME = "Solio Analytics · public shortlist"
PLANNER_NAME = "Solio Analytics · signed-in planner"


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def normalise(value):
    return "".join(c for c in unicodedata.normalize("NFKD", str(value)).casefold() if c.isalnum())


def parse_report(report, players, teams, events, *, now=None):
    """Join exact name + club + position, validating the supplied GW deadline.

    The anonymous report has no stable IDs. Reject ambiguous names and
    conflicting duplicates, and never shift its next-GW labels forwards.
    """
    now = now or datetime.now(timezone.utc)
    result = {
        "name": NAME, "url": URL, "scope": "next-gameweek shortlist",
        "full_planner_connected": False, "players": {}, "matched_players": 0,
        "pool_players": len(players), "weeks": [], "rejected": [],
        "conflicting_ids": [], "status": "unavailable",
    }
    if not isinstance(report, dict):
        return result
    gw = report.get("gameweek")
    if isinstance(gw, bool) or not isinstance(gw, int) or not 1 <= gw <= 38:
        return {**result, "status": "invalid_gameweek"}
    event = next((e for e in events if e["id"] == gw), {})
    deadline = source_time(report.get("deadlineIso"))
    generated = source_time(report.get("generatedAt"))
    official = source_time(event.get("deadline_time"))
    result.update(gameweek=gw, deadline=report.get("deadlineIso"), generated_at=report.get("generatedAt"))
    if not deadline or deadline != official or not generated or generated > now:
        return {**result, "status": "invalid_receipt"}
    index = {}
    positions = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}
    for pid, p in players.items():
        for name in {p.get("web_name", ""), f"{p.get('first_name', '')} {p.get('second_name', '')}"}:
            key = (normalise(name), teams[p["team"]]["short_name"], positions[p["element_type"]])
            index.setdefault(key, set()).add(pid)
    values, conflicts = {}, set()
    for series in report.values():
        if not isinstance(series, list):
            continue
        for row in series:
            if not isinstance(row, dict) or "prPoints" not in row:
                continue
            point = row["prPoints"]
            # Solio's supplied keeper label is GKP; official local UI uses GK.
            position = "GK" if row.get("position") == "GKP" else row.get("position")
            ids = index.get((normalise(row.get("name", "")), row.get("team"), position), set())
            if len(ids) != 1 or not finite(point) or not -5 <= point <= 60:
                result["rejected"].append({"name": str(row.get("name", ""))[:100], "candidates": len(ids)})
                continue
            pid = next(iter(ids))
            if pid in values and values[pid] != point:
                conflicts.add(pid)
            values[pid] = point
    for pid in conflicts:
        values.pop(pid, None)
    result.update(
        players={str(pid): {"code": players[pid]["code"], "points": {str(gw): point}} for pid, point in values.items()},
        matched_players=len(values), weeks=[gw] if values else [],
        conflicting_ids=sorted(conflicts), status="shortlist_only" if values else "no_matched_players",
    )
    if event.get("finished") or now >= deadline:
        result["status"] = "past_deadline"
    elif now - generated > timedelta(hours=8):
        result["status"] = "old_publication"
    return result


def parse_planner(record, players, teams, events, *, now=None):
    """Validate every exposed player-week, retaining omitted players as missing."""
    now = now or datetime.now(timezone.utc)
    result = {"name": PLANNER_NAME, "url": "https://fpl.solioanalytics.com/",
              "source_key": "solio_authenticated", "scope": "signed-in five-week planner",
              "full_planner_connected": True, "players": {}, "matched_players": 0,
              "pool_players": len(players), "weeks": [], "rejected": [],
              "conflicting_ids": [], "status": "invalid_planner", "generated_at": None}
    try:
        captured = source_time(record["captured_at"])
        if not captured or not timedelta(0) <= now - captured <= timedelta(hours=8):
            return {**result, "status": "old_acquisition"}
        synced = source_time(record.get("sync_confirmed_at"))
        if not synced or not timedelta(0) <= captured - synced <= timedelta(minutes=5):
            return {**result, "status": "unconfirmed_sync"}
        event = next((e for e in events if e.get("is_next")), None)
        if event is None:
            event = next(e for e in events if not e.get("finished") and source_time(e["deadline_time"]) > now)
        gw = event["id"]
        weeks = list(range(gw, min(gw + 4, 38) + 1))
        headers = ["Name", "Team", "Price", "Avg", *[f"GW{g}" for g in weeks]]
        if record["headers"] != headers or now >= source_time(event["deadline_time"]):
            return {**result, "status": "invalid_window"}
        identity = record["identity"]
        scenarios = [s for s in identity["scenario"] if s.get("active") is not False]
        if identity.get("overrides", 0) or len(scenarios) != 1 or scenarios[0].get("isBase") is not True or scenarios[0].get("homeGoalMultiplier") not in (None, 1):
            return {**result, "status": "custom_scenario"}
        source_teams = {t["id"]: t for t in identity["teams"]}
        source_players = {p["fplId"]: p for p in identity["elements"]}
        if not source_players or len(source_players) != len(identity["elements"]) or not set(source_players) <= set(players):
            return {**result, "status": "incomplete_identities"}
        # Official FPL can list a new player before Solio does. Retain verified
        # existing rows and expose that missing identity; never invent its cells.
        unlisted = sorted(set(players) - set(source_players))
        positions = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}
        index, eligible, omitted = {}, set(), []
        for pid, source in source_players.items():
            official = players[pid]
            team = source_teams[source["teamId"]]
            club = teams[official["team"]]
            if (source["fplCode"] != official["code"] or team["fplCode"] != club["code"]
                    or source["position"] != positions[official["element_type"]]
                    or not isinstance(source["purchaseable"], bool)):
                return {**result, "status": "invalid_identity"}
            if not source["purchaseable"]:
                omitted.append(pid)
                continue
            eligible.add(pid)
            key = (normalise(source["name"]), team["abbreviation"])
            index.setdefault(key, set()).add(pid)
        rows = record["rows"]
        if record["expected_rows"] != len(eligible) or len(rows) != len(eligible) or {r["index"] for r in rows} != set(range(len(eligible))):
            return {**result, "status": "incomplete_rows"}
        values = {}
        for row in rows:
            cells = row["cells"]
            if len(cells) != len(headers):
                return {**result, "status": "invalid_cells"}
            ids = index.get((normalise(cells[0]), cells[1]), set())
            if len(ids) != 1:
                return {**result, "status": "ambiguous_identity"}
            pid = next(iter(ids))
            if pid in values:
                return {**result, "status": "conflicting_rows"}
            points = {}
            for target, cell in zip(weeks, cells[4:]):
                if not isinstance(cell, str) or not cell.strip():
                    return {**result, "status": "invalid_cells"}
                point = float(cell)
                if not finite(point) or not -5 <= point <= 60:
                    return {**result, "status": "invalid_cells"}
                points[str(target)] = point
            values[str(pid)] = {"code": players[pid]["code"], "points": points}
        if {int(pid) for pid in values} != eligible:
            return {**result, "status": "incomplete_rows"}
        result.update(players=values, matched_players=len(values), eligible_players=len(eligible),
                      omitted_players=len(omitted) + len(unlisted), omitted_ids=sorted([*omitted, *unlisted]),
                      unpurchaseable_players=len(omitted), unlisted_players=len(unlisted), unlisted_ids=unlisted,
                      omission_reason="unpurchaseable or not yet listed in Solio",
                      weeks=weeks, gameweek=gw, deadline=event["deadline_time"],
                      deadlines={str(e["id"]): e["deadline_time"] for e in events if e["id"] in weeks},
                      status="planner", publication_time_known=False)
        return result
    except (KeyError, TypeError, ValueError, StopIteration):
        return result


def load(players, teams, events, *, refresh=False):
    from . import data
    from . import solio_browser

    envelope = solio_browser.load(data.ROOT, refresh=refresh)
    authenticated = None
    if envelope:
        try:
            body = envelope["body"]
            valid_hash = hashlib.sha256(body.encode()).hexdigest() == envelope["sha256"]
            authenticated = parse_planner(json.loads(body), players, teams, events) if valid_hash else {"status": "invalid_hash"}
            data._statuses["solio_authenticated"] = {k: v for k, v in envelope.items() if k != "body"}
            authenticated.update(source_at=envelope.get("fetched_at"), source_status=envelope.get("status"), sha256=envelope.get("sha256"))
            authenticated["usable"] = authenticated["status"] == "planner" and envelope.get("status") in ("live", "cached")
            if authenticated["usable"]:
                return authenticated
        except (ValueError, KeyError, TypeError):
            authenticated = {"status": "invalid_cache"}

    body = data.fetch(URL, SOURCE_KEY, 1800, optional=True, refresh=refresh)
    try:
        report = json.loads(body) if body else None
    except (ValueError, TypeError):
        report = None
    result = parse_report(report, players, teams, events)
    meta = data.source_metadata(SOURCE_KEY)
    result.update(source_at=meta.get("fetched_at"), source_status=meta.get("status"), sha256=meta.get("sha256"))
    result["usable"] = result["status"] == "shortlist_only" and meta.get("status") in ("live", "cached")
    if authenticated:
        result["planner_fallback"] = (authenticated.get("source_status")
                                      if authenticated.get("source_status") == "stale" else authenticated["status"])
    return result


def summary(source):
    return {k: v for k, v in source.items() if k != "players"}


def apply(payload, dataset, *, enabled=True, overrides=None, minutes_schedule=None,
          extrapolate=True, half_life=6, calibration_payload=None):
    """Use observed cells and a labelled projection beyond a full planner window.

    The small public shortlist never supplies an extrapolation calibration.
    Raw observations remain separate from projected values in every capture.
    """
    source = dataset.get("solio", {})
    output = {**payload, "solio": {**summary(source), "enabled": enabled, "applied_forecasts": 0}}
    if not enabled or not source.get("usable"):
        return output
    overrides, minutes_schedule = overrides or {}, minutes_schedule or {}
    extended = 0
    if extrapolate and source.get("full_planner_connected"):
        from .ensemble import blend_forecasts
        anchors = {pid: row["points"] for pid, row in source["players"].items()
                   if pid not in overrides and any(
                       str(p["id"]) == pid and p["code"] == row.get("code")
                       for p in payload["players"])}
        projected = blend_forecasts(
            payload, anchors, 1, "Solio window projection", half_life=half_life,
            source_at=source.get("source_at"), minutes_schedule=minutes_schedule,
            calibration_payload=calibration_payload,
        )
        players = []
        for original, calibrated in zip(payload["players"], projected["players"]):
            weeks = {gw: row for gw, row in calibrated["gw"].items()
                     if row.get("prediction_source", {}).get("name") == "Solio window projection"
                     and row["prediction_source"]["kind"] == "extrapolated"}
            extended += len(weeks)
            players.append({**original, "gw": {**original["gw"], **weeks}} if weeks else original)
        payload = {**payload, "players": players}
        output = {**payload, "solio": output["solio"]}
    applied = 0
    output["players"] = []
    for original in payload["players"]:
        pid = str(original["id"])
        observed = source.get("players", {}).get(pid, {})
        player = original
        if pid not in overrides and observed.get("code") == original["code"]:
            for gw, point in observed.get("points", {}).items():
                old = original["gw"].get(gw)
                if not old or not old["fixtures"] or gw in minutes_schedule.get(pid, {}):
                    continue
                if player is original:
                    player = {**original, "gw": dict(original["gw"])}
                item = {**old, "components": {**old["components"], "solio_adjustment": point - old["points"]}}
                item["points"] = point
                item["prediction_source"] = {
                    "kind": "provider", "name": source.get("name", NAME), "weight": 1,
                    "base_points": old["points"], "source_points": point,
                    "source_at": source.get("source_at"), "generated_at": source.get("generated_at"),
                    "scope": source["scope"], "previous": old.get("prediction_source"),
                }
                player["gw"][gw] = item
                applied += 1
        output["players"].append(player)
    output["solio"]["applied_forecasts"] = applied
    output["solio"]["extrapolated_forecasts"] = extended
    if applied or extended:
        output["forecast_layers"] = [*payload.get("forecast_layers", []), {
            "name": source.get("name", NAME), "weight": 1, "direct_forecasts": applied, "extrapolated_forecasts": extended,
            "half_life": half_life,
            "source_at": source.get("source_at"),
        }]
        output["model_version"] += " · Solio observed points" + (" + window extrapolation" if extended else "")
        coverage = (f"Solio's signed-in planner supplies {source['matched_players']}/{source['pool_players']} players across GW{min(source['weeks'])}–{max(source['weeks'])}; unpurchaseable and not-yet-listed players are omitted. Provider publication time is unknown."
                    if source.get("full_planner_connected") else "Solio supplies a selected next-GW shortlist, not the full five-week player pool.")
        output["limitations"] = [*payload["limitations"], coverage +
            f" Supplied cells replace points. Beyond the full planner window, a capped player scale fades over {half_life:g} GWs when extrapolation is enabled. These are local projections, not observed Solio values; minutes and event rates remain local. Agreement after direct replacement is not an independent benchmark."]
    return output


def archive_observation(dataset, root):
    """Freeze raw Solio and the independent forecast from the same dataset."""
    from .app import ForecastRequest, forecast_for
    from .model import projections

    source = dataset.get("solio", {})
    if not source.get("usable"):
        return None
    gw = str(source["gameweek"])
    baseline = forecast_for(ForecastRequest(use_solio=False), dataset=dataset)
    component = {p["id"]: p for p in projections(dataset=dataset)["players"]}
    targets = {}
    events = {str(e["id"]): e for e in dataset["bootstrap"]["events"]}
    for target in source["weeks"]:
        target = str(target)
        rows = []
        for player in baseline["players"]:
            stored = source["players"].get(str(player["id"]), {})
            if target not in stored.get("points", {}) or target not in player["gw"] or stored.get("code") != player["code"]:
                continue
            rows.append({
                "id": player["id"], "code": player["code"], "name": player["name"],
                "club": player["team_short"], "position": player["position"],
                "xmins": component[player["id"]]["gw"][target]["xmins"],
                "models": {"Solio": stored["points"][target],
                           "Open FPL without Solio": player["gw"][target]["points"],
                           "Component model": component[player["id"]]["gw"][target]["points"]},
            })
        if rows and target in events:
            targets[target] = {"gameweek": int(target), "deadline": events[target]["deadline_time"], "players": rows}
    rows = targets.get(gw, {}).get("players", [])
    now = datetime.now(timezone.utc)
    deadline = source_time(source["deadline"])
    if now >= deadline or not rows:
        return None
    record = {
        "schema": 2, "season": dataset["season"], "gameweek": int(gw),
        "recorded_at": now.isoformat(), "deadline": source["deadline"],
        "source": summary(source), "sources": dataset["sources"],
        "model_version": baseline["model_version"], "configuration": ForecastRequest(use_solio=False).model_dump(),
        "players": rows, "scope": source["scope"], "future_targets": targets,
        "captured_gameweeks": sorted(int(target) for target in targets),
        "method": "Same-acquisition agreement uses the independent forecast without Solio. This is not actual-points accuracy. A long-range comparison must use an earlier frozen independent prediction.",
    }
    packed = gzip.compress(json.dumps(record, ensure_ascii=False, allow_nan=False).encode(), mtime=0)
    if datetime.now(timezone.utc) >= deadline:
        return None
    folder = root / "data" / "snapshots" / "solio"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{dataset['season']}_gw{gw}_{now.strftime('%Y%m%dT%H%M%S%fZ')}.json.gz"
    with path.open("xb") as handle:
        handle.write(packed)
    return path.name

"""Official season observations, independent of the forecast/model pipeline.

Mount ``router`` before the application's static-file mount. Player ``stats``
uses official aggregate field names, except ``price`` (now_cost / 10, GBP m)
and ``ownership`` (selected_by_percent). Team stats use completed fixture scores
only. Metric definitions describe units, scope, and non-null coverage.
"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from . import data

router = APIRouter()
POSITIONS = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}
PLAYER_FIELDS = (
    "minutes", "total_points", "goals_scored", "assists", "clean_sheets",
    "goals_conceded", "own_goals", "penalties_saved", "penalties_missed",
    "yellow_cards", "red_cards", "saves", "bonus", "bps", "influence",
    "creativity", "threat", "ict_index", "starts", "expected_goals",
    "expected_assists", "expected_goal_involvements", "expected_goals_conceded",
    "defensive_contribution", "tackles", "clearances_blocks_interceptions",
    "recoveries", "price", "ownership",
)
TEAM_FIELDS = (
    "games", "goals_scored", "goals_conceded", "clean_sheets", "wins", "draws",
    "losses", "points", "goal_difference",
)
LABELS = {
    "total_points": "FPL points", "goals_scored": "Goals", "goals_conceded": "Conceded",
    "bps": "BPS", "ict_index": "ICT index", "price": "Price", "ownership": "Ownership",
    "expected_goals": "Historical xG", "expected_assists": "Historical xA",
    "expected_goal_involvements": "Historical xGI",
    "expected_goals_conceded": "Historical xGC",
    "clearances_blocks_interceptions": "Clearances, blocks and interceptions",
    "points": "Points from results",
}


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        value = float(value)
    except (ValueError, OverflowError):
        return None
    return value if math.isfinite(value) else None


def _timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Missing source timestamp")
    stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        raise ValueError("Source timestamp needs a timezone")
    return stamp


def _decode_envelope(meta, url, ttl, *, cached):
    """Verify the payload, retaining the original extraction time and digest."""
    if not isinstance(meta, dict) or meta.get("url") != url or meta.get("request_form"):
        raise ValueError("Unexpected official source")
    body = meta.get("body")
    if not isinstance(body, str):
        raise ValueError("Missing official payload")
    raw = body.encode("utf-8")
    # data.fetch strips a UTF-8 BOM from text but hashes the original bytes.
    if meta.get("sha256") not in {
        hashlib.sha256(raw).hexdigest(),
        hashlib.sha256(b"\xef\xbb\xbf" + raw).hexdigest(),
    }:
        raise ValueError("Official payload checksum mismatch")
    age = max(0.0, (datetime.now(timezone.utc) - _timestamp(meta.get("fetched_at"))).total_seconds())
    receipt = {
        "url": url, "fetched_at": meta["fetched_at"], "sha256": meta["sha256"],
        "status": ("stale" if age > ttl else "cached") if cached else meta.get("status", "live"),
        "hash_verified": True, "cache_age_seconds": round(age),
    }
    return json.loads(body.lstrip("\ufeff")), receipt


def _validate_payload(payload, key):
    if key == "fpl_bootstrap":
        if not isinstance(payload, dict) or any(
            not isinstance(payload.get(field), list) or not payload[field]
            or not all(isinstance(row, dict) for row in payload[field])
            for field in ("elements", "teams", "events")
        ):
            raise ValueError("Invalid official bootstrap")
        for field in ("elements", "teams"):
            for identity in ("id", "code"):
                values = [row.get(identity) for row in payload[field]]
                if any(type(value) is not int or value <= 0 for value in values) or len(set(values)) != len(values):
                    raise ValueError("Missing or duplicate official identity")
        teams = {row["id"]: row for row in payload["teams"]}
        if any(row.get("team") not in teams for row in payload["elements"]):
            raise ValueError("Unknown official player club")
        if any(row.get("team_code") is not None and row["team_code"] != teams[row["team"]]["code"] for row in payload["elements"]):
            raise ValueError("Official player/club codes disagree")
        if any(type(row.get("element_type")) is not int or row["element_type"] not in POSITIONS for row in payload["elements"]):
            raise ValueError("Unknown official player position")
        _season(payload)
    elif not isinstance(payload, list) or not all(isinstance(row, dict) for row in payload):
        raise ValueError("Invalid official fixtures")
    elif any(type(row.get(field)) is not int for row in payload for field in ("id", "team_h", "team_a")):
        raise ValueError("Missing official fixture identity")


def _official_source(key, endpoint, ttl):
    url = f"{data.FPL}/{endpoint}/"
    try:
        meta = json.loads((data.CACHE / f"{key}.json").read_text(encoding="utf-8"))
        payload, receipt = _decode_envelope(meta, url, ttl, cached=True)
        _validate_payload(payload, key)
        return payload, receipt
    except (OSError, ValueError, KeyError, TypeError):
        pass
    try:
        # A valid cache is deliberately preferred even after its TTL. Only an
        # absent/unusable envelope needs acquisition; no dataset/model is loaded.
        body = data.fetch(url, key, ttl, optional=True, refresh=True)
        meta = {**data.source_metadata(key), "body": body}
        payload, receipt = _decode_envelope(meta, url, ttl, cached=False)
        _validate_payload(payload, key)
        return payload, receipt
    except (OSError, RuntimeError, ValueError, KeyError, TypeError):
        return None, {
            "url": url, "fetched_at": None, "sha256": None,
            "status": "unavailable", "hash_verified": False,
            "reason": "Official source unavailable or failed integrity/schema checks.",
        }


def _season(bootstrap):
    deadlines = [_timestamp(event["deadline_time"]) for event in bootstrap["events"]]
    year = min(deadlines).year
    return f"{year}-{str(year + 1)[-2:]}"


def _team_results(fixtures, team_ids):
    totals = {tid: {key: 0 for key in TEAM_FIELDS} for tid in team_ids}
    if fixtures is None:
        return {tid: dict.fromkeys(TEAM_FIELDS) for tid in team_ids}, {
            "fixtures": 0, "completed_fixtures": 0, "unusable_completed_fixtures": 0,
        }
    completed = unusable = 0
    incomplete_teams = set()
    seen = set()
    for fixture in fixtures:
        if fixture.get("finished") is not True:
            continue  # Includes postponed/unplayed and provisional/in-progress games.
        home, away = fixture.get("team_h"), fixture.get("team_a")
        hs, aws = _number(fixture.get("team_h_score")), _number(fixture.get("team_a_score"))
        fid = fixture.get("id")
        if (home not in totals or away not in totals or home == away
                or hs is None or aws is None or min(hs, aws) < 0
                or not hs.is_integer() or not aws.is_integer() or fid in seen):
            unusable += 1
            incomplete_teams.update(tid for tid in (home, away) if tid in totals)
            continue
        seen.add(fid)
        completed += 1
        for tid, gf, ga in ((home, int(hs), int(aws)), (away, int(aws), int(hs))):
            row = totals[tid]
            row["games"] += 1
            row["goals_scored"] += gf
            row["goals_conceded"] += ga
            row["clean_sheets"] += int(ga == 0)
            row["wins"] += int(gf > ga)
            row["draws"] += int(gf == ga)
            row["losses"] += int(gf < ga)
            row["points"] += 3 * int(gf > ga) + int(gf == ga)
            row["goal_difference"] += gf - ga
    for tid in incomplete_teams:
        totals[tid] = dict.fromkeys(TEAM_FIELDS)
    return totals, {
        "fixtures": len(fixtures), "completed_fixtures": completed,
        "unusable_completed_fixtures": unusable,
    }


def _metrics(scope, rows, fields):
    metrics = []
    for key in fields:
        count = sum(row["stats"][key] is not None for row in rows)
        source_field = {"price": "now_cost", "ownership": "selected_by_percent"}.get(key, key)
        if scope == "team":
            description = "Completed official fixture results; never summed from player statistics."
            if key == "points":
                description = "Three points per win and one per draw from completed official fixtures; excludes deductions."
            unit = "points" if key == "points" else "count"
        elif key.startswith("expected_"):
            description = "Official historical underlying statistic for matches played; not a forecast."
            unit = "expected count"
        elif key in ("price", "ownership"):
            description = "Current official price (now_cost / 10)." if key == "price" else "Current official selection percentage."
            unit = "GBP m" if key == "price" else "%"
        else:
            description = "Official season-to-date player aggregate, including any previous club this season."
            unit = "minutes" if key == "minutes" else "points" if key in ("total_points", "bonus", "bps") else "index" if key in ("influence", "creativity", "threat", "ict_index") else "count"
        metrics.append({
            "key": key, "label": LABELS.get(key, key.replace("_", " ").capitalize()),
            "scope": scope, "unit": unit, "description": description,
            "source_field": source_field if scope == "player" else None,
            "available": count > 0, "available_count": count, "total_count": len(rows),
        })
    return metrics


def build_season_data(bootstrap, fixtures, source, fixture_source):
    """Normalise sourced snapshots without touching forecasts or shared state."""
    season = _season(bootstrap)
    if fixtures is not None:
        year = int(season[:4])
        start, end = datetime(year, 7, 1, tzinfo=timezone.utc), datetime(year + 1, 7, 1, tzinfo=timezone.utc)
        try:
            if any(not start <= _timestamp(f["kickoff_time"]) < end for f in fixtures if f.get("kickoff_time")):
                raise ValueError("Fixtures belong to another season")
        except (ValueError, TypeError):
            fixtures = None
            fixture_source = {**fixture_source, "status": "unavailable", "reason": "Fixture dates do not match the official season."}
    teams_by_id = {team["id"]: team for team in bootstrap["teams"]}
    players = []
    for player in bootstrap["elements"]:
        team = teams_by_id[player["team"]]
        stats = {key: _number(player.get(key)) for key in PLAYER_FIELDS}
        cost = _number(player.get("now_cost"))
        stats["price"] = cost / 10 if cost is not None else None
        stats["ownership"] = _number(player.get("selected_by_percent"))
        players.append({
            "id": player["id"], "code": player["code"], "name": player.get("web_name"),
            "full_name": " ".join(str(player[key]).strip() for key in ("first_name", "second_name") if player.get(key)) or None,
            "position": POSITIONS.get(player.get("element_type")),
            "position_id": player.get("element_type"), "team": player["team"],
            "team_name": team.get("name"), "team_short": team.get("short_name"),
            "team_code": team["code"], "stats": stats,
        })
    results, coverage = _team_results(fixtures, teams_by_id)
    teams = [{
        "id": team["id"], "code": team["code"], "name": team.get("name"),
        "short_name": team.get("short_name"), "stats": results[team["id"]],
    } for team in bootstrap["teams"]]
    return {
        "season": season, "source": source, "fixture_source": fixture_source,
        "players": players, "teams": teams,
        "available_metrics": _metrics("player", players, PLAYER_FIELDS) + _metrics("team", teams, TEAM_FIELDS),
        "maps": {"available": False, "reason": "Official FPL feeds do not provide shot or touch coordinates."},
        "coverage": {
            "players": len(players), "teams": len(teams),
            "expected_players": len(bootstrap["elements"]), "expected_teams": len(bootstrap["teams"]),
            "player_fields": list(PLAYER_FIELDS), "team_fields": list(TEAM_FIELDS),
            "team_results_available": fixtures is not None,
            **coverage,
        },
    }


@router.get("/api/season-data")
def season_data():
    bootstrap, source = _official_source("fpl_bootstrap", "bootstrap-static", 900)
    if bootstrap is None:
        raise HTTPException(status_code=503, detail="Official season data is unavailable.")
    fixtures, fixture_source = _official_source("fpl_fixtures", "fixtures", 3600)
    return build_season_data(bootstrap, fixtures, source, fixture_source)

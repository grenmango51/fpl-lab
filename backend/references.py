"""Validated Elevenify references; never convert ranking scores into forecasts."""

from __future__ import annotations

import csv
import io
import math
import re
import unicodedata

FEEDS = {
    "baselines": {
        "source_key": "elevenify_player_baselines",
        "url": "https://static.dwcdn.net/data/tDC0G.csv",
    },
    "fast_fantasy": {
        "source_key": "elevenify_fast_fantasy",
        "url": "https://static.dwcdn.net/data/MmYOs.csv",
    },
}

CONDITIONING = "starts_against_average_premier_league_team"
POSITIONS = {"GK": 1, "GKP": 1, "DEF": 2, "MID": 3, "FWD": 4}
# These two exact provider aliases were checked against the 2026/27 official
# pool. IDs alone never establish identity: club, position and name must agree.
NAME_ALIASES = {
    "jpedro": {"id": 165, "team": "CHE", "position": 4, "name": "joaopedro"},
    "kmitoma": {"id": 121, "team": "BHA", "position": 3, "name": "mitoma"},
}


def normalise_name(value):
    ascii_name = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", ascii_name.lower())


def name_variants(player):
    first = player.get("first_name", "")
    second = player.get("second_name", "")
    web = player.get("web_name", "")
    variants = [web, second, f"{first} {second}"]
    if first:
        variants += [f"{first[0]}. {second}", f"{first[0]}. {web}"]
    return {normalise_name(name) for name in variants if name}


def _table(raw, required):
    reader = csv.DictReader(io.StringIO(raw.lstrip("\ufeff")), strict=True)
    headers = [header.strip() for header in (reader.fieldnames or [])]
    if not headers or not set(required).issubset(headers):
        raise ValueError("Unexpected CSV columns; reference disabled.")
    if len(headers) != len(set(headers)):
        raise ValueError("Duplicate CSV columns; reference disabled.")
    reader.fieldnames = headers
    rows = list(reader)
    if not rows:
        raise ValueError("CSV contains no player rows; reference disabled.")
    if any(None in row or any(value is None for value in row.values()) for row in rows):
        raise ValueError("Malformed CSV row; reference disabled.")
    return headers, [{key: value.strip() for key, value in row.items()} for row in rows]


def _number(raw, low, high, label):
    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid {label}; reference disabled.") from exc
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"Implausible {label}; reference disabled.")
    return value


def _match(row, row_number, players, teams, source_key, *, has_position):
    """Use exact normalised names inside a validated club/position cohort."""
    evidence = {
        "source_key": source_key,
        "row": row_number,
        "provider_name": row["Player"],
        "provider_team": row.get("Team") or None,
        "provider_position": row.get("Position") or None,
    }
    by_code = {team["code"]: team for team in teams.values()}
    by_short = {team["short_name"]: team for team in teams.values()}
    badge = row.get("", "")
    badge_code = None
    # FALSE is the actual published missing-badge value for Coventry rows.
    if badge and badge.upper() != "FALSE":
        match = re.search(
            r"https://resources\.premierleague\.com/premierleague/badges/\d+/t(\d+)\.png",
            badge,
        )
        if not match:
            return None, {**evidence, "reason": "Unrecognised club badge."}, "unmatched"
        badge_code = int(match.group(1))
        if badge_code not in by_code:
            return (
                None,
                {
                    **evidence,
                    "team_code": badge_code,
                    "reason": "Club is outside current pool.",
                },
                "unmatched",
            )
    team = by_code.get(badge_code)
    team_label = row.get("Team")
    if team_label:
        named_team = by_short.get(team_label)
        if named_team is None:
            return (
                None,
                {**evidence, "reason": "Club is outside current pool."},
                "unmatched",
            )
        if team and team["id"] != named_team["id"]:
            return (
                None,
                {**evidence, "reason": "Badge and club label disagree."},
                "unmatched",
            )
        team = named_team
    if team is None:
        return None, {**evidence, "reason": "No validated current club."}, "unmatched"
    position = POSITIONS.get(row.get("Position")) if has_position else None
    if has_position and position is None:
        return None, {**evidence, "reason": "Unrecognised position."}, "unmatched"
    provider_name = normalise_name(row["Player"])
    if not provider_name:
        return None, {**evidence, "reason": "Missing player name."}, "unmatched"
    cohort = [
        player
        for player in players.values()
        if player["team"] == team["id"]
        and (position is None or player["element_type"] == position)
    ]
    candidates = [p for p in cohort if provider_name in name_variants(p)]
    method = "normalised_name"
    if not candidates and (alias := NAME_ALIASES.get(provider_name)):
        candidate = players.get(alias["id"])
        if (
            candidate in cohort
            and candidate["element_type"] == alias["position"]
            and team["short_name"] == alias["team"]
            and normalise_name(candidate["web_name"]) == alias["name"]
        ):
            candidates = [candidate]
            method = "documented_alias"
    if len(candidates) != 1:
        category = "ambiguous" if candidates else "unmatched"
        return (
            None,
            {
                **evidence,
                "team": team["short_name"],
                "team_code": team["code"],
                "reason": "Ambiguous current players."
                if candidates
                else "No exact current name match.",
                "candidate_ids": [p["id"] for p in candidates],
            },
            category,
        )
    player = candidates[0]
    return (
        player["id"],
        {
            **evidence,
            "official_name": player["web_name"],
            "team": team["short_name"],
            "team_code": team["code"],
            "position": player["element_type"],
            "method": method,
            "club_basis": "badge" if badge_code is not None else "team",
        },
        "matched",
    )


def parse_reference(raw, feed, players, teams):
    """Parse one selected-player feed, retaining rejected mapping diagnostics."""
    result = {
        "players": {},
        "row_count": 0,
        "matched_players": 0,
        "diagnostics": {"unmatched": [], "ambiguous": [], "duplicates": []},
        "error": None,
    }
    source_key = FEEDS[feed]["source_key"]
    baseline = feed == "baselines"
    required = (
        ["Player", "Goal Baseline", "Assist Baseline", "Goal Involvement Baseline"]
        if baseline
        else ["Player", "Team", "Position", "Future Importance"]
    )
    try:
        headers, rows = _table(raw, required)
        result["row_count"] = len(rows)
        captain_header, captain_gameweek = None, None
        if not baseline:
            captain_headers = [
                (header, match)
                for header in headers
                if (match := re.fullmatch(r"GW(\d+) Captaincy Option\?", header))
            ]
            if len(captain_headers) != 1:
                raise ValueError("Expected one numbered captaincy gameweek column.")
            captain_header, match = captain_headers[0]
            captain_gameweek = int(match.group(1))
            if not 1 <= captain_gameweek <= 38:
                raise ValueError("Invalid captaincy gameweek.")
            result["captain_gameweek"] = captain_gameweek
        matched = {}
        for row_number, row in enumerate(rows, start=2):
            if baseline:
                values = {
                    "attacking_baseline": {
                        "goal": _number(row["Goal Baseline"], 0, 5, "goal baseline"),
                        "assist": _number(
                            row["Assist Baseline"], 0, 5, "assist baseline"
                        ),
                        "goal_involvement": _number(
                            row["Goal Involvement Baseline"],
                            0,
                            10,
                            "goal involvement baseline",
                        ),
                        "conditioning": CONDITIONING,
                        "duration_minutes": None,
                        "gameweek": None,
                        "source_key": source_key,
                    }
                }
            else:
                star = row[captain_header].replace("\ufe0f", "")
                if star not in ("", "⭐"):
                    raise ValueError("Unexpected captaincy marker.")
                values = {
                    "future_importance": _number(
                        row["Future Importance"], 0, 100, "future importance"
                    ),
                    "future_importance_source": source_key,
                    "captain": bool(star),
                    "captain_gameweek": captain_gameweek,
                }
            pid, evidence, category = _match(
                row, row_number, players, teams, source_key, has_position=not baseline
            )
            if category != "matched":
                result["diagnostics"][category].append(evidence)
                continue
            if str(pid) in matched:
                result["diagnostics"]["duplicates"].append(
                    {
                        **evidence,
                        "player_id": pid,
                        "reason": "Duplicate current FPL ID.",
                    }
                )
                raise ValueError("Duplicate current FPL IDs; reference disabled.")
            matched[str(pid)] = {"player_id": pid, **values, "matches": [evidence]}
        result["matched_players"] = len(matched)
        if not matched:
            raise ValueError(
                "No players match the current official pool; reference disabled."
            )
        if len(matched) < 0.8 * len(rows):
            raise ValueError(
                "Fewer than 80% of rows match the current pool; reference disabled."
            )
        result["players"] = matched
    except (ValueError, KeyError, TypeError, csv.Error) as exc:
        result["error"] = str(exc)
        result["players"] = {}
    return result


def build_reference(raw_by_feed, provenance, players, teams, *, season, next_gw):
    """Merge validated references with source provenance; forecasts stay untouched."""
    combined, feeds = {}, {}
    for feed, config in FEEDS.items():
        meta = provenance.get(config["source_key"], {})
        raw = raw_by_feed.get(feed)
        parsed = (
            parse_reference(raw, feed, players, teams)
            if raw
            else {
                "players": {},
                "row_count": 0,
                "matched_players": 0,
                "diagnostics": {"unmatched": [], "ambiguous": [], "duplicates": []},
                "error": "Source unavailable; reference disabled.",
            }
        )
        available = bool(parsed["players"])
        source_status = meta.get("status", "unavailable")
        status = "invalid" if raw and parsed["error"] else source_status
        feeds[feed] = {
            "source_key": config["source_key"],
            "url": config["url"],
            "status": status,
            "source_status": source_status,
            "source_at": meta.get("fetched_at"),
            "sha256": meta.get("sha256"),
            "last_modified": meta.get("last_modified"),
            "raw_archive": meta.get("raw_archive"),
            "available": available,
            "row_count": parsed["row_count"],
            "matched_players": parsed["matched_players"],
            "coverage": parsed["matched_players"] / parsed["row_count"]
            if parsed["row_count"]
            else 0,
            "diagnostics": parsed["diagnostics"],
            "validation": parsed["error"],
            "error": meta.get("error"),
        }
        if "captain_gameweek" in parsed:
            feeds[feed]["captain_gameweek"] = parsed["captain_gameweek"]
            feeds[feed]["captain_gameweek_matches_next"] = (
                parsed["captain_gameweek"] == next_gw
            )
        for pid, player in parsed["players"].items():
            previous = combined.get(pid, {})
            combined[pid] = {
                **previous,
                **player,
                "matches": previous.get("matches", []) + player["matches"],
            }
    enabled = [feed for feed in feeds.values() if feed["available"]]
    status = (
        "unavailable"
        if not enabled
        else "partial"
        if len(enabled) < len(FEEDS)
        else "stale"
        if any(feed["status"] == "stale" for feed in enabled)
        else "live"
        if any(feed["status"] == "live" for feed in enabled)
        else "cached"
    )
    return {
        "provider": "Elevenify",
        "season": season,
        "season_inferred": True,
        "available": bool(combined),
        "status": status,
        "players": combined,
        "feeds": feeds,
        "coverage": {
            "official_players": len(players),
            "matched_players": len(combined),
            "baseline_players": feeds["baselines"]["matched_players"]
            if feeds["baselines"]["available"]
            else 0,
            "importance_players": feeds["fast_fantasy"]["matched_players"]
            if feeds["fast_fantasy"]["available"]
            else 0,
        },
        "limitations": [
            "Attacking baselines assume a start against an average Premier League team; duration is unspecified, so these are not per-90 rates or gameweek forecasts.",
            "Future importance is a ranking score, not expected points or an appearance probability; its forecast window is unspecified.",
            "These tables cover selected players only. Missing players have no supplied reference, not zero importance or attacking expectation.",
            "The season is inferred from matches to the current official pool; a dated captaincy column applies only to that gameweek.",
            "Fast Fantasy incorporates FPL Review Massive Data and is not an independent second set of points forecasts.",
        ],
    }

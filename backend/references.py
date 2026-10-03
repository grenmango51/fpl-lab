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
        "caption": "Average-opponent attacking baselines",
        "units": "Expected attacking counts given a start against an average Premier League team",
        "conditioning": "starts_against_average_premier_league_team",
    },
    "fast_fantasy": {
        "source_key": "elevenify_fast_fantasy",
        "url": "https://static.dwcdn.net/data/MmYOs.csv",
        "caption": "Future importance and captaincy reference",
        "units": "Ranking score and captaincy marker; no point or probability units",
        "conditioning": None,
    },
    "next_gw_attack": {
        "source_key": "elevenify_next_gw_attack",
        "url": "https://static.dwcdn.net/data/YmfDr.csv",
        "caption": "Next-gameweek goals, assists and goal involvement",
        "units": "Expected goals, assists and goal involvement given a start",
        "conditioning": "assumes_player_starts",
    },
    "three_gw_goals": {
        "source_key": "elevenify_three_gw_goals",
        "url": "https://static.dwcdn.net/data/ALYf8.csv",
        "caption": "Three-gameweek goals",
        "units": "Expected goals given a start",
        "conditioning": "assumes_player_starts",
    },
    "three_gw_assists": {
        "source_key": "elevenify_three_gw_assists",
        "url": "https://static.dwcdn.net/data/VK19h.csv",
        "caption": "Three-gameweek assists",
        "units": "Expected assists given a start",
        "conditioning": "assumes_player_starts",
    },
}

CONDITIONING = "starts_against_average_premier_league_team"
ATTACKING_FEEDS = {"next_gw_attack", "three_gw_goals", "three_gw_assists"}
POSITIONS = {"GK": 1, "GKP": 1, "DEF": 2, "MID": 3, "FWD": 4}
# Exact aliases checked against the current official pool and primary club
# profiles. IDs alone never establish identity. The two new fixture-view
# spellings additionally require the verified stable player code.
NAME_ALIASES = {
    "jpedro": {"id": 165, "team": "CHE", "position": 4, "name": "joaopedro"},
    "kmitoma": {"id": 121, "team": "BHA", "position": 3, "name": "mitoma"},
    "ypino": {
        "id": 211,
        "code": 488024,
        "team": "CRY",
        "position": 3,
        "name": "yeremy",
    },
    "savinho": {
        "id": 403,
        "code": 510281,
        "team": "TOT",
        "position": 3,
        "name": "savio",
    },
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
    reader = csv.reader(io.StringIO(raw.lstrip("\ufeff")), strict=True)
    header_row, headers = 0, []
    for row in reader:
        header_row += 1
        if any(value.strip() for value in row):
            headers = [value.strip() for value in row]
            break
    if not headers or not set(required).issubset(headers):
        raise ValueError("Unexpected CSV columns; reference disabled.")
    if len(headers) != len(set(headers)):
        raise ValueError("Duplicate CSV columns; reference disabled.")
    rows = list(reader)
    if not rows:
        raise ValueError("CSV contains no player rows; reference disabled.")
    if any(len(row) != len(headers) for row in rows):
        raise ValueError("Malformed CSV row; reference disabled.")
    return (
        headers,
        [dict(zip(headers, (value.strip() for value in row))) for row in rows],
        header_row + 1,
    )


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
            and candidate["id"] == alias["id"]
            and candidate["element_type"] == alias["position"]
            and team["short_name"] == alias["team"]
            and normalise_name(candidate["web_name"]) == alias["name"]
            and ("code" not in alias or candidate.get("code") == alias["code"])
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
            "official_code": player.get("code"),
            "team": team["short_name"],
            "team_code": team["code"],
            "position": player["element_type"],
            "method": method,
            "club_basis": "badge" if badge_code is not None else "team",
        },
        "matched",
    )


def _attacking_columns(headers, feed):
    """Interpret explicit published GW labels, without shifting their dates."""
    if feed == "next_gw_attack":
        columns = {}
        names = {
            "Goals": "goal",
            "Assists": "assist",
            "Involvement": "goal_involvement",
        }
        for header in headers:
            if match := re.fullmatch(r"GW(\d+) (Goals|Assists|Involvement)", header):
                gw = int(match.group(1))
                if not 1 <= gw <= 38:
                    raise ValueError("Invalid attacking gameweek.")
                columns.setdefault(gw, {})[names[match.group(2)]] = header
        if len(columns) != 1 or set(next(iter(columns.values()), {})) != set(
            names.values()
        ):
            raise ValueError(
                "Expected goals, assists and involvement for one numbered gameweek."
            )
        expected = {"Player", ""} | {
            column for mapping in columns.values() for column in mapping.values()
        }
        if set(headers) != expected:
            raise ValueError("Unexpected next-gameweek attacking columns.")
        return columns
    label = "goal" if feed == "three_gw_goals" else "assist"
    columns = {}
    for header in headers:
        if header.isdigit():
            gw = int(header)
            if not 1 <= gw <= 38 or str(gw) != header:
                raise ValueError("Invalid attacking gameweek.")
            columns[gw] = {label: header}
    weeks = sorted(columns)
    if not 1 <= len(weeks) <= 3 or weeks != list(range(weeks[0], weeks[-1] + 1)):
        raise ValueError(
            "Expected a consecutive attacking window of at most three gameweeks."
        )
    if set(headers) != {"Player", "", "TOTAL"} | {str(gw) for gw in weeks}:
        raise ValueError("Unexpected three-gameweek attacking columns.")
    return columns


def _attacking_values(row, feed, columns, source_key):
    gameweeks = {}
    for gw, mapping in sorted(columns.items()):
        gameweeks[str(gw)] = {
            component: _number(
                row[column], 0, 10 if component == "goal_involvement" else 5, component
            )
            for component, column in mapping.items()
        }
    if feed != "next_gw_attack":
        total = _number(row["TOTAL"], 0, 5 * len(columns), "attacking total")
        rounded_sum = sum(
            next(iter(components.values())) for components in gameweeks.values()
        )
        # Three cells plus a total rounded to 0.01 can differ by up to 0.02.
        if abs(total - rounded_sum) > 0.005 * (len(columns) + 1) + 1e-9:
            raise ValueError("Attacking total disagrees with rounded gameweek counts.")
    return {
        "attacking_views": {
            feed: {
                "source_key": source_key,
                "conditioning": "assumes_player_starts",
                "duration_minutes": None,
                "gameweeks": gameweeks,
            }
        }
    }


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
    attacking = feed in ATTACKING_FEEDS
    required = (
        ["Player", "Goal Baseline", "Assist Baseline", "Goal Involvement Baseline"]
        if baseline
        else ["Player", ""]
        if attacking
        else ["Player", "Team", "Position", "Future Importance"]
    )
    try:
        headers, rows, first_data_row = _table(raw, required)
        result["row_count"] = len(rows)
        captain_header, captain_gameweek = None, None
        if feed == "fast_fantasy":
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
            result["gameweeks"] = [captain_gameweek]
            result["caption"] = f"Future importance and GW{captain_gameweek} captaincy"
        columns = _attacking_columns(headers, feed) if attacking else None
        if attacking:
            result["gameweeks"] = sorted(columns)
            gw_label = ", ".join(f"GW{gw}" for gw in sorted(columns))
            outcome_label = (
                "goals, assists and involvement"
                if feed == "next_gw_attack"
                else "goals"
                if feed == "three_gw_goals"
                else "assists"
            )
            result["caption"] = f"{gw_label} {outcome_label}, conditional on starting"
        matched = {}
        for row_number, row in enumerate(rows, start=first_data_row):
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
            elif attacking:
                values = _attacking_values(row, feed, columns, source_key)
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
                row,
                row_number,
                players,
                teams,
                source_key,
                has_position=feed == "fast_fantasy",
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
        status = (
            "unavailable"
            if not raw
            else "invalid"
            if parsed["error"]
            else source_status
        )
        weeks = parsed.get("gameweeks", [])
        window_status = (
            "unspecified"
            if not weeks
            else "current"
            if weeks[0] == next_gw
            else "past"
            if weeks[0] < next_gw
            else "future"
        )
        if (
            available
            and feed in ATTACKING_FEEDS
            and window_status in ("past", "future")
        ):
            status = "stale"
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
            "caption": parsed.get("caption", config["caption"]),
            "units": config["units"],
            "conditioning": config["conditioning"],
            "duration_minutes": None,
            "gameweeks": weeks,
            "caption_current": weeks[0] == next_gw if weeks else None,
            "window_status": window_status,
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
            if previous.get("attacking_views") or player.get("attacking_views"):
                combined[pid]["attacking_views"] = {
                    **previous.get("attacking_views", {}),
                    **player.get("attacking_views", {}),
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
            "attacking_players": sum(
                bool(player.get("attacking_views")) for player in combined.values()
            ),
        },
        "limitations": [
            "Attacking baselines assume a start against an average Premier League team; duration is unspecified, so these are not per-90 rates or gameweek forecasts.",
            "Future importance is a ranking score, not expected points or an appearance probability; its forecast window is unspecified.",
            "These tables cover selected players only. Missing players have no supplied reference, not zero importance or attacking expectation.",
            "The season is inferred from matches to the current official pool; a dated captaincy column applies only to that gameweek.",
            "Fast Fantasy incorporates FPL Review Massive Data and is not an independent second set of points forecasts.",
            "Gameweek attacking views assume the player starts; their duration and start probability are unspecified and their assist definition is not verified as identical to FPL's.",
            "Next-gameweek and three-gameweek attacking series can differ on the same gameweek. They are kept separate and do not change the numerical points forecast.",
        ],
    }

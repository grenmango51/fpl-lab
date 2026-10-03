"""Public data acquisition with local caching and explicit provenance."""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import logging
import os
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import httpx

from .references import FEEDS as REFERENCE_FEEDS, build_reference

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "cache"
FPL = "https://fantasy.premierleague.com/api"
ARCHIVE = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"
log = logging.getLogger(__name__)
_lock = threading.RLock()
_dataset = None
_loaded = 0.0
_statuses: dict[str, dict] = {}


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def archive_payload(key, raw, meta):
    path = ROOT / "data" / "raw" / key / f"{meta['sha256']}.payload.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        try:
            with path.open("xb") as file:
                file.write(gzip.compress(raw, mtime=0))
            path.with_suffix(".meta.json").write_text(
                json.dumps({k: v for k, v in meta.items() if k != "body"}, indent=2),
                encoding="utf-8",
            )
        except FileExistsError:
            pass
    return str(path.relative_to(ROOT))


def fetch(url: str, key: str, ttl=3600, *, optional=False, form=None, refresh=False):
    """Return text. A stale cache is labelled and never silently substituted."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{key}.json"
    old = None
    if path.exists():
        try:
            old = json.loads(path.read_text(encoding="utf-8"))
            if old.get("request_form") != form:
                old = None
            if old and not refresh and time.time() - old["fetched_epoch"] < ttl:
                recovered = old["body"].encode("utf-8")
                if hashlib.sha256(recovered).hexdigest() == old.get("sha256"):
                    old["raw_archive"] = archive_payload(key, recovered, old)
                _statuses[key] = {k: v for k, v in old.items() if k != "body"}
                _statuses[key]["status"] = "cached"
                return old["body"]
        except (ValueError, KeyError):
            old = None
    try:
        with httpx.Client(
            timeout=35,
            follow_redirects=True,
            headers={"User-Agent": "OpenFPL/0.1 personal research"},
        ) as client:
            response = (
                client.post(url, data=form) if form is not None else client.get(url)
            )
            response.raise_for_status()
        raw = response.content
        body = raw.decode("utf-8-sig", errors="replace")
        meta = {
            "url": url,
            "fetched_at": utcnow(),
            "fetched_epoch": time.time(),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
            "status": "live",
            "last_modified": response.headers.get("last-modified"),
            "content_type": response.headers.get("content-type"),
        }
        if form is not None:
            meta.update({"request_method": "POST", "request_form": form})
        meta["raw_archive"] = archive_payload(key, raw, meta)
        temp = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        temp.write_text(
            json.dumps({**meta, "body": body}, ensure_ascii=False), encoding="utf-8"
        )
        os.replace(temp, path)
        _statuses[key] = meta
        return body
    except Exception as exc:
        message = f"{type(exc).__name__}: {str(exc)[:180]}"
        if old:
            _statuses[key] = {
                **{k: v for k, v in old.items() if k != "body"},
                "status": "stale",
                "error": message,
            }
            return old["body"]
        _statuses[key] = {
            "url": url,
            "status": "unavailable",
            "error": message,
            "fetched_at": None,
        }
        if optional:
            log.warning("Optional source %s unavailable: %s", key, message)
            return None
        raise RuntimeError(
            f"Cannot load {key}; no cached data available. {message}"
        ) from exc


def number(value, default=0.0):
    try:
        n = float(value)
        return n if n == n and abs(n) != float("inf") else default
    except (ValueError, TypeError):
        return default


def source_metadata(key):
    """Read acquisition provenance, including sources fetched after dataset load."""
    with _lock:
        return dict(_statuses.get(key, {}))


ALIASES = {
    "Manchester City": "MCI",
    "Man City": "MCI",
    "Manchester United": "MUN",
    "Man Utd": "MUN",
    "Tottenham": "TOT",
    "Tottenham Hotspur": "TOT",
    "Spurs": "TOT",
    "Nottingham Forest": "NFO",
    "Nott'm Forest": "NFO",
    "Brighton and Hove Albion": "BHA",
    "Brighton": "BHA",
    "Wolverhampton Wanderers": "WOL",
    "Wolves": "WOL",
    "West Ham": "WHU",
    "West Ham United": "WHU",
    "Newcastle United": "NEW",
    "Newcastle": "NEW",
    "Leicester City": "LEI",
    "Leicester": "LEI",
    "Ipswich Town": "IPS",
    "Ipswich": "IPS",
    "Hull City": "HUL",
    "Hull": "HUL",
    "Coventry City": "COV",
    "Coventry": "COV",
    "Leeds United": "LEE",
    "Leeds": "LEE",
    "Luton Town": "LUT",
    "Luton": "LUT",
    "Sheffield United": "SHU",
    "Sheffield Utd": "SHU",
}
for name, code in [
    ("Arsenal", "ARS"),
    ("Aston Villa", "AVL"),
    ("Bournemouth", "BOU"),
    ("Brentford", "BRE"),
    ("Chelsea", "CHE"),
    ("Crystal Palace", "CRY"),
    ("Everton", "EVE"),
    ("Fulham", "FUL"),
    ("Liverpool", "LIV"),
    ("Sunderland", "SUN"),
    ("Burnley", "BUR"),
    ("Southampton", "SOU"),
]:
    ALIASES[name] = code


def load_archive(season: str):
    raw_players = fetch(
        f"{ARCHIVE}/{season}/players_raw.csv",
        f"archive_{season}_players",
        365 * 86400,
        optional=True,
    )
    raw_gws = fetch(
        f"{ARCHIVE}/{season}/gws/merged_gw.csv",
        f"archive_{season}_gws",
        365 * 86400,
        optional=True,
    )
    if not raw_players or not raw_gws:
        return []
    ids = {int(p["id"]): p for p in csv.DictReader(io.StringIO(raw_players))}
    result = []
    for row in csv.DictReader(io.StringIO(raw_gws)):
        player = ids.get(int(row["element"]))
        if not player or not row.get("kickoff_time"):
            continue
        pos = int(player["element_type"])
        if pos not in (1, 2, 3, 4):
            continue  # Archived assistant managers use a separate scoring game.
        was_home = row.get("was_home", "").lower() == "true"
        team = ALIASES.get(row.get("team", ""), row.get("team", ""))
        result.append(
            {
                "code": int(player["code"]),
                "season": season,
                "gw": int(row.get("GW") or row.get("round") or 0),
                "date": row["kickoff_time"],
                "fixture": f"{season}:{row['fixture']}",
                "team": team,
                "position": pos,
                "home": was_home,
                "opponent_id": int(row.get("opponent_team") or 0),
                "price": number(row.get("value")) / 10,
                "team_goals": number(
                    row.get("team_h_score") if was_home else row.get("team_a_score")
                ),
                "opponent_goals": number(
                    row.get("team_a_score") if was_home else row.get("team_h_score")
                ),
                **{
                    k: number(row.get(k))
                    for k in [
                        "minutes",
                        "starts",
                        "total_points",
                        "expected_goals",
                        "expected_assists",
                        "expected_goals_conceded",
                        "goals_scored",
                        "assists",
                        "bonus",
                        "saves",
                        "yellow_cards",
                        "red_cards",
                        "own_goals",
                        "penalties_missed",
                        "penalties_saved",
                        "defensive_contribution",
                        "clearances_blocks_interceptions",
                        "tackles",
                        "recoveries",
                    ]
                },
            }
        )
    # Opponent IDs are season-specific; resolve from both sides of each fixture.
    sides = defaultdict(set)
    for row in result:
        sides[row["fixture"]].add(row["team"])
    for row in result:
        row["opponent"] = next(
            (t for t in sides[row["fixture"]] if t != row["team"]), ""
        )
    return sorted(result, key=lambda r: (r["date"], r["code"]))


def load_elevenify(joe, teams, *, refresh=False):
    source = joe.get("supplementalProjections", {}).get("source", {})
    url = (
        source.get("url")
        or "https://docs.google.com/spreadsheets/d/1rJaMd03-t5ovug0Zn8fY9jJ1_H0C8PDSC10HqbdwSyk/edit"
    )
    import re

    match = re.search(r"docs\.google\.com/spreadsheets/d/([A-Za-z0-9_-]+)", url)
    if not match:
        return {}
    csv_url = f"https://docs.google.com/spreadsheets/d/{match.group(1)}/export?format=csv&gid=0"
    raw = fetch(csv_url, "elevenify_sheet", 3600, optional=True, refresh=refresh)
    if not raw:
        return {}
    tables = []
    current = None
    for row in csv.reader(io.StringIO(raw)):
        if "Team" in row and "GW1" in row:
            index = row.index("Team")
            current = {
                "index": index,
                "columns": {
                    int(v[2:]): i
                    for i, v in enumerate(row)
                    if re.fullmatch(r"GW\d+", v)
                },
                "teams": {},
            }
            tables.append(current)
        elif current and len(row) > current["index"]:
            name = row[current["index"]]
            code = ALIASES.get(name)
            if code:
                try:
                    values = {
                        gw: float(row[col])
                        for gw, col in current["columns"].items()
                        if col < len(row) and row[col] != ""
                    }
                except ValueError:
                    continue
                current["teams"][code] = values
    if len(tables) != 2:
        _statuses["elevenify_sheet"]["validation"] = "Unexpected sheet schema; ignored."
        return {}
    current_codes = {t["short_name"] for t in teams.values()}
    if (
        set(tables[0]["teams"]) != current_codes
        or set(tables[1]["teams"]) != current_codes
    ):
        _statuses["elevenify_sheet"]["validation"] = (
            "Sheet team set differs from current season; ignored."
        )
        return {}
    if any(
        not 0 <= v <= 8 for vals in tables[0]["teams"].values() for v in vals.values()
    ) or any(
        not 0 <= v <= 1 for vals in tables[1]["teams"].values() for v in vals.values()
    ):
        _statuses["elevenify_sheet"]["validation"] = (
            "Implausible goals/CS values; ignored."
        )
        return {}
    return {
        "goals": tables[0]["teams"],
        "clean_sheets": tables[1]["teams"],
        "source_at": _statuses["elevenify_sheet"]["fetched_at"],
        "url": csv_url,
    }


def load_fplform(season, start, players, teams, *, refresh=False):
    """Normal public export; only the next three GWs anchor our live ensemble."""
    key = f"fplform_{season}_gw{start}"
    form = {
        "firstgw": str(start),
        "lastgw": str(min(38, start + 2)),
        "all": "1",
        "submit": "submit",
    }
    raw = fetch(
        "https://www.fplform.com/export-fpl-form-data.php",
        key,
        3600,
        optional=True,
        form=form,
        refresh=refresh,
    )
    if not raw:
        return {}
    forecasts = {}
    verified = 0
    try:
        for row in csv.DictReader(io.StringIO(raw)):
            pid = int(row["ID"])
            p = players.get(pid)
            if p is None or row.get("Team") != teams[p["team"]]["short_name"]:
                continue
            if row.get("Pos") not in {
                "GK"
                if p["element_type"] == 1
                else {2: "DEF", 3: "MID", 4: "FWD"}.get(p["element_type"])
            }:
                continue
            # Price tolerance allows an update during the source's cache window.
            if abs(float(row["Price"]) - p["now_cost"] / 10) > 0.2:
                continue
            points = {}
            probabilities = {}
            for gw in range(start, min(39, start + 3)):
                value = float(row[f"{gw}_with_prob"])
                prob = float(row[f"{gw}_prob"])
                if not -5 <= value <= 60 or not 0 <= prob <= 1:
                    raise ValueError("Invalid points or appearance probability")
                points[str(gw)] = value
                # This column describes the first fixture only. Never use it
                # as whole-GW appearance probability in a double.
                probabilities[str(gw)] = prob
            forecasts[str(pid)] = {"points": points, "probabilities": probabilities}
            verified += 1
    except (ValueError, KeyError, TypeError):
        _statuses[key]["validation"] = "Unexpected CSV schema; provider ignored."
        return {}
    if verified < 0.8 * len(players):
        _statuses[key]["validation"] = (
            "Too few IDs/club/price matches for current season; provider ignored."
        )
        return {}
    return {
        "players": forecasts,
        "name": "FPL Form",
        "source_at": _statuses[key]["fetched_at"],
        "url": "https://www.fplform.com/export-fpl-form-data",
        "weeks": list(range(start, min(39, start + 3))),
        "matched_players": verified,
    }


def load_elevenify_reference(season, start, players, teams, *, refresh=False):
    """Read only the normal published assets; unavailable references are optional."""
    raw_by_feed = {
        feed: fetch(
            config["url"], config["source_key"], 3600, optional=True, refresh=refresh
        )
        for feed, config in REFERENCE_FEEDS.items()
    }
    reference = build_reference(
        raw_by_feed, _statuses, players, teams, season=season, next_gw=start
    )
    for feed in reference["feeds"].values():
        if feed["validation"]:
            _statuses.setdefault(feed["source_key"], {})["validation"] = feed[
                "validation"
            ]
    return reference


def get_data(force=False, *, refresh_live=False):
    global _dataset, _loaded
    with _lock:
        if (
            _dataset is not None
            and not force
            and not refresh_live
            and time.time() - _loaded < 900
        ):
            return _dataset
        refresh = force or refresh_live
        # Explicit cache bypass retains the old envelope for a labelled stale
        # fallback; deadline captures refresh live inputs, not completed history.
        bootstrap = json.loads(
            fetch(f"{FPL}/bootstrap-static/", "fpl_bootstrap", 900, refresh=refresh)
        )
        fixtures = json.loads(
            fetch(f"{FPL}/fixtures/", "fpl_fixtures", 3600, refresh=refresh)
        )
        teams = {t["id"]: t for t in bootstrap["teams"]}
        players = {p["id"]: p for p in bootstrap["elements"]}
        next_event = next((e for e in bootstrap["events"] if e.get("is_next")), None)
        if next_event is None:
            next_event = next(
                (e for e in bootstrap["events"] if not e["finished"]),
                bootstrap["events"][-1],
            )
        year = int(bootstrap["events"][0]["deadline_time"][:4])
        season = f"{year}-{str(year + 1)[-2:]}"
        joe_url = f"https://www.fpljoe.com/api/odds/projections?competition=premier-league&season={season}&scope=season%3A{season}"
        joe_text = fetch(joe_url, "fpljoe", 3600, optional=True, refresh=refresh)
        try:
            joe = json.loads(joe_text) if joe_text else {}
            if not isinstance(joe, dict) or not isinstance(
                joe.get("projectionsByPeriod", {}), dict
            ):
                raise ValueError("Unexpected provider schema")
        except ValueError:
            joe = {}
            _statuses["fpljoe"]["validation"] = (
                "Unexpected provider JSON; using historical fallback."
            )
        elevenify = load_elevenify(joe, teams, refresh=refresh)
        fplform = load_fplform(
            season, next_event["id"], players, teams, refresh=refresh
        )
        elevenify_reference = load_elevenify_reference(
            season, next_event["id"], players, teams, refresh=refresh
        )
        history = []
        for start in range(year - 3, year):
            history.extend(load_archive(f"{start}-{str(start + 1)[-2:]}"))
        current = []
        for event in bootstrap["events"]:
            if not event.get("finished"):
                continue
            raw = fetch(
                f"{FPL}/event/{event['id']}/live/",
                f"fpl_live_{season}_{event['id']}",
                6 * 3600,
                optional=True,
                refresh=force,
            )
            if not raw:
                continue
            gwfixtures = [
                f for f in fixtures if f["event"] == event["id"] and f["finished"]
            ]
            by_id = {f["id"]: f for f in gwfixtures}
            for entry in json.loads(raw)["elements"]:
                p = players.get(entry["id"])
                if not p:
                    continue
                explained = [
                    by_id[e["fixture"]]
                    for e in entry.get("explain", [])
                    if e["fixture"] in by_id
                ]
                matching = explained or [
                    f for f in gwfixtures if p["team"] in (f["team_h"], f["team_a"])
                ]
                # An aggregate live row cannot be disaggregated for double GWs.
                # Fetch that player's fixture history instead of duplicating its totals.
                if len(matching) > 1:
                    continue
                for f in matching:
                    home = p["team"] == f["team_h"]
                    actual_team = f["team_h"] if home else f["team_a"]
                    current.append(
                        {
                            "code": p["code"],
                            "season": season,
                            "gw": event["id"],
                            "date": f["kickoff_time"],
                            "fixture": f"{season}:{f['id']}",
                            "team": teams[actual_team]["short_name"],
                            "opponent": teams[f["team_a"] if home else f["team_h"]][
                                "short_name"
                            ],
                            "position": p["element_type"],
                            "home": home,
                            "price": p["now_cost"] / 10,
                            "team_goals": f["team_h_score"]
                            if home
                            else f["team_a_score"],
                            "opponent_goals": f["team_a_score"]
                            if home
                            else f["team_h_score"],
                            **{
                                k: number(v)
                                for k, v in entry["stats"].items()
                                if k not in ("in_dreamteam", "played")
                            },
                        }
                    )
        history.extend(current)
        _dataset = {
            "bootstrap": bootstrap,
            "fixtures": fixtures,
            "teams": teams,
            "players": players,
            "joe": joe,
            "elevenify": elevenify,
            "fplform": fplform,
            "elevenify_reference": elevenify_reference,
            "history": history,
            "season": season,
            "next_gw": next_event["id"],
            "sources": dict(_statuses),
            "loaded_at": utcnow(),
        }
        _loaded = time.time()
        return _dataset


if __name__ == "__main__":
    d = get_data()
    print(
        json.dumps(
            {
                "season": d["season"],
                "players": len(d["players"]),
                "history_rows": len(d["history"]),
                "next_gw": d["next_gw"],
                "sources": {
                    k: {"status": v["status"], "bytes": v.get("bytes")}
                    for k, v in d["sources"].items()
                },
            },
            indent=2,
        )
    )

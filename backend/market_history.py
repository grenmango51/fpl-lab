"""Local public market observations; never derived from player scenarios."""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

from .data import ALIASES, ROOT

PRIOR = Path("D:/Hoai Anh/Aalto/Hobbies/Football/Statsbomb play around/fpl-lab/data")
SOURCES = ("fpljoe", "elevenify_sheet")


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("A timezone-aware ISO timestamp is required")
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Invalid timestamp") from exc
    if dt.tzinfo is None:
        raise ValueError("Timestamp needs a timezone")
    return dt.astimezone(timezone.utc).isoformat()


def _records(roots, key, diagnostics):
    records = {}
    for root in roots:
        paths = list((root / "raw" / key).glob("*.payload.meta.json"))
        paths += list((root / "history" / "market" / key).glob("*.json"))
        cache = root / "cache" / f"{key}.json"
        if cache.exists():
            paths.append(cache)
        for path in paths:
            try:
                meta = json.loads(path.read_text(encoding="utf-8"))
                raw = (meta["body"].encode("utf-8") if "body" in meta else
                       gzip.decompress(path.with_suffix("").with_suffix(".gz").read_bytes()))
                digest = hashlib.sha256(raw).hexdigest()
                if digest != meta.get("sha256"):
                    diagnostics["hash_mismatch"] += 1
                    continue
                at = timestamp(meta["fetched_at"])
                record = {"at": at, "sha256": digest, "raw": raw, "meta": meta}
                # Content-addressed archives preserve first real extraction only.
                if digest not in records or at < records[digest]["at"]:
                    records[digest] = record
            except (OSError, ValueError, KeyError, TypeError):
                diagnostics["invalid_archive"] += 1
    return sorted(records.values(), key=lambda r: r["at"])


def _optional_time(value):
    try:
        return timestamp(value)
    except ValueError:
        try:
            return timestamp(parsedate_to_datetime(value).isoformat())
        except (ValueError, TypeError, AttributeError):
            return None


def _number(value, maximum):
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        return None
    return float(value) if math.isfinite(value) and 0 <= value <= maximum else None


def build_history(records, bootstraps, fixtures, *, gameweek=None, team=None,
                  source=None, since=None, until=None, fixture_id=None, diagnostics=None):
    """Pure normalisation/query helper for offline verification."""
    diagnostics = Counter() if diagnostics is None else diagnostics
    since = timestamp(since) if since else None
    until = timestamp(until) if until else None
    if since and until and since > until:
        raise ValueError("since must precede until")
    if source and source not in SOURCES:
        raise ValueError("Unknown market source")
    if gameweek is not None and (isinstance(gameweek, bool) or not 1 <= gameweek <= 38):
        raise ValueError("gameweek must be 1–38")
    series = {}
    used = set()
    def before(items, at):
        return max((r for r in items if r["at"] <= at), key=lambda r: r["at"], default=None)
    for record in sorted(records, key=lambda r: r["at"]):
        at, src = record["at"], record["source"]
        if (source and source != src) or (since and at < since) or (until and at > until):
            continue
        bs, fs = before(bootstraps, at), before(fixtures, at)
        if not bs or not fs:
            diagnostics["missing_contemporaneous_mapping"] += 1
            continue
        clubs = {t["id"]: t["short_name"] for t in json.loads(bs["raw"])["teams"]}
        matches = json.loads(fs["raw"])
        def add(f, club, metric, value, provider_at, season):
            gw = f.get("event")
            home, away = clubs.get(f["team_h"]), clubs.get(f["team_a"])
            if not home or not away or (gameweek and gameweek != gw) or (team and team != club) or (fixture_id and fixture_id != f["id"]):
                return
            key = (season, f["id"], f.get("code"), home, away, club, src, metric)
            row = series.setdefault(key, dict(season=season, fixture_id=f["id"], gameweek=gw,
                home=home, away=away, team=club, source=src, metric=metric,
                unit="goals" if metric == "goals" else "percentage_points", points=[]))
            row["points"].append(dict(extracted_at=at, provider_at=_optional_time(provider_at),
                provider_time_kind="fixture_snapshot" if src == "fpljoe" else "http_last_modified",
                value=value, sha256=record["sha256"], mapping_sha256=bs["sha256"],
                fixture_mapping_sha256=fs["sha256"]))
            used.add((src, record["sha256"]))
        if src == "fpljoe":
            payload = json.loads(record["raw"])
            season = payload.get("season")
            if not season:
                diagnostics["unknown_season"] += 1
                continue
            for period in payload.get("projectionsByPeriod", {}).values():
                for market in period.get("fixtures", []):
                    candidates = [f for f in matches if f.get("event") == market.get("gw") and
                        clubs.get(f["team_h"]) == market.get("homeTeamCode") and
                        clubs.get(f["team_a"]) == market.get("awayTeamCode")]
                    if len(candidates) != 1:
                        diagnostics["unmatched_fixture"] += 1
                        continue
                    f = candidates[0]
                    # Kickoff disagreements require a new verified mapping, not guessing.
                    if market.get("kickoffTsUtc") and f.get("kickoff_time") and _optional_time(market["kickoffTsUtc"]) != _optional_time(f["kickoff_time"]):
                        diagnostics["kickoff_mismatch"] += 1
                        continue
                    for side, club in (("Home", clubs[f["team_h"]]), ("Away", clubs[f["team_a"]])):
                        for metric, field, limit in (("goals", "lambda" + side, 8), ("clean_sheet_probability", "p" + side + "Cs", 1)):
                            value = _number(market.get(field), limit)
                            add(f, club, metric, value * 100 if value is not None and limit == 1 else value,
                                market.get("snapshotTsUtc"), season)
        else:
            # Season inferred only from a contemporaneously acquired Joe season record.
            joe = before([r for r in records if r["source"] == "fpljoe"], at)
            if not joe:
                diagnostics["unknown_sheet_season"] += 1
                continue
            season = json.loads(joe["raw"]).get("season")
            tables, current = [], None
            for cells in csv.reader(io.StringIO(record["raw"].decode("utf-8-sig"))):
                if "Team" in cells and "GW1" in cells:
                    current = (cells.index("Team"), {int(v[2:]): i for i, v in enumerate(cells) if v.startswith("GW") and v[2:].isdigit()})
                    tables.append([])
                elif current and len(cells) > current[0]:
                    club = ALIASES.get(cells[current[0]])
                    if club in clubs.values():
                        tables[-1].append((club, cells, current[1]))
            if len(tables) != 2:
                diagnostics["invalid_sheet_schema"] += 1
                continue
            for index, table in enumerate(tables):
                for club, cells, columns in table:
                    for gw, col in columns.items():
                        eligible = [f for f in matches if f.get("event") == gw and club in (clubs.get(f["team_h"]), clubs.get(f["team_a"]))]
                        if len(eligible) != 1:
                            diagnostics["sheet_non_single_fixture"] += 1
                            continue
                        try:
                            value = _number(float(cells[col]), 8 if index == 0 else 1)
                        except (ValueError, IndexError):
                            value = None
                        add(eligible[0], club, "goals" if index == 0 else "clean_sheet_probability",
                            value * 100 if value is not None and index == 1 else value,
                            record["meta"].get("last_modified"), season)
    for row in series.values():
        # Avoid duplicate recovery copies and ambiguous simultaneous extraction.
        row["points"] = list({p["extracted_at"]: p for p in row["points"]}.values())
        points = row["points"]
        row["latest"] = points[-1]
        row["previous"] = next((p for p in reversed(points[:-1]) if p["value"] is not None), None)
        row["delta"] = None
        row["state"] = "single_snapshot"
        if row["latest"]["value"] is None:
            row["state"] = "missing_latest"
        elif row["previous"]:
            row["state"] = "comparable"
            row["delta"] = row["latest"]["value"] - row["previous"]["value"]
    rows = sorted(series.values(), key=lambda r: (r["gameweek"] or 0, r["fixture_id"], r["source"], r["team"], r["metric"]))
    times = [p["extracted_at"] for r in rows for p in r["points"]]
    return dict(series=rows, diagnostics=dict(diagnostics), coverage=dict(snapshots=len(used),
        fixtures=len({(r["season"],r["fixture_id"]) for r in rows}), series=len(rows),
        comparable_series=sum(r["state"] == "comparable" for r in rows),
        teams=sorted({r["team"] for r in rows}), gameweeks=sorted({r["gameweek"] for r in rows if r["gameweek"]}),
        first_extracted_at=min(times, default=None), last_extracted_at=max(times, default=None)),
        notes=["Extraction times are not publication times. Missing observations stay missing.",
               "Elevenify sheet season is inferred from contemporaneous Joe metadata; only single-fixture weeks map.",
               "Changed whole-feed hashes may repeat unchanged fixture values. No model scenarios are included."])


def market_history(*, roots=None, **filters):
    roots = [Path(p) for p in roots] if roots is not None else [ROOT / "data", PRIOR]
    diagnostics = Counter()
    def validated(key):
        result = []
        for record in _records(roots, key, diagnostics):
            try:
                if key != "elevenify_sheet":
                    payload = json.loads(record["raw"])
                    if key == "fpljoe":
                        assert isinstance(payload, dict) and isinstance(payload.get("projectionsByPeriod", {}), dict)
                        for period in payload.get("projectionsByPeriod", {}).values():
                            assert isinstance(period, dict) and isinstance(period.get("fixtures", []), list)
                            assert all(isinstance(row, dict) for row in period.get("fixtures", []))
                    elif key == "fpl_bootstrap":
                        assert isinstance(payload, dict) and isinstance(payload["teams"], list)
                        assert all(isinstance(t["id"], int) and isinstance(t["short_name"], str) for t in payload["teams"])
                    else:
                        assert isinstance(payload, list)
                        assert all(isinstance(f["id"], int) and isinstance(f["team_h"], int) and isinstance(f["team_a"], int) for f in payload)
                result.append(record)
            except (ValueError, KeyError, TypeError, AssertionError):
                diagnostics["invalid_payload_schema"] += 1
        return result
    records = [{**r, "source": key} for key in SOURCES for r in validated(key)]
    return build_history(records, validated("fpl_bootstrap"), validated("fpl_fixtures"),
                         diagnostics=diagnostics, **filters)


def capture_market_history():
    """Preserve existing cache observations, without claiming a new extraction."""
    saved = 0
    for key in (*SOURCES, "fpl_bootstrap", "fpl_fixtures"):
        cache = ROOT / "data" / "cache" / f"{key}.json"
        if not cache.exists():
            continue
        meta = json.loads(cache.read_text(encoding="utf-8"))
        timestamp(meta["fetched_at"])
        if hashlib.sha256(meta["body"].encode("utf-8")).hexdigest() != meta["sha256"]:
            continue
        target = ROOT / "data" / "history" / "market" / key / f"{meta['sha256']}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            with target.open("x", encoding="utf-8") as file:
                json.dump(meta, file)
            saved += 1
        except FileExistsError:
            pass
    return {"saved": saved, "fresh_fetch": False, "coverage": market_history()["coverage"]}

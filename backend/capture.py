"""Deadline-capture provenance and declared source-freshness eligibility."""

from datetime import datetime
import gzip
import json
import re
import zlib
from pathlib import Path

MAX_SOURCE_AGE_SECONDS = 1800


def snapshot_paths(root, season):
    """Include legacy JSON and gzip captures, excluding incomplete temp files."""
    return (
        path
        for path in (Path(root) / "data" / "snapshots").glob(f"{season}_gw*.json*")
        if path.name.endswith((".json", ".json.gz"))
    )


def read_snapshot(path):
    """Read either snapshot format; malformed/truncated data raises to scanners."""
    path = Path(path)
    if path.name.endswith(".json.gz"):
        try:
            with gzip.open(path, "rt", encoding="utf-8") as file:
                return json.load(file)
        except zlib.error as exc:
            raise gzip.BadGzipFile("Invalid compressed snapshot payload") from exc
    if path.name.endswith(".json"):
        with path.open(encoding="utf-8") as file:
            return json.load(file)
    raise ValueError("Unsupported snapshot file extension")


def latest_capture_receipts(root, season):
    """Show the newest saved receipt per GW; no outcomes are inferred here."""
    latest = {}
    for path in sorted(snapshot_paths(root, season), reverse=True):
        match = re.search(r"_gw(\d+)_", path.name)
        if not match or int(match[1]) in latest:
            continue
        try:
            record = read_snapshot(path)
            if not isinstance(record, dict):
                continue
            recorded, deadline = (
                source_time(record.get("recorded_at")),
                source_time(record.get("deadline")),
            )
            if recorded is None or deadline is None or recorded >= deadline:
                continue
            gw = int(match[1])
            latest[gw] = {
                "gw": gw,
                "filename": path.name,
                "recorded_at": record["recorded_at"],
                "deadline": record["deadline"],
                "lead_hours": (deadline - recorded).total_seconds() / 3600,
                "players": len(record.get("players", [])),
                "capture_receipt": record.get("capture_receipt"),
            }
        except (OSError, EOFError, ValueError, TypeError):
            continue
    return [latest[gw] for gw in sorted(latest, reverse=True)]


def source_time(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None else None
    except (AttributeError, TypeError, ValueError):
        return None


def capture_receipt(
    before, dataset, payload, component, request, started, finished, *, target_gw=None
):
    sources = {}
    for key, meta in dataset["sources"].items():
        fetched = source_time(meta.get("fetched_at"))
        previous = before.get("sources", {}).get(key, {})
        sources[key] = {
            "url": meta.get("url"),
            "status": meta.get("status", "unknown"),
            "fetched_at": meta.get("fetched_at"),
            "sha256": meta.get("sha256"),
            "last_modified": meta.get("last_modified"),
            "age_seconds": (finished - fetched).total_seconds() if fetched else None,
            "refetched": bool(fetched and started <= fetched <= finished),
            "content_changed": meta.get("sha256") != previous.get("sha256")
            if previous.get("sha256") and meta.get("sha256")
            else None,
            "validation": meta.get("validation"),
        }
    gw = str(target_gw if target_gw is not None else payload["next_gw"])
    fixture_sources = {
        fixture["source"]
        for player in component["players"]
        for fixture in player["gw"][gw]["fixtures"]
    }
    core = ["fpl_bootstrap", "fpl_fixtures"]
    if any("FPL Joe" in source for source in fixture_sources):
        core.append("fpljoe")
    if "Elevenify · public sheet" in fixture_sources:
        core.append("elevenify_sheet")
    form_key = f"fplform_{dataset['season']}_gw{dataset['next_gw']}"
    required = {
        "Component model": core,
        "FPL Form": ["fpl_bootstrap", "fpl_fixtures", form_key],
        "Live ensemble": core
        + ([form_key] if request.use_provider and request.provider_weight > 0 else []),
    }
    reasons = {}
    provider_available = any(
        gw in player.get("points", {})
        for player in dataset.get("fplform", {}).get("players", {}).values()
    )
    for name, keys in required.items():
        problems = []
        for key in keys:
            meta = sources.get(key, {})
            if meta.get("status") not in ("live", "cached"):
                problems.append(f"{key}: {meta.get('status', 'unavailable')} input.")
            age = meta.get("age_seconds")
            if age is None or not 0 <= age <= MAX_SOURCE_AGE_SECONDS:
                problems.append(
                    f"{key}: extraction time unknown, future, or older than 30 minutes."
                )
            if meta.get("validation"):
                problems.append(f"{key}: source validation failed.")
        if name == "FPL Form" and not provider_available:
            problems.append(
                f"No validated FPL Form forecasts were supplied for GW{gw}."
            )
        if (
            name == "Live ensemble"
            and request.custom_points
            and request.blend_weight > 0
        ):
            problems.append(
                "Imported CSV extraction time is not independently established."
            )
        if name == "Live ensemble" and any(
            gw in weeks for weeks in getattr(request, "stat_schedule", {}).values()
        ):
            problems.append("User-assumed player stats are a planning scenario, not an independently sourced forecast.")
        reasons[name] = problems
    return {
        "capture_started_at": started.isoformat(),
        "capture_finished_at": finished.isoformat(),
        "dataset_loaded_at": dataset["loaded_at"],
        "target_season": dataset["season"],
        "target_gameweek": int(gw),
        "origin_gameweek": dataset["next_gw"],
        "comparison_models": ["Component model", "Live ensemble"]
        + (["FPL Form"] if provider_available else []),
        "max_source_age_seconds": MAX_SOURCE_AGE_SECONDS,
        "sources": sources,
        "required_sources": required,
        "eligible_primary": {name: not notes for name, notes in reasons.items()},
        "eligibility_reasons": reasons,
        "fixture_sources": sorted(fixture_sources),
        "method": "One frozen dataset for all models. Primary input eligibility requires used live sources with validated live/cached status and extraction age at most 30 minutes. Eligibility does not establish model accuracy or an independent provider publication time.",
    }

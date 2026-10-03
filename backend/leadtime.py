"""Frozen, predeclared deadline-lead cohorts for prospective forecast evaluation."""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

from .capture import read_snapshot, snapshot_paths, source_time
from .data import FPL, ROOT, fetch, get_data, source_metadata
from .prospective import captured_models, finite_number, score_cohorts


BIN_EDGES = (0, 24, 72, 168, 336, 672)
BINS = tuple(
    {
        "id": f"{low}-{BIN_EDGES[i + 1]}" if i + 1 < len(BIN_EDGES) else f"{low}+",
        "label": (
            "<24 hours",
            "1–3 days",
            "3–7 days",
            "1–2 weeks",
            "2–4 weeks",
            "4+ weeks",
        )[i],
        "min_hours": low,
        "max_hours": BIN_EDGES[i + 1] if i + 1 < len(BIN_EDGES) else None,
    }
    for i, low in enumerate(BIN_EDGES)
)
METHOD = (
    "Latest strictly pre-deadline capture per target GW and predeclared lead bin. "
    "Lead is measured against the frozen official target deadline; changed deadlines "
    "remain in their original bin and are exploratory. Captured component-model "
    "45+ projected minutes define eligibility (legacy ensemble fallback). Pairwise "
    "models use identical player IDs. Aggregate errors weight individual player-GW "
    "observations equally within each bin, not gameweek MAEs. Primary comparisons "
    "require target-specific fresh-input receipts and checked, live/cached official outcomes."
)


def lead_bin(hours):
    if not finite_number(hours) or hours <= 0:
        return None
    return next(b["id"] for b in reversed(BINS) if hours >= b["min_hours"])


def finite_json(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            if not math.isfinite(value):
                return None
        except OverflowError:
            return None
    if isinstance(value, dict):
        return {k: finite_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [finite_json(v) for v in value]
    return value


def _players(rows):
    if not isinstance(rows, list):
        raise ValueError("Target players must be a list")
    result, seen = [], set()
    for row in rows:
        if (
            not isinstance(row, dict)
            or not isinstance(row.get("id"), int)
            or isinstance(row["id"], bool)
            or row["id"] <= 0
            or row["id"] in seen
        ):
            raise ValueError("Target contains invalid or duplicate player IDs")
        try:
            if not math.isfinite(row["id"]):
                raise ValueError("Target player ID is not finite")
        except OverflowError:
            raise ValueError("Target player ID is outside the numeric range") from None
        if not isinstance(row.get("forecast"), dict):
            raise ValueError("Target player forecast is missing")
        if "component_forecast" in row and not isinstance(
            row["component_forecast"], dict
        ):
            raise ValueError("Target component forecast is malformed")
        if "models" in row and not isinstance(row["models"], dict):
            raise ValueError("Target model forecasts are malformed")
        result.append(finite_json(row))
        seen.add(row["id"])
    return result


def _select(data, root, now):
    if now.tzinfo is None:
        raise ValueError("Evaluation time must be timezone-aware")
    events = {
        e["id"]: e
        for e in data["bootstrap"]["events"]
        if isinstance(e, dict) and isinstance(e.get("id"), int)
    }
    selected, diagnostics = {}, []
    for path in sorted(snapshot_paths(root, data["season"])):
        try:
            record = read_snapshot(path)
            if (
                not isinstance(record, dict)
                or record.get("season", data["season"]) != data["season"]
            ):
                raise ValueError("Snapshot season does not match the evaluation season")
            recorded = source_time(record.get("recorded_at"))
            if recorded is None or recorded > now:
                raise ValueError("Capture time is invalid, naive or in the future")
            targets = record.get("future_targets", {})
            if not isinstance(targets, dict):
                raise ValueError("Future targets must be a gameweek mapping")
            targets = dict(targets)
            match = re.search(r"_gw(\d+)_", path.name)
            legacy_gw = record.get("gameweek", int(match[1]) if match else None)
            if "players" in record and "deadline" in record and legacy_gw is not None:
                targets.setdefault(str(legacy_gw), record)
            for key, target in targets.items():
                try:
                    gw = int(key)
                    if (
                        str(gw) != str(key)
                        or not 1 <= gw <= 38
                        or not isinstance(target, dict)
                        or target.get("gameweek", gw) != gw
                    ):
                        raise ValueError("Invalid target gameweek")
                    deadline = source_time(target.get("deadline"))
                    if deadline is None:
                        raise ValueError("Target deadline is invalid or naive")
                    hours = (deadline - recorded).total_seconds() / 3600
                    bin_id = lead_bin(hours)
                    if bin_id is None:
                        raise ValueError(
                            "Capture is at or after its stored target deadline"
                        )
                    normalized = {
                        "players": _players(target.get("players")),
                        "capture_receipt": finite_json(target.get("capture_receipt")),
                    }
                    frozen_fixtures = target.get("fixtures")
                    if frozen_fixtures is not None and (
                        not isinstance(frozen_fixtures, list)
                        or any(not isinstance(f, dict) for f in frozen_fixtures)
                    ):
                        raise ValueError(
                            "Frozen fixtures must be a list of fixture records"
                        )
                    candidate = {
                        "gw": gw,
                        "bin_id": bin_id,
                        "snapshot": path.name,
                        "recorded_at": record["recorded_at"],
                        "recorded": recorded,
                        "deadline": target["deadline"],
                        "stored_deadline": deadline,
                        "lead_hours": hours,
                        "model_version": record.get("model_version", "unknown"),
                        "origin_gameweek": record.get("origin_gameweek", legacy_gw),
                        "configuration_hash": record.get("configuration_hash"),
                        "configuration_present": isinstance(
                            record.get("configuration"), dict
                        ),
                        "manual_configuration": bool(
                            isinstance(record.get("configuration"), dict)
                            and (
                                record["configuration"].get("overrides")
                                or record["configuration"].get("minutes_schedule")
                                or (
                                    record["configuration"].get("custom_points")
                                    and record["configuration"].get("blend_weight", 0)
                                )
                            )
                        ),
                        "target": normalized,
                        "fixtures": [
                            {
                                field: finite_json(f.get(field))
                                for field in ("id", "team_h", "team_a", "kickoff_time")
                            }
                            for f in frozen_fixtures
                        ]
                        if frozen_fixtures is not None
                        else None,
                    }
                    old = selected.get((gw, bin_id))
                    if old is None or (recorded, path.name) > (
                        old["recorded"],
                        old["snapshot"],
                    ):
                        selected[(gw, bin_id)] = candidate
                except (ValueError, TypeError, KeyError, OverflowError):
                    diagnostics.append(
                        {
                            "snapshot": path.name,
                            "target": str(key),
                            "reason": "Malformed target or invalid pre-deadline timestamp; ignored.",
                        }
                    )
        except (OSError, EOFError, ValueError, TypeError, KeyError, OverflowError):
            diagnostics.append(
                {
                    "snapshot": path.name,
                    "reason": "Malformed snapshot, season mismatch or invalid capture timestamp; ignored.",
                }
            )
    return selected, events, diagnostics


def _status(item, event):
    current = source_time(event.get("deadline_time")) if event else None
    if current is not None and item["recorded"] >= current:
        return "excluded_current_deadline"
    if not event:
        return "unavailable"
    if not event.get("finished"):
        return "pending"
    if event.get("data_checked") is False:
        return "unchecked"
    return "ready_for_scoring"


def _capture_detail(item, event, current_fixtures=None):
    current = source_time(event.get("deadline_time")) if event else None
    detail = {
        k: item[k]
        for k in (
            "gw",
            "bin_id",
            "snapshot",
            "recorded_at",
            "deadline",
            "lead_hours",
            "model_version",
            "origin_gameweek",
            "configuration_hash",
            "configuration_present",
            "manual_configuration",
            "fixtures",
        )
    }
    detail.update(
        current_deadline=event.get("deadline_time") if event else None,
        deadline_changed=current != item["stored_deadline"],
        actual_data_checked=event.get("data_checked") if event else None,
        capture_receipt=item["target"]["capture_receipt"],
    )
    detail["status"] = _status(item, event)
    known_schedule = item["fixtures"] is not None and isinstance(current_fixtures, list)
    if known_schedule:
        fields = ("id", "team_h", "team_a", "kickoff_time")
        frozen = sorted(
            tuple(str(f.get(field)) for field in fields) for f in item["fixtures"]
        )
        current_schedule = sorted(
            tuple(str(f.get(field)) for field in fields)
            for f in current_fixtures
            if isinstance(f, dict) and f.get("event") == item["gw"]
        )
        detail["fixture_schedule_changed"] = frozen != current_schedule
    else:
        detail["fixture_schedule_changed"] = None
    coverage = score_cohorts(item["target"], {}, {"status": "not_requested"}, None)
    detail["cohort"] = coverage["cohort"]
    detail["coverage"] = coverage["coverage"]
    return detail


def capture_inventory(data=None, root=None, now=None):
    """Read captures without acquiring official actual points."""
    data = data if data is not None else get_data()
    root = Path(root) if root is not None else ROOT
    now = now or datetime.now(timezone.utc)
    selected, events, diagnostics = _select(data, root, now)
    return _inventory(data, selected, events, diagnostics, now)


def _inventory(data, selected, events, diagnostics, now):
    bins = []
    for definition in BINS:
        captures = [
            _capture_detail(item, events.get(item["gw"]), data.get("fixtures"))
            for key, item in sorted(selected.items())
            if key[1] == definition["id"]
        ]
        pending = [c for c in captures if c["status"] != "ready_for_scoring"]
        bins.append(
            {
                **definition,
                "capture_count": len(captures),
                "pending_count": len(pending),
                "ready_count": len(captures) - len(pending),
                "captured_targets": captures,
                "pending_targets": pending,
            }
        )
    return {
        "generated_at": now.isoformat(),
        "season": data["season"],
        "bins": bins,
        "diagnostics": diagnostics,
        "method": METHOD,
    }


def _error_metrics(errors):
    if not errors:
        return None
    count = len(errors)
    scale = max(map(abs, errors))
    return {
        "mae": math.fsum(abs(e) / count for e in errors),
        "rmse": scale * math.sqrt(math.fsum((e / scale) ** 2 / count for e in errors))
        if scale
        else 0,
        "bias": math.fsum(e / count for e in errors),
        "count": count,
    }


def _aggregate(rows):
    return {
        "count": len(rows),
        "gameweek_count": len({r["gw"] for r in rows}),
        "model": _error_metrics([r["model_error"] for r in rows]),
        "ensemble": _error_metrics([r["ensemble_error"] for r in rows]),
        "player_gw_ids": [{"gw": r["gw"], "player_id": r["player_id"]} for r in rows],
        "denominator": "One matched player-GW observation per selected target GW within this lead bin; equal player-GW weights.",
    }


def score(data=None, root=None, now=None, *, save=True):
    data = data if data is not None else get_data()
    root = Path(root) if root is not None else ROOT
    now = now or datetime.now(timezone.utc)
    selected, events, diagnostics = _select(data, root, now)
    inventory = _inventory(data, selected, events, diagnostics, now)
    actuals = {}
    for gw in sorted(
        {
            item["gw"]
            for item in selected.values()
            if _status(item, events.get(item["gw"])) == "ready_for_scoring"
        }
    ):
        event = events.get(gw)
        if not event or not event.get("finished") or event.get("data_checked") is False:
            continue
        url, key = f"{FPL}/event/{gw}/live/", f"leadtime_actual_{data['season']}_{gw}"
        try:
            body = json.loads(fetch(url, key, 3600))
            if not isinstance(body, dict) or not isinstance(body.get("elements"), list):
                raise ValueError("Official outcome schema is invalid")
            lookup = {
                row["id"]: row["stats"]["total_points"]
                for row in body["elements"]
                if isinstance(row, dict)
                and isinstance(row.get("id"), int)
                and isinstance(row.get("stats"), dict)
                and finite_number(row["stats"].get("total_points"))
            }
            actuals[gw] = (
                lookup,
                {"url": url, "status": "unknown", **source_metadata(key)},
            )
        except (OSError, ValueError, TypeError, KeyError, RuntimeError, OverflowError):
            diagnostics.append(
                {
                    "gw": gw,
                    "reason": "Official actual points were unavailable or malformed; no comparison scored.",
                }
            )
    for bucket in inventory["bins"]:
        results, errors, names = [], {}, set()
        for key, item in sorted(selected.items()):
            if (
                key[1] != bucket["id"]
                or item["gw"] not in actuals
                or _status(item, events.get(item["gw"])) != "ready_for_scoring"
            ):
                continue
            gw, event = item["gw"], events[item["gw"]]
            lookup, provenance = actuals[gw]
            cohorts = score_cohorts(
                item["target"], lookup, provenance, event.get("data_checked")
            )
            result = {
                **_capture_detail(item, event, data.get("fixtures")),
                **cohorts,
                "actual_source": provenance,
                "status": "scored",
            }
            receipt = item["target"]["capture_receipt"]
            receipt_changed = isinstance(receipt, dict) and (
                receipt.get("target_gameweek", gw) != gw
                or receipt.get("target_season", data["season"]) != data["season"]
            )
            predictions = {
                p["id"]: captured_models(p) for p in item["target"]["players"]
            }
            for name, pair in result["pairwise_comparisons"].items():
                names.add(name)
                if result["deadline_changed"] or receipt_changed:
                    pair["eligible_primary"] = False
                    pair["eligibility"] = "exploratory"
                    pair["eligibility_reasons"].append(
                        "Official deadline changed after capture; the stored lead/bin is retained."
                        if result["deadline_changed"]
                        else "Capture receipt target differs from the stored target."
                    )
                for pid in pair["player_ids"]:
                    model_error = predictions[pid][name] - lookup[pid]
                    ensemble_error = predictions[pid]["Live ensemble"] - lookup[pid]
                    if finite_number(model_error) and finite_number(ensemble_error):
                        errors.setdefault(name, []).append(
                            {
                                "gw": gw,
                                "player_id": pid,
                                "model_error": model_error,
                                "ensemble_error": ensemble_error,
                                "primary": pair["eligible_primary"],
                            }
                        )
            results.append(finite_json(result))
        bucket["gameweeks"] = results
        bucket["pairwise_comparisons"] = {
            name: {
                "reference": "Live ensemble",
                "all": _aggregate(errors.get(name, [])),
                "primary": _aggregate(
                    [r for r in errors.get(name, []) if r["primary"]]
                ),
                "exploratory": _aggregate(
                    [r for r in errors.get(name, []) if not r["primary"]]
                ),
                "coverage": {
                    field: sum(
                        r["coverage"].get(name, {}).get(field, 0) for r in results
                    )
                    for field in (
                        "eligible_count",
                        "forecast_count",
                        "missing_forecast_count",
                        "invalid_forecast_count",
                        "scored_count",
                    )
                },
            }
            for name in sorted(names)
        }
    inventory["diagnostics"] = diagnostics
    inventory["aggregation"] = (
        "Within each lead bin, errors are player-GW weighted. Captured projected-minutes cohorts may differ between bins; bins reuse GW outcomes and must not be pooled as independent observations. 'All' includes exploratory/unknown captures; primary is reported separately. Frozen/current fixture-schedule differences are disclosed without changing evaluation eligibility."
    )
    if save:
        path = root / "data" / "lead-time.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(inventory, indent=2, ensure_ascii=False, allow_nan=False),
            encoding="utf-8",
        )
    return inventory

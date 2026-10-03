"""Record pre-deadline forecasts and score only completed official gameweeks."""

from __future__ import annotations

import argparse
import json
import math
import time
from datetime import datetime, timezone

from . import data as data_module
from .app import ForecastRequest, save_snapshot
from .capture import read_snapshot, snapshot_paths, source_time
from .data import FPL, ROOT, fetch, get_data, utcnow
from .evaluate import metrics


def finite_number(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def captured_models(player):
    """Legacy snapshots stored just a forecast; its Live label remains explicit."""
    stored = player.get("models", {})
    result = dict(stored) if isinstance(stored, dict) else {}
    result.setdefault("Live ensemble", player.get("forecast", {}).get("points"))
    return {
        name: value for name, value in result.items() if isinstance(name, str) and name
    }


def comparison_eligibility(snapshot, name, actual_source, data_checked, count):
    receipt = snapshot.get("capture_receipt")
    reasons = []
    if not isinstance(receipt, dict):
        reasons.append(
            "Legacy snapshot has no capture receipt; source freshness eligibility is unknown."
        )
        eligibility = "unknown"
    else:
        eligibility = "primary"
        eligible = receipt.get("eligible_primary", {})
        source_reasons = receipt.get("eligibility_reasons", receipt.get("reasons", {}))
        for model in dict.fromkeys(("Live ensemble", name)):
            if not isinstance(eligible, dict) or eligible.get(model) is not True:
                eligibility = "exploratory"
                reasons.append(
                    f"{model} was not marked eligible for primary evaluation at capture."
                )
            model_reasons = (
                source_reasons.get(model, [])
                if isinstance(source_reasons, dict)
                else []
            )
            if isinstance(model_reasons, str):
                model_reasons = [model_reasons]
            if isinstance(model_reasons, list):
                reasons.extend(
                    reason for reason in model_reasons if isinstance(reason, str)
                )
    if data_checked is not True:
        reasons.append(
            "Official gameweek data_checked is absent; results remain unchecked."
        )
        if eligibility != "unknown":
            eligibility = "exploratory"
    if actual_source.get("status") not in ("live", "cached"):
        reasons.append(
            f"Official actual-points source status is {actual_source.get('status', 'unknown')}; fresh outcome provenance is not established."
        )
        if eligibility != "unknown":
            eligibility = "exploratory"
    if not count:
        reasons.append(
            "No players have finite predictions from both models and available official outcomes."
        )
        if eligibility != "unknown":
            eligibility = "exploratory"
    return {
        "eligibility": eligibility,
        "eligible_primary": eligibility == "primary",
        "eligibility_reasons": list(dict.fromkeys(reasons)),
    }


def score_cohorts(snapshot, actual_lookup, actual_source, data_checked):
    """Define eligibility from captured minutes, never from realized appearances."""
    players = snapshot["players"]
    names = {name for p in players for name in captured_models(p)}
    receipt = snapshot.get("capture_receipt", {})
    declared = receipt.get("eligible_primary", {}) if isinstance(receipt, dict) else {}
    if isinstance(declared, dict):
        names.update(name for name in declared if isinstance(name, str) and name)
    names = sorted(names)
    declared_comparisons = (
        receipt.get("comparison_models") if isinstance(receipt, dict) else None
    )
    comparison_names = (
        [name for name in declared_comparisons if name in names]
        if isinstance(declared_comparisons, list) and declared_comparisons
        else names
    )
    eligible = []
    selection_source_counts = {"component_forecast": 0, "legacy_ensemble_forecast": 0}
    for player in players:
        source = (
            "component_forecast"
            if isinstance(player.get("component_forecast"), dict)
            else "legacy_ensemble_forecast"
        )
        forecast = (
            player["component_forecast"]
            if source == "component_forecast"
            else player.get("forecast", {})
        )
        minutes = forecast.get("xmins")
        if finite_number(minutes) and minutes >= 45:
            eligible.append(player)
            selection_source_counts[source] += 1
    scored = [p for p in eligible if finite_number(actual_lookup.get(p["id"]))]
    model_rows = {p["id"]: captured_models(p) for p in eligible}
    common = [
        p
        for p in scored
        if all(
            finite_number(model_rows[p["id"]].get(name)) for name in comparison_names
        )
    ]
    coverage = {}
    pairwise = {}
    for name in names:
        available = [
            p for p in eligible if finite_number(model_rows[p["id"]].get(name))
        ]
        missing_ids = sorted(
            p["id"] for p in eligible if name not in model_rows[p["id"]]
        )
        invalid_ids = sorted(
            p["id"]
            for p in eligible
            if name in model_rows[p["id"]]
            and not finite_number(model_rows[p["id"]][name])
        )
        coverage[name] = {
            "eligible_count": len(eligible),
            "forecast_count": len(available),
            "missing_forecast_count": len(missing_ids),
            "invalid_forecast_count": len(invalid_ids),
            "scored_count": sum(
                finite_number(actual_lookup.get(p["id"])) for p in available
            ),
            "missing_player_ids": missing_ids,
            "invalid_player_ids": invalid_ids,
        }
        matched = [
            p
            for p in scored
            if finite_number(model_rows[p["id"]].get(name))
            and finite_number(model_rows[p["id"]].get("Live ensemble"))
        ]
        actual = [actual_lookup[p["id"]] for p in matched]
        pairwise[name] = {
            "reference": "Live ensemble",
            "player_ids": sorted(p["id"] for p in matched),
            "count": len(matched),
            "model": metrics([model_rows[p["id"]][name] for p in matched], actual),
            "ensemble": metrics(
                [model_rows[p["id"]]["Live ensemble"] for p in matched], actual
            ),
            **comparison_eligibility(
                snapshot, name, actual_source, data_checked, len(matched)
            ),
        }
    headline_players = [
        p for p in scored if finite_number(model_rows[p["id"]].get("Live ensemble"))
    ]
    headline = metrics(
        [model_rows[p["id"]]["Live ensemble"] for p in headline_players],
        [actual_lookup[p["id"]] for p in headline_players],
    ) or {"mae": None, "rmse": None, "bias": None, "count": 0}
    return {
        **headline,
        "cohort": {
            "selection": "Captured component forecast xmins >=45; legacy captured ensemble fallback. Eligibility is fixed before inspecting outcomes.",
            "eligible_count": len(eligible),
            "scored_count": len(scored),
            "eligible_player_ids": sorted(p["id"] for p in eligible),
            "missing_actual_ids": sorted(
                p["id"]
                for p in eligible
                if not finite_number(actual_lookup.get(p["id"]))
            ),
            "selection_source_counts": selection_source_counts,
        },
        "common_cohort_count": len(common),
        "comparison_models": comparison_names,
        "common_player_ids": sorted(p["id"] for p in common),
        "models": {
            name: metrics(
                [model_rows[p["id"]][name] for p in common],
                [actual_lookup[p["id"]] for p in common],
            )
            for name in comparison_names
        }
        if common
        else {},
        "coverage": coverage,
        "pairwise_comparisons": pairwise,
    }


def score():
    data = get_data()
    latest = {}
    excluded = {}
    for path in snapshot_paths(ROOT, data["season"]):
        try:
            record = read_snapshot(path)
            if not isinstance(record, dict):
                continue
            deadline = source_time(record.get("deadline"))
            recorded = source_time(record.get("recorded_at"))
            if (
                deadline is None
                or recorded is None
                or recorded >= deadline
                or recorded > datetime.now(timezone.utc)
            ):
                continue
            event = next(
                (
                    e
                    for e in data["bootstrap"]["events"]
                    if datetime.fromisoformat(e["deadline_time"].replace("Z", "+00:00"))
                    == deadline
                ),
                None,
            )
            if not event or not event["finished"]:
                continue
            gw = event["id"]
            if event.get("data_checked") is False:
                excluded[gw] = {
                    "gw": gw,
                    "reason": "Official gameweek data_checked is false; outcomes are not ready for scoring.",
                }
                continue
            if gw not in latest or recorded > latest[gw]["recorded"]:
                latest[gw] = {
                    "recorded": recorded,
                    "snapshot": record,
                    "file": path.name,
                    "data_checked": event.get("data_checked"),
                }
        except (OSError, EOFError, ValueError, KeyError, TypeError):
            continue
    results = []
    for gw, item in sorted(latest.items()):
        actual_url = f"{FPL}/event/{gw}/live/"
        actual_key = f"prospective_actual_{data['season']}_{gw}"
        actual = json.loads(
            fetch(
                actual_url,
                actual_key,
                3600,
            )
        )
        lookup = {p["id"]: p["stats"]["total_points"] for p in actual["elements"]}
        actual_source = {
            "url": actual_url,
            "status": "unknown",
            **data_module.source_metadata(actual_key),
        }
        actual_source.pop("body", None)
        results.append(
            {
                "gw": gw,
                "snapshot": item["file"],
                "recorded_at": item["snapshot"]["recorded_at"],
                "deadline": item["snapshot"]["deadline"],
                "version": item["snapshot"]["model_version"],
                "capture_receipt": item["snapshot"].get("capture_receipt"),
                "actual_source": actual_source,
                "actual_data_checked": item["data_checked"],
                **score_cohorts(
                    item["snapshot"], lookup, actual_source, item["data_checked"]
                ),
            }
        )
    output = {
        "generated_at": utcnow(),
        "season": data["season"],
        "gameweeks": results,
        "excluded_gameweeks": [excluded[gw] for gw in sorted(excluded)],
        "method": "Latest strictly pre-deadline local snapshot per completed GW; data_checked=false is excluded. Cohort is captured component-model projected 45+ minutes, with legacy ensemble-minutes fallback. Headline ensemble uses its valid predictions on eligible players with official outcomes. Shared model cards use the complete-case common cohort; each pairwise comparison uses identical captured player IDs and reports prediction coverage. Fresh-primary status requires an eligible capture receipt and checked official outcomes with live/cached source provenance.",
        "vendor_comparison": "FPL Form public exports are recorded alongside the ensemble and component baseline. No matching paid-provider forecasts imported.",
    }
    path = ROOT / "data" / "prospective.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, indent=2, allow_nan=False), encoding="utf-8")
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--score", action="store_true", help="Evaluate completed gameweeks only"
    )
    parser.add_argument(
        "--cached",
        action="store_true",
        help="Use existing live-input caches instead of refreshing; freshness eligibility is reported in the capture receipt",
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Refresh live inputs and record every 15 minutes while this process runs (unless --cached)",
    )
    args = parser.parse_args()
    if args.score:
        print(json.dumps(score(), indent=2))
        return
    while True:
        try:
            result = save_snapshot(ForecastRequest(), refresh_inputs=not args.cached)
            print(json.dumps(result), flush=True)
        except Exception as exc:
            print(json.dumps({"recorded_at": utcnow(), "error": str(exc)}), flush=True)
            if not args.watch:
                raise
        if not args.watch:
            return
        time.sleep(900)


if __name__ == "__main__":
    main()

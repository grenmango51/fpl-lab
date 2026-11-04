"""Development-only comparison on content-addressed archived inputs.

Usage: python tools/replay_forecast.py BASELINE OBSERVATION --archive-root ROOT
Never writes over the original captures or claims out-of-sample performance.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app import ForecastRequest, forecast_for
from backend.capture import read_snapshot
from backend.replay import replay_dataset


def metrics(rows, field):
    errors = [r[field] - r["solio"] for r in rows]
    return {"count": len(errors), "mae": sum(map(abs, errors)) / len(errors),
            "rmse": (sum(e * e for e in errors) / len(errors)) ** 0.5,
            "bias": sum(errors) / len(errors),
            "within_one_point": sum(abs(e) <= 1 for e in errors),
            "within_one_point_fraction": sum(abs(e) <= 1 for e in errors) / len(errors),
            "errors_over_two_points": sum(abs(e) > 2 for e in errors)}


def run(baseline_path, observation_path, archive_root):
    original = read_snapshot(baseline_path)
    observation = read_snapshot(observation_path)
    gw = str(original["target_gw"])
    target = observation["future_targets"][gw]
    if target["deadline"] != original["deadline"] or original["season"] != observation["season"]:
        raise ValueError("Different season/deadline")
    dataset = replay_dataset(baseline_path, archive_root)
    config = {**original["configuration"], "use_solio": False}
    revised = forecast_for(ForecastRequest(**config), dataset=dataset)
    before = {p["id"]: p for p in original["players"]}
    observed = {p["id"]: p for p in target["players"]}
    rows = []
    for p in revised["players"]:
        old, vendor = before.get(p["id"]), observed.get(p["id"])
        if old is None or vendor is None:
            continue
        if not (old["code"] == vendor["code"] == p["code"] and old["club"] == vendor["club"] == p["team_short"]
                and old["position"] == vendor["position"] == p["position"]):
            raise ValueError(f"Identity mismatch for {p['id']}")
        rows.append({"id": p["id"], "code": p["code"], "name": p["name"],
                     "original_xmins": old["xmins"], "old": old["models"]["Live ensemble"],
                     "new": p["gw"][gw]["points"], "solio": vendor["models"]["Solio"]})
    if not rows:
        raise ValueError("No matched forecasts")
    cohorts = {"all_matched": rows, "original_minutes_45_plus": [r for r in rows if r["original_xmins"] >= 45],
               "solio_top20_descriptive": sorted(rows, key=lambda r: r["solio"], reverse=True)[:20]}
    return {"method": "Development replay on the seen GW12 case; not a new prospective accuracy claim. Revised inputs are exclusively the original capture's archived sources. No Solio input or model-weight fitting.",
            "baseline": str(baseline_path), "observation": str(observation_path),
            "sha256": {str(p): hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in (baseline_path, observation_path)},
            "model_version": revised["model_version"], "source_hashes": dataset["replay"]["source_hashes"],
            "cohorts": {name: {model: metrics(values, model) for model in ("old", "new")}
                        for name, values in cohorts.items() if values}, "players": rows}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("observation", type=Path)
    parser.add_argument("--archive-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = run(args.baseline, args.observation, args.archive_root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as file:
        json.dump(report, file, indent=2, allow_nan=False)
    print(json.dumps(report["cohorts"], indent=2))

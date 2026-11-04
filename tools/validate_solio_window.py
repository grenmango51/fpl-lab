"""Exploratory same-acquisition withheld-window check, never prospective proof."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app import ForecastRequest, forecast_for
from backend.capture import read_snapshot
from backend.replay import replay_dataset
from backend.solio_validation import agreement


def run(snapshot, observation_path, archive_root, target):
    observation = read_snapshot(observation_path)
    data = replay_dataset(snapshot, archive_root)
    # Remove *all* point/probability inputs at or beyond the held-out target,
    # including the other provider. Preserve supplied earlier zeroes.
    for player in data.get("fplform", {}).get("players", {}).values():
        for field in ("points", "probabilities"):
            player[field] = {gw: value for gw, value in player[field].items() if int(gw) < target}
    earlier = {gw: rows for gw, rows in observation["future_targets"].items() if int(gw) < target}
    if len(earlier) < 2 or not observation["source"].get("full_planner_connected"):
        raise ValueError("Need at least two complete earlier planner weeks")
    players = {}
    for gw, week in earlier.items():
        for player in week["players"]:
            row = players.setdefault(str(player["id"]), {"code": player["code"], "points": {}})
            row["points"][gw] = player["models"]["Solio"]
    data["solio"] = {**observation["source"], "players": players,
                     "weeks": sorted(map(int, earlier)), "usable": True}
    forecast = forecast_for(ForecastRequest(), dataset=data)
    observed = {p["id"]: p for p in observation["future_targets"][str(target)]["players"]}
    rows = []
    for player in forecast["players"]:
        vendor = observed.get(player["id"])
        if vendor is None:
            continue
        if player["code"] != vendor["code"]:
            raise ValueError("Stable identity mismatch")
        rows.append({"id": player["id"], "code": player["code"], "name": player["name"],
                     "prediction": player["gw"][str(target)]["points"],
                     "solio": vendor["models"]["Solio"], "original_xmins": vendor["xmins"]})
    top = sorted(rows, key=lambda p: p["solio"], reverse=True)[:20]
    return {"method": "Exploratory withheld-window development check. Inputs acquired together; GW12 informed debugging. All target-and-later FPL Form points/probabilities and Solio cells removed before forecasting. This is not prospective accuracy.",
            "snapshot": str(snapshot), "observation": str(observation_path), "target_gw": target,
            "anchor_gameweeks": sorted(map(int, earlier)), "all_matched": agreement(rows),
            "original_minutes_45_plus": agreement([r for r in rows if r["original_xmins"] >= 45]),
            "solio_top20_descriptive": agreement(top), "players": rows}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("observation", type=Path)
    parser.add_argument("--archive-root", type=Path, required=True)
    parser.add_argument("--target", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = run(args.snapshot, args.observation, args.archive_root, args.target)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as file:
        json.dump(report, file, indent=2, allow_nan=False)
    print(json.dumps({k: v for k, v in report.items() if k != "players"}, indent=2))

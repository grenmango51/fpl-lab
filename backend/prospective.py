"""Record pre-deadline forecasts and score only completed official gameweeks."""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime

from .app import ForecastRequest, save_snapshot
from .data import FPL, ROOT, fetch, get_data, utcnow
from .evaluate import metrics


def score():
    data = get_data()
    snapshots = ROOT / "data" / "snapshots"
    latest = {}
    for path in snapshots.glob(f"{data['season']}_gw*.json"):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
            deadline = datetime.fromisoformat(record["deadline"].replace("Z", "+00:00"))
            recorded = datetime.fromisoformat(
                record["recorded_at"].replace("Z", "+00:00")
            )
            if recorded >= deadline:
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
            if gw not in latest or recorded > latest[gw]["recorded"]:
                latest[gw] = {
                    "recorded": recorded,
                    "snapshot": record,
                    "file": path.name,
                }
        except (ValueError, KeyError):
            continue
    results = []
    for gw, item in sorted(latest.items()):
        actual = json.loads(
            fetch(
                f"{FPL}/event/{gw}/live/",
                f"prospective_actual_{data['season']}_{gw}",
                3600,
            )
        )
        lookup = {p["id"]: p["stats"]["total_points"] for p in actual["elements"]}
        players = [
            p
            for p in item["snapshot"]["players"]
            if p["id"] in lookup and p["forecast"]["xmins"] >= 45
        ]
        if not players:
            continue
        common = set.intersection(
            *(
                set(p.get("models", {"Live ensemble": p["forecast"]["points"]}))
                for p in players
            )
        )
        model_scores = {
            name: metrics(
                [
                    p.get("models", {"Live ensemble": p["forecast"]["points"]})[name]
                    for p in players
                ],
                [lookup[p["id"]] for p in players],
            )
            for name in sorted(common)
        }
        results.append(
            {
                "gw": gw,
                "snapshot": item["file"],
                "recorded_at": item["snapshot"]["recorded_at"],
                "deadline": item["snapshot"]["deadline"],
                "version": item["snapshot"]["model_version"],
                "models": model_scores,
                **metrics(
                    [p["forecast"]["points"] for p in players],
                    [lookup[p["id"]] for p in players],
                ),
            }
        )
    output = {
        "generated_at": utcnow(),
        "season": data["season"],
        "gameweeks": results,
        "method": "Latest strictly pre-deadline local snapshot per completed GW. Official GW point totals; projected 45+ minutes cohort. Captured component, ensemble and FPL Form forecasts use identical rows.",
        "vendor_comparison": "FPL Form public exports are recorded alongside the ensemble and component baseline. No matching paid-provider forecasts imported.",
    }
    path = ROOT / "data" / "prospective.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--score", action="store_true", help="Evaluate completed gameweeks only"
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Record every 15 minutes while this process runs",
    )
    args = parser.parse_args()
    if args.score:
        print(json.dumps(score(), indent=2))
        return
    while True:
        try:
            result = save_snapshot(ForecastRequest())
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

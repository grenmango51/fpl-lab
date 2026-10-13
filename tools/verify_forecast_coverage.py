"""Check the live forecast matrix against the same sourced official fixture set.

Run from the repository root: python tools/verify_forecast_coverage.py
The local server must be running. Raw inputs remain in ignored storage.
"""

from __future__ import annotations

import json
import math
import sys
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.data import get_data  # noqa: E402


def verify(payload, dataset):
    expected_weeks = list(range(dataset["next_gw"], 39))
    official_ids = set(dataset["players"])
    actual_ids = [player["id"] for player in payload["players"]]
    failures = []
    if set(actual_ids) != official_ids or len(actual_ids) != len(official_ids):
        failures.append("Player IDs differ from the official current pool.")
    if payload["gameweeks"] != expected_weeks:
        failures.append("Gameweek sequence does not cover every remaining GW.")
    expected_fixtures = {}
    for fixture in dataset["fixtures"]:
        if fixture.get("event") not in expected_weeks:
            continue
        for team in (fixture["team_h"], fixture["team_a"]):
            expected_fixtures.setdefault((team, fixture["event"]), set()).add(fixture["id"])
    coverage = {gw: Counter() for gw in expected_weeks}
    for player in payload["players"]:
        if set(player["gw"]) != {str(gw) for gw in expected_weeks}:
            failures.append(f"Player {player['id']} has missing or extra weeks.")
        for gw in expected_weeks:
            row = player["gw"].get(str(gw))
            if row is None:
                continue
            coverage[gw]["players"] += 1
            coverage[gw][row.get("prediction_source", {}).get("kind", "component")] += 1
            ids = [fixture["id"] for fixture in row["fixtures"]]
            if set(ids) != expected_fixtures.get((player["team"], gw), set()) or len(ids) != len(set(ids)):
                failures.append(f"Player {player['id']} GW{gw}: fixture membership mismatch.")
            if not all(math.isfinite(row[key]) for key in ("points", "xmins")):
                failures.append(f"Player {player['id']} GW{gw}: nonfinite projection.")
            if not math.isclose(row["points"], sum(row["components"].values()), abs_tol=1e-8):
                failures.append(f"Player {player['id']} GW{gw}: components do not reconcile.")
            if not ids and (row["points"] != 0 or row["xmins"] != 0):
                failures.append(f"Player {player['id']} GW{gw}: nonzero blank.")
            for fixture in row["fixtures"]:
                if not 0 <= fixture["cs"] <= 1 or not 0 <= fixture["p60"] <= fixture["pplay"] <= 1:
                    failures.append(f"Player {player['id']} GW{gw}: invalid probability.")
                if not fixture.get("source") or not fixture.get("source_at"):
                    failures.append(f"Player {player['id']} GW{gw}: missing fixture provenance.")
    for gw, counts in coverage.items():
        if counts["players"] != len(official_ids):
            failures.append(f"GW{gw} has {counts['players']} of {len(official_ids)} players.")
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "season": payload["season"],
        "players": len(actual_ids),
        "teams": len(payload["teams"]),
        "start_gw": expected_weeks[0],
        "end_gw": expected_weeks[-1],
        "expected_player_weeks": len(official_ids) * len(expected_weeks),
        "actual_player_weeks": sum(row["players"] for row in coverage.values()),
        "gameweeks": {str(gw): dict(row) for gw, row in coverage.items()},
        "sources": {key: {"status": source.get("status"), "fetched_at": source.get("fetched_at")}
                    for key, source in payload["sources"].items()},
        "passed": not failures,
        "failures": failures,
    }


if __name__ == "__main__":
    with urllib.request.urlopen("http://127.0.0.1:8000/api/bootstrap", timeout=240) as response:
        payload = json.load(response)
    report = verify(payload, get_data())
    target = ROOT / "data" / "coverage-qa.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key not in ("sources", "gameweeks")}, indent=2))
    print(f"Full coverage/source report: {target}")
    sys.exit(0 if report["passed"] else 1)

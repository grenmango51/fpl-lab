"""Replay an optimiser against frozen forecasts and initial squads, without network access.

Inputs and detailed results belong under ignored data/exports/benchmarks/.
The same forecasts, case file and time budgets must be used for both versions.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import solver


def common_points(week, lookup):
    """Expected XI + captain, less hits; excludes unavailable vendor autosub models."""
    gw = str(week["gw"])
    scoring = week["squad"] if week.get("chip") == "benchboost" else week["starters"]
    copies = 2 if week.get("chip") == "triplecaptain" else 1
    return (sum(lookup[i]["gw"][gw]["points"] for i in scoring)
            + copies * lookup[week["captain"]]["gw"][gw]["points"] - week["hits"])


def validate_result(result, players, args):
    """Check transitions independently of the solver's reported scores."""
    from backend.app import PlanRequest, validate_plan_payload

    weeks = list(range(args["start_gw"], min(39, args["start_gw"] + args["horizon"])))
    if [w["gw"] for w in result["weeks"]] != weeks:
        raise ValueError("Result does not cover the requested horizon")
    payload = {"players": players, "gameweeks": weeks}
    request = PlanRequest(
        base_squad=args.get("squad", []), bank=args.get("bank", 0),
        free_transfers=args.get("free_transfers", 1),
        purchase_prices=args.get("purchase_prices", {}), used_chips=args.get("used_chips", []),
        weeks=result["weeks"],
    )
    checked = validate_plan_payload(request, payload)
    for raw, verified in zip(result["weeks"], checked["weeks"]):
        if any(abs(raw[key] - verified[key]) > 1e-6
               for key in ("bank", "hits", "free_transfers", "next_free_transfers", "net_points")):
            raise ValueError("Independent plan validation disagrees with the result")
        gw = str(raw["gw"])
        required = set(args.get("locked", [])) | set(args.get("locked_by_gw", {}).get(gw, []))
        banned = set(args.get("excluded", [])) | set(args.get("excluded_by_gw", {}).get(gw, []))
        if not required <= set(raw["squad"]) or banned & set(raw["squad"]):
            raise ValueError("Result violates player constraints")
        if args.get("captain_locks", {}).get(gw, raw["captain"]) != raw["captain"]:
            raise ValueError("Result violates a captain constraint")
        chip = args.get("chips", {}).get(gw, "none")
        limit = args.get("transfer_limits", {}).get(
            gw, 15 if chip in ("wildcard", "freehit") else args.get("max_transfers", 2),
        )
        if raw["chip"] != chip or len(verified["transfers_in"]) > limit:
            raise ValueError("Result violates the requested chip schedule or transfer ceiling")
    return checked


def run(forecast_path, cases_path, seconds, repeats=1, solver_file=None):
    module = solver
    if solver_file:
        spec = importlib.util.spec_from_file_location("backend._benchmark_solver", solver_file)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    payload = json.loads(forecast_path.read_text())
    players = payload["players"]
    lookup = {p["id"]: p for p in players}
    if len(lookup) != len(players):
        raise ValueError("Duplicate forecast identities")
    cases = json.loads(cases_path.read_text())
    records = []
    for case in cases:
        args = case["args"]
        weeks = range(args["start_gw"], min(39, args["start_gw"] + args["horizon"]))
        if any(str(gw) not in p["gw"] for p in players for gw in weeks):
            raise ValueError("Missing player/gameweek coverage")
        for repeat in range(repeats):
            for budget in seconds:
                started = time.perf_counter()
                record = {"case": case["name"], "repeat": repeat + 1, "seconds": budget}
                try:
                    result = module.optimise(players, **args, seconds=budget)
                    record["wall_seconds"] = time.perf_counter() - started
                    validate_result(result, players, args)
                    record.update(
                        valid=True, common_net_points=sum(common_points(w, lookup) for w in result["weeks"]),
                        displayed_net_points=sum(w["net_points"] for w in result["weeks"]),
                        transfers=sum(len(w["transfers_in"]) for w in result["weeks"]), result=result,
                    )
                except ValueError as exc:
                    record.update(wall_seconds=time.perf_counter() - started, valid=False, error=str(exc))
                records.append(record)
                print(json.dumps({k: v for k, v in record.items() if k != "result"}), flush=True)
    return {
        "schema": 1, "forecast_sha256": hashlib.sha256(forecast_path.read_bytes()).hexdigest(),
        "cases_sha256": hashlib.sha256(cases_path.read_bytes()).hexdigest(),
        "solver_sha256": hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest(),
        "receipt": payload.get("benchmark_receipt"), "pool_players": len(players),
        "method": "Same frozen points, prices and Open FPL appearances. Common score is XI + captain - hits; Solio's proprietary autosubs/risk/disruption are excluded. Wall time excludes independent validation. No network access.",
        "runs": records,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("forecasts", type=Path)
    parser.add_argument("cases", type=Path)
    parser.add_argument("--seconds", type=int, nargs="+", default=[2, 5, 15])
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--solver-file", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    cli = parser.parse_args()
    report = run(cli.forecasts, cli.cases, cli.seconds, cli.repeats, cli.solver_file)
    cli.output.parent.mkdir(parents=True, exist_ok=True)
    with cli.output.open("x") as file:
        json.dump(report, file, indent=2, allow_nan=False)

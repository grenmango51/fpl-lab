"""HUMAN schedule assumptions against an immutable official/source schedule."""

from datetime import datetime, timezone

from .model import projections


def canonical_fixture_moves(values, dataset):
    if not isinstance(values, dict):
        raise ValueError("Fixture moves must map official fixture ID strings to a GW or null.")
    fixtures = {str(f["id"]): f for f in dataset["fixtures"]}
    completed = {e["id"] for e in dataset["bootstrap"]["events"] if e.get("finished")}
    result = {}
    for key, target in values.items():
        if not isinstance(key, str) or key not in fixtures:
            raise ValueError("Fixture moves require canonical official fixture ID strings.")
        fixture = fixtures[key]
        origin = fixture["event"]
        if (fixture.get("finished") or fixture.get("finished_provisional")
                or origin in completed or (origin is not None and origin < dataset["next_gw"])):
            raise ValueError("Only unplayed fixtures in remaining gameweeks or Unset can move.")
        if target is not None and (type(target) is not int
                or not dataset["next_gw"] <= target <= 38 or target in completed):
            raise ValueError("Fixture destinations must be remaining integer GWs or null (Unset).")
        if target != origin:
            result[key] = target
    return result


def scenario_fixture_schedule(dataset, moves):
    """Explicit source receipts; no hypothetical date is inferred from a GW."""
    return [{
        "id": f["id"], "team_h": f["team_h"], "team_a": f["team_a"],
        "event": moves.get(str(f["id"]), f["event"]),
        "source_event": f["event"], "original_event": f["event"],
        "original_kickoff": f.get("kickoff_time"),
        "kickoff_time": None if str(f["id"]) in moves else f.get("kickoff_time"),
        "finished": f.get("finished", False),
    } for f in dataset["fixtures"]]


def apply_fixture_moves(payload, moves, dataset, overrides, use_market, minutes_schedule):
    moves = canonical_fixture_moves(moves, dataset)
    if not moves:
        return payload
    original_by_id = {f["id"]: f for f in dataset["fixtures"]}
    affected = {}
    receipts = []
    for key, target in moves.items():
        f = original_by_id[int(key)]
        weeks = {gw for gw in (f["event"], target) if gw is not None}
        for club in (f["team_h"], f["team_a"]):
            affected.setdefault(club, set()).update(weeks)
        receipts.append({"id": f["id"], "team_h": f["team_h"], "team_a": f["team_a"],
                         "original_event": f["event"], "source_event": f["event"],
                         "target_event": target, "original_kickoff": f.get("kickoff_time"),
                         "hypothetical_kickoff": None})
    # Read-only shared source inputs; only fixture dictionaries are copied. Market
    # lookup uses the ENTIRE original schedule, including its aggregate counts.
    scenario_data = {**dataset,
        "fixtures": [{**f, "event": moves.get(str(f["id"]), f["event"])}
                     for f in dataset["fixtures"]],
        "_fixture_source_data": dataset, "_fixture_source_by_id": original_by_id}
    component = projections(overrides, use_market, minutes_schedule,
                            dataset=scenario_data, cache=False)
    lookup = {p["id"]: p for p in component["players"]}
    stamp = datetime.now(timezone.utc).isoformat()
    output = {**payload, "players": []}
    for old in payload["players"]:
        weeks = affected.get(old["team"], set())
        if not weeks:
            output["players"].append(old)
            continue
        player = {**old, "gw": dict(old["gw"]), "overridden": True}
        for gw in weeks:
            key = str(gw)
            base = old["gw"][key]
            item = {**lookup[old["id"]]["gw"][key]}
            item["fixtures"] = [{**f, "original_event": original_by_id[f["id"]]["event"],
                "source_event": original_by_id[f["id"]]["event"],
                "target_event": gw,
                "original_kickoff": original_by_id[f["id"]].get("kickoff_time"),
                "kickoff": None if str(f["id"]) in moves else f["kickoff"],
            } for f in item["fixtures"]]
            item["fixture_scenario"] = {
                "source": "user-assumed", "label": "HUMAN fixture permutation",
                "adjusted_at": stamp, "base_points": base["points"],
                "points_delta": item["points"] - base["points"],
                "base_prediction_source": base.get("prediction_source"),
                "base_fixture_ids": [f["id"] for f in base["fixtures"]],
                "fixture_ids": [f["id"] for f in item["fixtures"]],
                "moves": [r for r in receipts if old["team"] in (r["team_h"], r["team_a"])
                          and gw in (r["original_event"], r["target_event"])],
                "anchors_bypassed": True,
            }
            item["prediction_source"] = {"kind": "user-scenario", "name": "HUMAN fixture permutation",
                "source_at": stamp, "previous": base.get("prediction_source"),
                "base_points": base["points"]}
            player["gw"][key] = item
        for name in ("xmins", "pplay", "p60"):
            player[name] = player["gw"][str(payload["next_gw"])][name]
        output["players"].append(player)
    output["fixture_schedule"] = scenario_fixture_schedule(dataset, moves)
    output["fixture_scenario"] = {"source": "user-assumed", "label": "HUMAN fixture permutations",
        "adjusted_at": stamp, "moves": moves, "receipts": receipts,
        "scope": "all remaining gameweeks; source schedule frozen"}
    output["forecast_layers"] = [*payload.get("forecast_layers", []), {
        "kind": "user-scenario", "name": "HUMAN fixture permutations", "source_at": stamp}]
    output["limitations"] = [*payload.get("limitations", []),
        "Fixture permutations are HUMAN assumptions, not public schedule updates. Original fixture market context is retained; no dates or move probabilities are inferred. Provider/CSV point and appearance anchors are bypassed only for affected club origin/destination weeks; other calibrated weeks remain frozen. Congestion, rest and date-dependent recovery are not modelled."]
    output["model_version"] = payload["model_version"] + " · human fixture permutations"
    return output

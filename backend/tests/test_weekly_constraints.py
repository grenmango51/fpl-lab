"""Weekly constraints change the MILP, including otherwise screened players."""

from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from backend import app as api_module
from backend.solver import Builder, optimise
from backend.tests.test_rules import pool, squad


def test_weekly_exclusion_forces_sale_then_later_lock_forces_purchase():
    players, base = squad()
    target = base["squad"][0]
    result = optimise(
        players, squad=base["squad"], bank=40, start_gw=6, horizon=3,
        max_transfers=0, transfer_limits={"6": 1, "7": 1},
        excluded_by_gw={"6": [target]}, locked_by_gw={"7": [target]}, seconds=5,
    )
    first, second, third = result["weeks"]
    assert target not in first["squad"]
    assert target in first["transfers_out"]
    assert target in second["squad"] and target in second["transfers_in"]
    assert third["transfers_in"] == []


def test_captain_locks_require_starting_place_and_can_change_each_week():
    players, base = squad()
    captains = base["squad"][:2]  # Could include the reserve keeper.
    result = optimise(
        players, squad=base["squad"], bank=40, start_gw=6, horizon=2,
        max_transfers=0, captain_locks={"6": captains[0], "7": captains[1]}, seconds=5,
    )
    for week, target in zip(result["weeks"], captains):
        assert week["captain"] == target
        assert target in week["starters"]


def test_explicit_chip_transfer_limit_zero_prevents_squad_changes():
    players, base = squad()
    result = optimise(
        players, squad=base["squad"], bank=40, start_gw=6, horizon=2,
        max_transfers=0, chips={"7": "wildcard"}, transfer_limits={"7": 0}, seconds=5,
    )
    assert set(result["weeks"][1]["squad"]) == set(base["squad"])
    assert result["weeks"][1]["transfers_in"] == []
    assert result["weeks"][1]["hits"] == 0


def test_full_season_horizon_clips_and_discloses_native_resources():
    players = pool()
    for player in players:
        player["gw"] = {str(gw): deepcopy(player["gw"]["6"]) for gw in range(6, 39)}
    result = optimise(players, start_gw=36, horizon=38, seconds=5)
    assert [w["gw"] for w in result["weeks"]] == [36, 37, 38]
    assert result["requested_horizon"] == 38 and result["actual_horizon"] == 3
    assert result["end_gw"] == 38 and result["feasible"] is True
    assert result["variable_count"] > 0 and result["constraint_count"] > 0
    assert result["time_limit_seconds"] == 5 and result["solve_seconds"] >= 0


def test_api_accepts_full_season_and_clips_at_final_week(monkeypatch):
    players = pool()
    for player in players:
        player["gw"] = {"38": player["gw"]["6"]}
    monkeypatch.setattr(api_module, "forecast_for", lambda _: {"players": players, "gameweeks": [38]})
    response = TestClient(api_module.app).post("/api/optimise", json={"start_gw": 38, "horizon": 38, "seconds": 2})
    assert response.status_code == 200, response.text
    assert response.json()["actual_horizon"] == 1


@pytest.mark.parametrize("fields", [
    {"transfer_limits": {"5": 1}}, {"transfer_limits": {"7": -1}},
    {"transfer_limits": {"7": 16}}, {"transfer_limits": {"7": True}},
    {"locked_by_gw": {"06": [1]}}, {"locked_by_gw": {"6": [999]}},
    {"locked_by_gw": {"6": [1, 1]}}, {"captain_locks": {"6": 999}},
    {"excluded_by_gw": {"7": [1]}, "captain_locks": {"7": 1}},
    {"locked": [1], "excluded_by_gw": {"7": [1]}},
    {"locked_by_gw": {"6": [1, 2, 3]}},
])
def test_invalid_or_conflicting_weekly_constraints_rejected(fields):
    with pytest.raises(ValueError):
        optimise(pool(), start_gw=6, horizon=3, seconds=2, **fields)


def test_missing_player_week_coverage_never_silently_becomes_zero():
    players = pool()
    del players[0]["gw"]["7"]
    with pytest.raises(ValueError, match="Every player"):
        optimise(players, start_gw=6, horizon=3, seconds=2)


def test_official_highs_warm_start_improves_checked_incumbent():
    builder = Builder()
    first = builder.var(cost=-1)
    second = builder.var(cost=-4)
    builder.constraint({first: 1, second: 1}, low=1, high=1)
    assert builder.feasible([1, 0])
    result = builder.solve(2, initial_solution=[1, 0])
    assert result.warm_start is True
    assert builder.feasible(result.x)
    assert result.x.tolist() == pytest.approx([0, 1])
    assert result.fun == pytest.approx(-4)


def test_long_joint_solver_honours_late_constraint_and_full_server_rules(monkeypatch):
    players, base = squad()
    target = next(p["id"] for p in players if p["id"] not in base["squad"] and p["position_id"] == 4)
    for player in players:
        player["gw"] = {str(gw): deepcopy(player["gw"]["6"]) for gw in range(6, 39)}
        if player["id"] == target:
            for gw in range(20, 22):
                player["gw"][str(gw)]["points"] = 20
    result = optimise(
        players, squad=base["squad"], bank=base["bank"], start_gw=6, horizon=16,
        free_transfers=3, max_transfers=1, seconds=2,
        locked_by_gw={"20": [target]}, captain_locks={"20": target},
        chips={"16": "freehit", "21": "wildcard"},
    )
    assert result["warm_start"] is True
    assert result["engine"] == "HiGHS · joint MILP"
    assert result["actual_horizon"] == 16
    late = next(w for w in result["weeks"] if w["gw"] == 20)
    assert target in late["squad"] and late["captain"] == target
    assert any(w["transfers_in"] for w in result["weeks"])
    monkeypatch.setattr(api_module, "forecast_for", lambda _: {"players": players, "gameweeks": list(range(6, 39))})
    validated = api_module.validate_plan(api_module.PlanRequest(
        base_squad=base["squad"], bank=base["bank"], free_transfers=3, weeks=result["weeks"],
    ))
    for raw, verified in zip(result["weeks"], validated["weeks"]):
        assert raw["bank"] == verified["bank"]
        assert raw["hits"] == verified["hits"]
        assert raw["next_free_transfers"] == verified["next_free_transfers"]


def test_long_prefix_itself_starts_from_checked_native_incumbent(monkeypatch):
    players, base = squad()
    for player in players:
        player["gw"] = {str(gw): deepcopy(player["gw"]["6"]) for gw in range(6, 39)}
    recorded = []
    original = Builder._warm_solve

    def observe(builder, matrix, seconds, seed):
        recorded.append({"seconds": seconds, "seed": seed is not None,
                         "feasible": seed is not None and builder.feasible(seed, matrix),
                         "columns": matrix.shape[1]})
        return original(builder, matrix, seconds, seed)

    monkeypatch.setattr(Builder, "_warm_solve", observe)
    # The reserve keeper captain lock must be represented in the legal hold,
    # as must the Free Hit's permanent state and preserved transfer allowance.
    keeper = next(pid for pid in base["bench"] if next(p for p in players if p["id"] == pid)["position_id"] == 1)
    result = optimise(
        players, squad=base["squad"], bank=base["bank"], free_transfers=3,
        start_gw=6, horizon=16, max_transfers=0, seconds=2,
        chips={"7": "freehit"}, captain_locks={"6": keeper},
    )
    assert len(recorded) == 2
    assert all(record["seed"] and record["feasible"] for record in recorded)
    assert recorded[0]["columns"] < recorded[1]["columns"]
    assert recorded[0]["seconds"] == 2
    assert result["weeks"][0]["captain"] == keeper
    monkeypatch.setattr(api_module, "forecast_for", lambda _: {"players": players, "gameweeks": list(range(6, 39))})
    verified = api_module.validate_plan(api_module.PlanRequest(
        base_squad=base["squad"], bank=base["bank"], free_transfers=3, weeks=result["weeks"],
    ))
    assert len(verified["weeks"]) == 16
    assert verified["weeks"][1]["next_free_transfers"] == 4
    assert verified["weeks"][1]["permanent_squad"] == verified["weeks"][0]["squad"]

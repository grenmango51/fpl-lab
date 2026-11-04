"""Short solves retain useful, rule-valid incumbents when joint search times out."""
from copy import deepcopy
from types import SimpleNamespace

import numpy as np
import pytest

from backend import solver
from backend.app import PlanRequest, validate_plan_payload
from backend.tests.test_rules import squad


def fixture():
    players, base = squad()
    for player in players:
        player["gw"] = {str(gw): deepcopy(player["gw"]["6"]) for gw in range(6, 11)}
    return players, base


def time_out_joint(monkeypatch, players):
    original = solver.Builder._warm_solve
    calls = []

    def solve(builder, matrix, seconds, seed):
        if len(builder.cost) <= len(players) * 4:
            return original(builder, matrix, seconds, seed)
        assert seed is not None and builder.feasible(seed, matrix)
        calls.append(seconds)
        return SimpleNamespace(x=np.asarray(seed), fun=float(np.dot(builder.cost, seed)),
                               status=1, mip_gap=None, engine="test timeout", warm_start=True)

    monkeypatch.setattr(solver.Builder, "_warm_solve", solve)
    return calls


def independently_check(players, base, result, **state):
    checked = validate_plan_payload(PlanRequest(
        base_squad=base["squad"], bank=base["bank"], weeks=result["weeks"], **state,
    ), {"players": players, "gameweeks": list(range(6, 11))})
    for raw, verified in zip(result["weeks"], checked["weeks"]):
        for key in ("bank", "hits", "free_transfers", "next_free_transfers", "net_points"):
            assert raw[key] == pytest.approx(verified[key])


@pytest.mark.parametrize("free_transfers", [0, 4])
def test_short_timeout_keeps_full_legal_plan_and_ft_state(monkeypatch, free_transfers):
    players, base = fixture()
    calls = time_out_joint(monkeypatch, players)
    result = solver.optimise(players, squad=base["squad"], bank=base["bank"],
                             start_gw=6, horizon=5, free_transfers=free_transfers, seconds=2)
    assert len(calls) == 1 and 0 < calls[0] <= 2
    assert result["warm_start"] and result["gap"] is None
    independently_check(players, base, result, free_transfers=free_transfers)


def test_banned_owned_player_is_repaired_before_timed_out_joint_search(monkeypatch):
    players, base = fixture()
    target = base["squad"][0]
    time_out_joint(monkeypatch, players)
    result = solver.optimise(players, squad=base["squad"], bank=base["bank"],
                             excluded=[target], start_gw=6, horizon=5, seconds=2)
    assert target in result["weeks"][0]["transfers_out"]
    assert all(target not in w["squad"] for w in result["weeks"])
    independently_check(players, base, result, free_transfers=1)


def test_seed_covers_bank_profit_chip_carry_and_reserve_keeper_captain(monkeypatch):
    players, base = fixture()
    keeper = next(i for i in base["bench"] if next(p for p in players if p["id"] == i)["position_id"] == 1)
    purchase = {str(i): 3.0 for i in base["squad"]}
    calls = time_out_joint(monkeypatch, players)
    result = solver.optimise(
        players, squad=base["squad"], bank=base["bank"], start_gw=6, horizon=5,
        max_transfers=0, seconds=2, free_transfers=4, purchase_prices=purchase,
        captain_locks={"6": keeper}, chips={"7": "freehit", "9": "wildcard"},
        transfer_limits={"7": 0, "9": 0},
    )
    assert len(calls) == 1
    assert result["weeks"][0]["captain"] == keeper
    assert all(not week["transfers_in"] for week in result["weeks"])
    independently_check(players, base, result, free_transfers=4, purchase_prices=purchase)


def test_provider_points_survive_local_zero_appearance_screening():
    players, base = fixture()
    target = next(p for p in players if p["id"] not in base["squad"] and p["position_id"] == 4)
    target["pplay"] = 0
    for forecast in target["gw"].values():
        forecast.update(points=30.0, pplay=0.0)
    result = solver.optimise(players, squad=base["squad"], bank=40, start_gw=6, horizon=5,
                             free_transfers=4, seconds=2)
    assert all(target["id"] in w["squad"] for w in result["weeks"])
    assert target["pplay"] == 0  # Screening cannot invent an appearance probability.


def test_seed_objective_is_same_as_joint_objective():
    players, base = fixture()
    lookup = {p["id"]: p for p in players}
    result = solver.optimise(players, squad=base["squad"], bank=base["bank"], start_gw=6,
                             horizon=5, seconds=2, free_transfers=0, risk=0.2,
                             chips={"7": "benchboost", "9": "triplecaptain"})
    assert solver._seed_objective(result["weeks"], lookup, 0.9, 1.5, 0.08, 0.2) == pytest.approx(result["objective"])

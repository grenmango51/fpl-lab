"""Frozen WC/FH placement jobs retain exact, adoptable FPL plan state."""

from copy import deepcopy
from threading import Event
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend import app as api_module
from backend.chip_strategy import ChipStrategyJobs, prepare
from backend.solver import optimise
from backend.tests.test_rules import pool


@pytest.fixture(scope="module")
def reference():
    players = pool()
    first = optimise(players, start_gw=6, horizon=1, seconds=2)["weeks"][0]
    args = api_module.SolveRequest(
        squad=first["squad"], bank=first["bank"], start_gw=6, horizon=3,
        free_transfers=3, seconds=2,
    ).model_dump(exclude=set(api_module.ForecastRequest.model_fields))
    return players, first, args


def setup_api(monkeypatch, reference, solve=optimise, clock=None):
    players, first, args = deepcopy(reference)
    payload = {"players": players, "gameweeks": [6, 7, 8], "model_version": "test"}
    calls = []

    def forecast(request):
        calls.append(request.model_dump())
        return payload

    manager = ChipStrategyJobs(solve, clock=clock) if clock else ChipStrategyJobs(solve)
    monkeypatch.setattr(api_module, "forecast_for", forecast)
    monkeypatch.setattr(api_module, "chip_strategy_jobs", manager)
    return TestClient(api_module.app), manager, payload, first, args, calls


def finish(manager, created):
    manager.jobs[created["id"]]["thread"].join(20)
    result = manager.get(created["id"])
    assert result["status"] not in ("running", "queued")
    return result


def test_placement_sampling_deterministic_and_manual_weeks_preserved(reference):
    players, _, args = deepcopy(reference)
    for player in players:
        player["gw"] = {str(gw): deepcopy(player["gw"]["6"]) for gw in range(7, 39)}
    args.update(start_gw=7, horizon=32, chips={"8": "triplecaptain", "21": "benchboost"})
    settings = {"auto_chip": "wildcard", "chip_half": 1, "candidate_gws": [], "max_candidates": 4}
    payload = {"players": players, "gameweeks": list(range(7, 39))}
    first = prepare(payload, args, settings)[-1]
    assert first == prepare(payload, args, settings)[-1]
    assert first["selected_gameweeks"] == [7, 12, 15, 19]
    assert 8 not in first["eligible_gameweeks"] and not first["all_eligible_selected"]
    settings.update(auto_chip="freehit", chip_half=2, candidate_gws=[20, 22, 27, 38], max_candidates=8)
    second = prepare(payload, args, settings)[-1]
    assert second["selected_gameweeks"] == [20, 22, 27, 38] and second["all_eligible_selected"]


@pytest.mark.parametrize("overrides,chip,half,requested", [
    ({"used_chips": [{"chip": "wildcard", "gw": 3}]}, "wildcard", 1, []),
    ({"chips": {"8": "freehit"}}, "freehit", 1, []),
    ({"chips": {"8": "triplecaptain"}}, "wildcard", 1, [8]),
    ({}, "wildcard", 1, [7, 7]), ({}, "freehit", 2, [8]),
])
def test_spent_allowances_collisions_and_wrong_half_are_rejected(reference, monkeypatch, overrides, chip, half, requested):
    client, _, _, _, args, _ = setup_api(monkeypatch, reference)
    response = client.post("/api/chip-strategy", json={
        **args, **overrides, "auto_chip": chip, "chip_half": half, "candidate_gws": requested,
    })
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("chip", ["wildcard", "freehit"])
def test_real_search_scores_same_gws_and_exposes_only_independently_validated_plans(reference, monkeypatch, chip):
    client, manager, _, _, args, calls = setup_api(monkeypatch, reference)
    args["chips"] = {"6": "triplecaptain"}
    response = client.post("/api/chip-strategy", json={
        **args, "auto_chip": chip, "chip_half": 1, "candidate_gws": [7, 8], "max_candidates": 2,
    })
    assert response.status_code == 200, response.text
    result = finish(manager, response.json())
    assert result["status"] == "complete"
    assert result["attempted"] == result["completed"] == result["total"] == 3
    assert len(calls) == 1 and result["baseline"]["gw"] is None
    for candidate in result["candidates"]:
        assert candidate["status"] == "complete"
        assert [week["gw"] for week in candidate["solve_weeks"]] == [6, 7, 8]
        assert candidate["weeks"][0]["chip"] == "triplecaptain"
        expected = sum(week["net_points"] * args["decay"] ** index for index, week in enumerate(candidate["solve_weeks"]))
        assert candidate["discounted_net_points"] == pytest.approx(expected)
        assert candidate["improvement"] == pytest.approx(expected - result["baseline"]["discounted_net_points"])
        assert all(len(week["permanent_squad"]) == len(week["purchase_prices"]) == 15 for week in candidate["weeks"])
        if candidate["gw"] is not None:
            assert next(week for week in candidate["weeks"] if week["gw"] == candidate["gw"])["chip"] == chip
    assert result["best"]["discounted_net_points"] >= result["baseline"]["discounted_net_points"]


def test_future_start_preserves_prefix_ft_purchase_history_and_freehit_restoration(reference, monkeypatch):
    client, manager, payload, first, _, _ = setup_api(monkeypatch, reference)
    owned = set(first["squad"])
    for player in payload["players"]:
        player["gw"]["7"]["points"] = 1 if player["id"] in owned else 100
    prior = {**deepcopy(first), "chip": "benchboost"}
    prices = {str(pid): 3.5 for pid in first["squad"]}
    response = client.post("/api/chip-strategy", json={
        "start_gw": 7, "horizon": 2, "auto_chip": "freehit", "chip_half": 1,
        "max_transfers": 0, "seconds": 2, "candidate_gws": [7],
        "source_plan": {"base_squad": first["squad"], "bank": 40, "free_transfers": 3,
                        "purchase_prices": prices, "used_chips": [{"chip": "wildcard", "gw": 3}],
                        "weeks": [prior, {**first, "gw": 7}, {**first, "gw": 8}]},
    })
    assert response.status_code == 200, response.text
    result = finish(manager, response.json())
    assert result["status"] == "complete"
    state = result["settings"]["solve"]
    assert state["squad"] == first["squad"] and state["bank"] == 40
    assert state["free_transfers"] == 4 and state["purchase_prices"] == prices
    assert state["used_chips"] == [{"chip": "wildcard", "gw": 3}, {"chip": "benchboost", "gw": 6}]
    candidate = result["candidates"][1]
    assert candidate["status"] == "complete", candidate.get("error")
    earlier, temporary, following = candidate["weeks"]
    assert earlier["gw"] == 6 and earlier["chip"] == "benchboost"
    assert candidate["solve_weeks"][0]["gw"] == 7
    assert temporary["chip"] == "freehit" and temporary["transfers_in"]
    assert temporary["permanent_squad"] == first["squad"] == following["squad"]
    assert temporary["permanent_bank"] == following["bank"] == 40
    assert temporary["purchase_prices"] == following["purchase_prices"] == prices
    assert temporary["next_free_transfers"] == following["free_transfers"] == 4


def test_cancel_freezes_forecasts_and_retains_exact_pending_candidate_states(reference, monkeypatch):
    entered, release = Event(), Event()
    observed = []
    baseline = {"weeks": [deepcopy(reference[1])]}

    def delayed(players, **args):
        observed.append((players[0]["gw"]["6"]["points"], args["bank"]))
        entered.set()
        assert release.wait(5)
        return deepcopy(baseline)

    client, manager, payload, _, args, _ = setup_api(monkeypatch, reference, delayed)
    args["horizon"] = 1
    response = client.post("/api/chip-strategy", json={**args, "auto_chip": "wildcard"})
    assert response.status_code == 200, response.text
    created = response.json()
    assert entered.wait(5)
    old_points = payload["players"][0]["gw"]["6"]["points"]
    payload["players"][0]["gw"]["6"]["points"] = 999
    args["bank"] = 999
    try:
        duplicate = client.post("/api/chip-strategy", json={**reference[2], "auto_chip": "wildcard"})
        assert duplicate.status_code == 409
        pending = client.post(f"/api/chip-strategy/{created['id']}/cancel").json()
        assert pending["cancel_requested"] and pending["status"] == "running"
    finally:
        release.set()
    result = finish(manager, created)
    assert result["status"] == "cancelled" and result["attempted"] == result["completed"] == 1
    assert [row["status"] for row in result["candidates"]] == ["complete", "skipped-cancel"]
    assert observed == [(old_points, reference[2]["bank"])]
    assert result["best"] is not None and result["recommendation"] is None


def test_wall_budget_stops_before_next_solve_and_discloses_unsolved_candidates(reference, monkeypatch):
    now = [100.0]

    def bounded(players, **args):
        now[0] += 31
        return {"weeks": [{**deepcopy(reference[1]), "gw": gw} for gw in (6, 7, 8)]}

    client, manager, _, _, args, _ = setup_api(monkeypatch, reference, bounded, clock=lambda: now[0])
    response = client.post("/api/chip-strategy", json={**args, "auto_chip": "freehit", "budget_seconds": 30})
    result = finish(manager, response.json())
    assert result["status"] == "budget-exhausted" and result["elapsed_seconds"] == 31
    assert result["attempted"] == result["completed"] == 1
    assert [row["status"] for row in result["candidates"]] == ["complete"] + ["skipped-budget"] * 3


def test_failed_baseline_never_claims_improvement_and_skips_all_placements(reference, monkeypatch):
    def failed(*unused, **args):
        raise ValueError("No feasible baseline")

    client, manager, _, _, args, _ = setup_api(monkeypatch, reference, failed)
    response = client.post("/api/chip-strategy", json={**args, "auto_chip": "wildcard"})
    result = finish(manager, response.json())
    assert result["status"] == "failed" and "baseline" in result["error"]
    assert result["best"] is None and result["recommendation"] is None
    assert result["attempted"] == 1 and result["completed"] == 0
    assert [row["status"] for row in result["candidates"]] == ["failed"] + ["skipped-failure"] * 3


def test_candidate_changing_fixed_chip_fails_validation_and_cannot_be_adopted(reference, monkeypatch):
    def broken(players, **args):
        return {"weeks": [deepcopy(reference[1])]}

    client, manager, _, _, args, _ = setup_api(monkeypatch, reference, broken)
    args["horizon"] = 1
    response = client.post("/api/chip-strategy", json={**args, "auto_chip": "wildcard"})
    result = finish(manager, response.json())
    assert result["status"] == "complete" and result["completed"] == 1 and result["attempted"] == 2
    assert result["candidates"][1]["status"] == "failed" and "chip" in result["candidates"][1]["error"]
    assert "weeks" not in result["candidates"][1]
    assert result["best"]["id"] == "baseline" and result["recommendation"] is None


@pytest.mark.parametrize("field,value", [("seconds", 45), ("max_candidates", 9), ("budget_seconds", 999), ("chip_half", True)])
def test_api_work_bounds_and_missing_jobs(reference, monkeypatch, field, value):
    client, _, _, _, args, _ = setup_api(monkeypatch, reference)
    response = client.post("/api/chip-strategy", json={**args, "auto_chip": "wildcard", field: value})
    assert response.status_code == 422
    assert client.get("/api/chip-strategy/missing").status_code == 404
    assert client.post("/api/chip-strategy/missing/cancel").status_code == 404


@pytest.mark.parametrize("chip", ["wildcard", "freehit"])
def test_short_strategy_retains_checked_hold_if_native_budget_has_no_new_incumbent(reference, monkeypatch, chip):
    import highspy

    accepted = []

    class NoNewIncumbent:
        def setOptionValue(self, *unused):
            return highspy.HighsStatus.kOk

        def passModel(self, lp):
            self.columns = lp.num_col_
            return highspy.HighsStatus.kOk

        def setSolution(self, solution):
            accepted.append(list(solution.col_value))
            return highspy.HighsStatus.kOk

        def run(self):
            return highspy.HighsStatus.kOk

        def getModelStatus(self):
            return highspy.HighsModelStatus.kTimeLimit

        def getInfo(self):
            return SimpleNamespace(mip_gap=float("inf"))

        def getSolution(self):
            return SimpleNamespace(col_value=[0] * self.columns)

        def modelStatusToString(self, unused):
            return "Time limit reached"

    monkeypatch.setattr(highspy, "Highs", NoNewIncumbent)
    client, manager, payload, first, args, _ = setup_api(monkeypatch, reference)
    payload["gameweeks"] = list(range(7, 13))
    for player in payload["players"]:
        player["gw"] = {str(gw): deepcopy(player["gw"]["6"]) for gw in payload["gameweeks"]}
    args.update(start_gw=7, horizon=6, seconds=2)
    response = client.post("/api/chip-strategy", json={
        **args, "auto_chip": chip, "candidate_gws": [7, 8], "max_candidates": 2, "budget_seconds": 30,
    })
    assert response.status_code == 200, response.text
    result = finish(manager, response.json())
    assert result["status"] == "complete" and result["completed"] == result["attempted"] == 3
    assert len(accepted) == 3  # Each native solve accepted its own checked incumbent.
    assert result["recommendation"] is None and result["best"]["id"] == "baseline"
    for row in result["candidates"]:
        assert row["solve"]["warm_start"] and row["solve"]["engine"] == "HiGHS · joint MILP"
        assert row["solve"]["gap"] is None and row["solve"]["native_status"] == "Time limit reached"
        assert [week["gw"] for week in row["weeks"]] == list(range(7, 13))
        assert all(set(week["permanent_squad"]) == set(first["squad"]) and week["permanent_bank"] == args["bank"]
                   for week in row["weeks"])
        if row["gw"] is not None:
            index = row["gw"] - 7
            selected = row["weeks"][index]
            assert selected["chip"] == chip
            assert selected["next_free_transfers"] == selected["free_transfers"]


def test_short_strategy_never_seeds_a_hold_that_violates_late_ownership(reference, monkeypatch):
    from backend.solver import Builder

    observed = []

    def no_feasible_result(builder, matrix, seconds, seed):
        observed.append(seed)
        return SimpleNamespace(x=None, fun=None, status=1, mip_gap=None)

    monkeypatch.setattr(Builder, "_warm_solve", no_feasible_result)
    client, manager, payload, first, args, _ = setup_api(monkeypatch, reference)
    target = next(player["id"] for player in payload["players"] if player["id"] not in first["squad"])
    args["locked_by_gw"] = {"8": [target]}
    response = client.post("/api/chip-strategy", json={**args, "auto_chip": "freehit"})
    assert response.status_code == 200, response.text
    result = finish(manager, response.json())
    assert result["status"] == "failed" and result["best"] is None
    assert observed == [None]  # Native feasibility search, with no illegal hold supplied.

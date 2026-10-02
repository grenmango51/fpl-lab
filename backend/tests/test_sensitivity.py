import copy
from threading import Event

import pytest
from fastapi.testclient import TestClient

from backend import app as api_module
from backend.scoring import appearance
from backend.sensitivity import SensitivityJobs, plan_value, stress_players, summarise
from backend.solver import optimise, validate_squad
from backend.tests.test_rules import pool


@pytest.fixture(scope="module")
def reference():
    players = pool()
    result = optimise(players, start_gw=6, horizon=1, seconds=2)
    first = result["weeks"][0]
    args = api_module.SolveRequest(
        squad=first["squad"],
        bank=first["bank"],
        start_gw=6,
        horizon=1,
        seconds=2,
        max_transfers=2,
    ).model_dump(exclude=set(api_module.ForecastRequest.model_fields))
    return players, result, args


def test_seeded_stress_freezes_inputs_and_preserves_appearance_and_blanks():
    players = pool()
    players[0]["gw"]["7"]["points"] = 0
    before = copy.deepcopy(players)
    stressed = stress_players(players, [6, 7, 8], 0.4, 2026, 1)
    assert (
        stressed
        == stress_players(list(reversed(players)), [6, 7, 8], 0.4, 2026, 1)[::-1]
    )
    assert players == before
    assert stressed[0]["gw"]["7"]["points"] == 0
    for original, changed in zip(players, stressed):
        ratios = [
            changed["gw"][str(gw)]["points"] / original["gw"][str(gw)]["points"]
            for gw in (6, 8)
        ]
        assert ratios[0] == pytest.approx(ratios[1])
        assert appearance(original, 6) == appearance(changed, 6)
    assert (
        stress_players(players, [6, 7], 0, 2, 1)[1]["gw"]["6"]["points"]
        == players[1]["gw"]["6"]["points"]
    )
    assert stressed != stress_players(players, [6, 7, 8], 0.4, 2026, 2)


def test_real_stress_plans_pass_independent_rules_and_normal_rescoring(
    reference, monkeypatch
):
    players, _, args = reference
    args = {**args, "horizon": 2}
    manager = SensitivityJobs()
    payload = {"players": players, "gameweeks": [6, 7, 8], "model_version": "test"}
    created = manager.start(payload, args, 3, 0.25, 2026, "Test")
    manager.jobs[created["id"]]["thread"].join(30)
    job = manager.get(created["id"])
    assert job["status"] == "complete"
    assert job["completed"] == job["attempted"] == 3
    assert job["summary"]["denominator"] == 3
    assert sum(row["count"] for row in job["summary"]["frequencies"]["captains"]) == 3
    monkeypatch.setattr(api_module, "forecast_for", lambda request: payload)
    client = TestClient(api_module.app)
    for variant in job["summary"]["variants"]:
        for week in variant["weeks"]:
            assert not validate_squad(
                week["squad"],
                players,
                starters=week["starters"],
                captain=week["captain"],
                vice=week["vice"],
            )
        result = client.post(
            "/api/plan/validate",
            json={
                "base_squad": args["squad"],
                "bank": args["bank"],
                "free_transfers": args["free_transfers"],
                "weeks": variant["weeks"],
            },
        )
        assert result.status_code == 200, result.text
        weeks = result.json()["weeks"]
        assert variant["base_value"] == pytest.approx(
            plan_value(weeks, players, args["decay"])
        )
        for raw, valid in zip(variant["weeks"], weeks):
            assert raw["bank"] == valid["bank"]
            assert raw["hits"] == valid["hits"]
            assert raw["next_free_transfers"] == valid["next_free_transfers"]


def test_running_job_freezes_data_rejects_duplicate_and_can_cancel(reference):
    players, baseline, args = copy.deepcopy(reference)
    entered, release = Event(), Event()
    observed = []

    def delayed(frozen, **kwargs):
        observed.append(frozen[0]["gw"]["6"]["points"])
        entered.set()
        assert release.wait(5)
        return copy.deepcopy(baseline)

    manager = SensitivityJobs(delayed)
    payload = {"players": players}
    job = manager.start(payload, args, 3, 0.25, 1, "Freeze")
    assert entered.wait(5)
    expected = players[0]["gw"]["6"]["points"]
    players[0]["gw"]["6"]["points"] = 999
    args["bank"] = 999
    try:
        with pytest.raises(ValueError, match="already running"):
            manager.start(payload, args, 3, 0.25, 1, "Second")
        pending = manager.cancel(job["id"])
        assert pending["cancel_requested"]
        assert pending["status"] == "running"
    finally:
        release.set()
    manager.jobs[job["id"]]["thread"].join(5)
    result = manager.get(job["id"])
    assert result["status"] == "cancelled"
    assert result["completed"] == 0
    assert observed == [expected]
    assert result["settings"]["solve"]["bank"] != 999


def test_failures_and_dead_worker_are_terminal(reference):
    players, _, args = reference

    def failed(*unused, **kwargs):
        raise RuntimeError("Failed reference")

    manager = SensitivityJobs(failed)
    job = manager.start({"players": players}, args, 3, 0.25, 1, "Failure")
    manager.jobs[job["id"]]["thread"].join(5)
    assert manager.get(job["id"])["status"] == "failed"
    assert manager.get(job["id"])["error"] == "Failed reference"
    manager.jobs[job["id"]]["public"]["status"] = "running"
    assert manager.get(job["id"])["status"] == "failed"
    assert "worker stopped" in manager.get(job["id"])["error"]


def test_api_rejects_unbounded_work_and_reports_missing_job(reference, monkeypatch):
    players, _, args = reference
    monkeypatch.setattr(
        api_module,
        "forecast_for",
        lambda request: {"players": players, "gameweeks": [6, 7, 8]},
    )
    client = TestClient(api_module.app)
    for field, value in [
        ("scenarios", 100),
        ("horizon", 14),
        ("seconds", 45),
        ("variation", -0.5),
    ]:
        response = client.post("/api/sensitivity", json={**args, field: value})
        assert response.status_code == 422
    assert client.get("/api/sensitivity/missing").status_code == 404
    assert client.post("/api/sensitivity/missing/cancel").status_code == 404


def test_difference_can_be_negative_and_no_scenarios_has_no_confidence():
    assert summarise([])["differences"] is None
    assert summarise([])["denominator"] == 0
    rows = [
        {
            "scenario": 1,
            "weeks": [{"transfers_in": [], "transfers_out": [], "captain": 12}],
            "base_value": 50,
            "gap": 0.1,
            "difference": -2,
        }
    ]
    summary = summarise(rows)
    assert summary["differences"]["mean"] == -2
    assert summary["roll_count"] == 1

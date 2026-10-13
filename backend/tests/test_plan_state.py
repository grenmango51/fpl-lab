"""Validated permanent holdings are sufficient to rebase a saved branch."""

from copy import deepcopy
import json

import pytest
from fastapi.testclient import TestClient

from backend import app as api_module
from backend.tests.test_chip_planner import fixed_plan


def state_fixture(monkeypatch):
    players, weeks = fixed_plan((7, 8, 9, 10))
    players[1]["price"] = 6.5
    for pid, price in ((16, 5.6), (17, 7.0)):
        replacement = deepcopy(players[1])
        replacement.update({"id": pid, "team": 6, "price": price})
        players.append(replacement)
    monkeypatch.setattr(
        api_module, "forecast_for", lambda _: {"players": players, "gameweeks": [7, 8, 9, 10]},
    )
    body = {
        "base_squad": weeks[0]["squad"], "bank": 1, "free_transfers": 3,
        "purchase_prices": {"2": 6.0}, "weeks": deepcopy(weeks),
    }
    return players, body


def swap(week, outgoing, incoming):
    for field in ("squad", "starters", "bench"):
        week[field] = [incoming if pid == outgoing else pid for pid in week[field]]


def test_post_week_receipts_keep_profit_prices_and_restore_freehit_state(monkeypatch):
    _, body = state_fixture(monkeypatch)
    swap(body["weeks"][0], 2, 16)
    swap(body["weeks"][2], 2, 17)
    body["weeks"][2]["chip"] = "freehit"
    response = TestClient(api_module.app).post("/api/plan/validate", json=body)
    assert response.status_code == 200, response.text
    first, second, temporary, following = response.json()["weeks"]
    assert first["bank"] == first["permanent_bank"] == 1.6  # Sell for 6.2, buy for 5.6.
    assert first["purchase_prices"]["16"] == 5.6
    assert "2" not in first["purchase_prices"]
    assert first["permanent_squad"] == first["squad"]
    assert second["bank"] == second["permanent_bank"] == 0.7
    assert second["purchase_prices"]["2"] == 6.5  # The re-purchase resets cost.
    assert "16" not in second["purchase_prices"]
    assert temporary["bank"] == 0.2
    assert temporary["permanent_bank"] == following["permanent_bank"] == 0.7
    assert temporary["permanent_squad"] == second["squad"] == following["squad"]
    assert temporary["purchase_prices"] == second["purchase_prices"] == following["purchase_prices"]
    assert "17" not in temporary["purchase_prices"]
    assert temporary["next_free_transfers"] == 3 and following["next_free_transfers"] == 4
    # Later transfers cannot mutate an earlier receipt.
    assert first["purchase_prices"]["16"] == 5.6


def test_rebased_receipt_retains_historical_cost_after_live_price_rise(monkeypatch):
    players, body = state_fixture(monkeypatch)
    body["weeks"] = body["weeks"][:1]
    swap(body["weeks"][0], 2, 16)
    client = TestClient(api_module.app)
    first = client.post("/api/plan/validate", json=body).json()["weeks"][0]
    next(player for player in players if player["id"] == 16)["price"] = 6.9
    restored = deepcopy(body["weeks"][0])
    restored["gw"] = 8
    swap(restored, 16, 2)
    response = client.post("/api/plan/validate", json={
        "base_squad": first["permanent_squad"], "bank": first["permanent_bank"],
        "free_transfers": first["next_free_transfers"],
        "purchase_prices": first["purchase_prices"], "weeks": [restored],
    })
    assert response.status_code == 200, response.text
    rebased = response.json()["weeks"][0]
    assert rebased["bank"] == 1.3  # 1.6 + original-cost sale 6.2 - purchase 6.5.
    assert rebased["purchase_prices"]["2"] == 6.5


def test_unknown_future_squad_player_returns_validation_error(monkeypatch):
    _, body = state_fixture(monkeypatch)
    swap(body["weeks"][0], 2, 999)
    response = TestClient(api_module.app).post("/api/plan/validate", json=body)
    assert response.status_code == 422
    assert "unknown player" in response.text


@pytest.mark.parametrize("history,message", [
    ([{"chip": "triplecaptain", "gw": 1}, {"chip": "triplecaptain", "gw": 2}], "once per half"),
    ([{"chip": "triplecaptain", "gw": 1}, {"chip": "benchboost", "gw": 1}], "one chip"),
    ([{"chip": "triplecaptain", "gw": 7}], "precede"),
])
def test_invalid_chip_ledger_rejected_by_plan_and_solver(monkeypatch, history, message):
    _, body = state_fixture(monkeypatch)
    body["used_chips"] = history
    client = TestClient(api_module.app)
    for endpoint, request in (
        ("/api/plan/validate", body),
        ("/api/optimise", {"squad": body["base_squad"], "bank": 1, "start_gw": 7,
                            "horizon": 1, "seconds": 2, "used_chips": history}),
    ):
        response = client.post(endpoint, json=request)
        assert response.status_code == 422, response.text
        assert message in response.text


@pytest.mark.parametrize("price", [-1, 0, 201, float("nan"), float("inf")])
def test_invalid_purchase_cost_never_crashes_or_enters_rebase_receipt(monkeypatch, price):
    _, body = state_fixture(monkeypatch)
    body["purchase_prices"] = {"2": price}
    response = TestClient(api_module.app).post(
        "/api/plan/validate", content=json.dumps(body), headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422


def test_chip_schedule_outside_solve_window_is_rejected(monkeypatch):
    _, body = state_fixture(monkeypatch)
    response = TestClient(api_module.app).post("/api/optimise", json={
        "squad": body["base_squad"], "bank": 1, "start_gw": 7, "horizon": 1,
        "seconds": 2, "chips": {"8": "benchboost"},
    })
    assert response.status_code == 422
    assert "solve window" in response.text

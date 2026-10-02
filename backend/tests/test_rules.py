import math

import pytest
from fastapi.testclient import TestClient

from backend.model import components, player_profile, positional_priors
from backend.solver import sale_price, validate_squad, best_lineup, optimise
from backend import app as api_module


def pool():
    players = []
    pid = 1
    for pos, count in [(1, 4), (2, 10), (3, 10), (4, 6)]:
        for j in range(count):
            players.append(
                {
                    "id": pid,
                    "position_id": pos,
                    "team": j % 6 + 1,
                    "price": 4.0,
                    "pplay": 0.95,
                    "ownership": 10,
                    "gw": {
                        str(gw): {
                            "points": float(
                                4 + j / 10 + (2 if gw == 7 and j == count - 1 else 0)
                            )
                        }
                        for gw in [6, 7, 8]
                    },
                    "name": str(pid),
                }
            )
            pid += 1
    return players


def squad():
    players = pool()
    result = optimise(players, start_gw=6, horizon=1, seconds=5)
    return players, result["weeks"][0]


def test_sale_rounding_and_falls():
    assert sale_price(6.5, 6.0) == 6.2
    assert sale_price(6.4, 6.0) == 6.2
    assert sale_price(5.8, 6.0) == 5.8


def test_goalkeeper_current_goal_scoring():
    rates = {
        k: 0
        for k in [
            "expected_goals",
            "expected_assists",
            "bonus",
            "saves",
            "yellow_cards",
            "red_cards",
            "own_goals",
            "penalties_missed",
            "penalties_saved",
        ]
    }
    rates["expected_goals"] = 1
    profile = {
        "p60": 1,
        "pshort": 0,
        "xmins": 90,
        "long_mean": 90,
        "short_mean": 20,
        "pplay": 1,
        "rates": rates,
        "team_xg": 2,
        "dc_prob": 0,
    }
    forecast = components(profile, 1, 2, 0, 1)
    assert forecast["components"]["goals"] == 10
    assert forecast["components"]["clean_sheet"] == 4
    assert forecast["points"] == 16


def test_short_appearance_has_no_clean_sheet():
    rates = {
        k: 0
        for k in [
            "expected_goals",
            "expected_assists",
            "bonus",
            "saves",
            "yellow_cards",
            "red_cards",
            "own_goals",
            "penalties_missed",
            "penalties_saved",
        ]
    }
    p = {
        "p60": 0,
        "pshort": 1,
        "xmins": 30,
        "long_mean": 90,
        "short_mean": 30,
        "pplay": 1,
        "rates": rates,
        "team_xg": 2,
        "dc_prob": 0,
    }
    f = components(p, 2, 2, 0, 1)
    assert f["components"]["appearance"] == 1
    assert f["components"]["clean_sheet"] == 0


def test_poisson_conceded_pair_expectation():
    rates = {
        k: 0
        for k in [
            "expected_goals",
            "expected_assists",
            "bonus",
            "saves",
            "yellow_cards",
            "red_cards",
            "own_goals",
            "penalties_missed",
            "penalties_saved",
        ]
    }
    p = {
        "p60": 1,
        "pshort": 0,
        "xmins": 90,
        "long_mean": 90,
        "short_mean": 20,
        "pplay": 1,
        "rates": rates,
        "team_xg": 2,
        "dc_prob": 0,
    }
    f = components(p, 2, 2, 2, math.exp(-2))
    from scipy.stats import poisson

    expected = sum((n // 2) * poisson.pmf(n, 2) for n in range(50))
    assert -f["components"]["deductions"] == pytest.approx(expected)


def test_prior_cannot_read_holdout():
    row = {"season": "2025-26", "position": 4, "minutes": 90, "expected_goals": 99}
    prior = positional_priors([row], "2025-26")
    assert prior[4]["expected_goals"] == 0


def test_zero_minutes_override():
    row = {
        "minutes": 90,
        "total_points": 8,
        "season": "2025-26",
        "team_goals": 2,
        "expected_goals": 0.5,
    }
    profile = player_profile([row] * 5, 4, {}, minutes_override=0)
    assert profile["xmins"] == 0 and profile["pplay"] == 0
    assert components(profile, 4, 2, 1)["points"] == 0


def test_legal_squad_and_captain():
    players, week = squad()
    assert not validate_squad(
        week["squad"], players, 100, week["starters"], week["captain"], week["vice"]
    )
    assert len(week["squad"]) == 15 and len(week["starters"]) == 11
    assert week["bank"] == 40
    assert week["captain"] in week["starters"]


def test_duplicate_and_over_budget_rejected():
    players, week = squad()
    ids = week["squad"][:]
    ids[1] = ids[0]
    assert any("twice" in e for e in validate_squad(ids, players))
    assert any("budget" in e for e in validate_squad(week["squad"], players, 20))


def test_non_starter_captain_rejected():
    players, week = squad()
    errors = validate_squad(
        week["squad"],
        players,
        starters=week["starters"],
        captain=week["bench"][0],
        vice=week["vice"],
    )
    assert any("Captain" in e for e in errors)


def test_ft_cap_and_zero_transfer_solver():
    players, base = squad()
    plan = optimise(
        players,
        squad=base["squad"],
        bank=40,
        free_transfers=5,
        max_transfers=0,
        start_gw=6,
        horizon=3,
        seconds=5,
    )
    assert all(
        w["free_transfers"] == 5 and w["next_free_transfers"] == 5
        for w in plan["weeks"]
    )
    assert all(w["hits"] == 0 and not w["transfers_in"] for w in plan["weeks"])


def test_freehit_reverts_permanent_squad():
    players, base = squad()
    plan = optimise(
        players,
        squad=base["squad"],
        bank=40,
        free_transfers=2,
        max_transfers=0,
        start_gw=6,
        horizon=3,
        chips={"7": "freehit"},
        seconds=5,
    )
    assert set(plan["weeks"][2]["squad"]) == set(base["squad"])
    assert plan["weeks"][2]["bank"] == 40
    assert plan["weeks"][1]["hits"] == 0


def test_server_recomputes_points_and_hits(monkeypatch):
    players, base = squad()
    monkeypatch.setattr(
        api_module,
        "forecast_for",
        lambda _: {"players": players, "gameweeks": [6, 7, 8]},
    )
    client = TestClient(api_module.app)
    body = {
        "base_squad": base["squad"],
        "bank": 40,
        "free_transfers": 1,
        "weeks": [
            {
                k: base[k]
                for k in ["gw", "squad", "starters", "bench", "captain", "vice", "chip"]
            }
        ],
    }
    body["weeks"][0]["points"] = 9999
    response = client.post("/api/plan/validate", json=body)
    assert response.status_code == 200
    assert response.json()["weeks"][0]["points"] != 9999
    assert response.json()["weeks"][0]["next_free_transfers"] == 2


def test_server_rejects_negative_bank_transfer(monkeypatch):
    players, base = squad()
    monkeypatch.setattr(
        api_module,
        "forecast_for",
        lambda _: {"players": players, "gameweeks": [6, 7, 8]},
    )
    old = base["squad"][0]
    new = next(
        p
        for p in players
        if p["position_id"] == next(p for p in players if p["id"] == old)["position_id"]
        and p["id"] not in base["squad"]
    )
    new["price"] = 10
    replaced = [new["id"] if i == old else i for i in base["squad"]]
    lineup = best_lineup(replaced, players, 6)
    week = {
        "gw": 6,
        "squad": replaced,
        "chip": "none",
        **{k: lineup[k] for k in ["starters", "bench", "captain", "vice"]},
    }
    r = TestClient(api_module.app).post(
        "/api/plan/validate",
        json={"base_squad": base["squad"], "bank": 0, "weeks": [week]},
    )
    assert r.status_code == 422


def test_invalid_minutes_payload():
    response = TestClient(api_module.app).post(
        "/api/projections", json={"overrides": {"1": float(91)}}
    )
    assert response.status_code == 422

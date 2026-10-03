"""Saved transfer allowances across WC/FH, independent of unlimited chip moves."""

import copy
import json

import pytest
from fastapi.testclient import TestClient

from backend import app as api_module
from backend.solver import optimise
from backend.tests.test_rules import pool


@pytest.fixture(scope="module")
def reference():
    players = pool()
    base = optimise(players, start_gw=6, horizon=1, seconds=2)["weeks"][0]
    return players, base


def validate(monkeypatch, players, base, weeks, free_transfers):
    monkeypatch.setattr(
        api_module,
        "forecast_for",
        lambda _: {"players": players, "gameweeks": [6, 7, 8]},
    )
    response = TestClient(api_module.app).post(
        "/api/plan/validate",
        json={
            "base_squad": base["squad"],
            "bank": base["bank"],
            "free_transfers": free_transfers,
            "weeks": weeks,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["weeks"]


@pytest.mark.parametrize("chip", ["wildcard", "freehit"])
@pytest.mark.parametrize("saved", [0, 1, 2, 4, 5])
def test_chip_preserves_allowance_then_normal_week_rolls(
    reference, monkeypatch, chip, saved
):
    players, base = reference
    result = optimise(
        players,
        squad=base["squad"],
        bank=base["bank"],
        free_transfers=saved,
        max_transfers=0,
        start_gw=6,
        horizon=2,
        chips={6: chip},
        seconds=2,
    )
    scored = validate(monkeypatch, players, base, result["weeks"], saved)
    expected = [(saved, saved), (saved, min(5, saved + 1))]
    for weeks in (result["weeks"], scored):
        assert [
            (w["free_transfers"], w["next_free_transfers"]) for w in weeks
        ] == expected
        assert [w["hits"] for w in weeks] == [0, 0]
        assert not weeks[1]["transfers_in"]


@pytest.mark.parametrize("chip", ["wildcard", "freehit"])
def test_three_moves_after_chip_use_two_saved_transfers_and_cost_four_points(
    reference, monkeypatch, chip
):
    players, base = copy.deepcopy(reference)
    for player in players:
        player["gw"]["6"]["points"] = 100 if player["id"] in base["squad"] else 0
        player["gw"]["7"]["points"] = 1 if player["id"] in base["squad"] else 100
    result = optimise(
        players,
        squad=base["squad"],
        bank=base["bank"],
        free_transfers=2,
        max_transfers=3,
        start_gw=6,
        horizon=2,
        chips={6: chip},
        seconds=2,
    )
    scored = validate(monkeypatch, players, base, result["weeks"], 2)
    for weeks in (result["weeks"], scored):
        assert weeks[0]["next_free_transfers"] == 2
        assert len(weeks[1]["transfers_in"]) == 3
        assert weeks[1]["free_transfers"] == 2
        assert weeks[1]["hits"] == 4
        assert weeks[1]["next_free_transfers"] == 1


def test_fresh_squad_setup_keeps_normal_roll_after_adoption(reference, monkeypatch):
    players, _ = reference
    result = optimise(
        players,
        free_transfers=2,
        max_transfers=0,
        start_gw=6,
        horizon=2,
        seconds=2,
    )
    assert len(result["weeks"][0]["transfers_in"]) == 15
    # Adopting a fresh squad establishes its first 15 as the branch base.
    scored = validate(monkeypatch, players, result["weeks"][0], result["weeks"], 2)
    assert not scored[0]["transfers_in"]
    for weeks in (result["weeks"], scored):
        assert [(w["free_transfers"], w["next_free_transfers"]) for w in weeks] == [
            (2, 3),
            (3, 4),
        ]


def test_public_2200722_import_reconstructs_three_for_gameweek_six(monkeypatch):
    # Public API audit, 2026-10-03: BB1, roll2, WC3, one move4, roll5.
    # The 12 GW3 transactions include two players bought and sold in the same
    # chip week. All are free, including the move before WC activation.
    ids = [1, 445, 387, 8, 31, 40, 154, 368, 565, 464, 411, 301, 124, 259, 165]
    wc_in = [399, 1, 111, 31, 449, 387, 368, 565, 154, 464, 301, 445]
    transfers = [
        {
            "event": 3,
            "element_in": pid,
            "element_in_cost": 40,
            "time": f"2026-09-04T17:19:{index:02d}Z",
        }
        for index, pid in enumerate(wc_in)
    ] + [
        {
            "event": 4,
            "element_in": 40,
            "element_out": 399,
            "element_in_cost": 76,
            "time": "2026-09-12T12:26:12Z",
        }
    ]

    def fetch(url, *args, **kwargs):
        if "/event/5/picks/" in url:
            return json.dumps(
                {
                    "active_chip": None,
                    "entry_history": {"bank": 2, "event_transfers": 0},
                    "picks": [
                        {
                            "element": pid,
                            "position": index + 1,
                            "is_captain": pid == 411,
                            "is_vice_captain": pid == 154,
                        }
                        for index, pid in enumerate(ids)
                    ],
                }
            )
        if "/transfers/" in url:
            return json.dumps(transfers)
        if "/history/" in url:
            return json.dumps(
                {
                    "chips": [
                        {"name": "bboost", "event": 1},
                        {"name": "wildcard", "event": 3},
                    ],
                    "current": [
                        {"event": gw, "event_transfers": 1 if gw == 4 else 0}
                        for gw in range(1, 6)
                    ],
                }
            )
        assert url.endswith("/entry/2200722/")
        return json.dumps({"current_event": 5, "started_event": 1})

    monkeypatch.setattr(api_module, "fetch", fetch)
    monkeypatch.setattr(api_module, "player_history", lambda _: [])
    monkeypatch.setattr(
        api_module,
        "get_data",
        lambda: {
            "next_gw": 6,
            "season": "2026-27",
            "players": {pid: {"now_cost": 40} for pid in ids},
        },
    )
    response = TestClient(api_module.app).get("/api/teams/2200722")
    assert response.status_code == 200, response.text
    imported = response.json()
    assert imported["gw"] == 5
    assert imported["bank"] == 0.2
    assert imported["free_transfers"] == 3
    assert imported["squad"] == ids
    assert imported["used_chips"] == [
        {"chip": "benchboost", "gw": 1},
        {"chip": "wildcard", "gw": 3},
    ]

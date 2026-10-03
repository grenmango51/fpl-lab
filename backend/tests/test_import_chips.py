import json

from fastapi.testclient import TestClient

from backend import app as api_module
from backend.tests.test_rules import squad


def test_spent_chip_cannot_be_used_again(monkeypatch):
    players, week = squad()
    monkeypatch.setattr(
        api_module,
        "forecast_for",
        lambda _: {"players": players, "gameweeks": [6, 7, 8]},
    )
    body = {
        "base_squad": week["squad"],
        "bank": 40,
        "used_chips": [{"chip": "triplecaptain", "gw": 3}],
        "weeks": [
            {
                k: week[k]
                for k in ["gw", "squad", "starters", "bench", "captain", "vice", "chip"]
            }
        ],
    }
    body["weeks"][0]["chip"] = "triplecaptain"
    response = TestClient(api_module.app).post("/api/plan/validate", json=body)
    assert response.status_code == 422
    assert "twice" in response.text


def test_import_restores_permanent_squad_after_freehit(monkeypatch):
    players, week = squad()
    permanent = week["starters"] + week["bench"]
    replacement = next(
        p["id"]
        for p in players
        if p["id"] not in permanent
        and p["position_id"]
        == next(p["position_id"] for p in players if p["id"] == permanent[0])
    )
    temporary = [replacement] + permanent[1:]

    def picks(ids, bank, chip):
        return {
            "active_chip": chip,
            "entry_history": {"bank": bank},
            "picks": [
                {
                    "element": i,
                    "position": j + 1,
                    "is_captain": i == week["captain"],
                    "is_vice_captain": i == week["vice"],
                }
                for j, i in enumerate(ids)
            ],
        }

    def fetch(url, *args, **kwargs):
        if "/event/5/" in url:
            return json.dumps(picks(temporary, 0, "freehit"))
        if "/event/4/" in url:
            return json.dumps(picks(permanent, 40, None))
        if "/transfers/" in url:
            return json.dumps(
                [
                    {
                        "event": 5,
                        "element_in": permanent[1],
                        "element_in_cost": 60,
                        "time": "2026-09-20",
                    }
                ]
            )
        if "/history/" in url:
            return json.dumps({"chips": [{"name": "freehit", "event": 5}]})
        return json.dumps({"current_event": 5, "name": "Test entry"})

    monkeypatch.setattr(
        api_module,
        "get_data",
        lambda: {
            "next_gw": 6,
            "season": "2026-27",
            "players": {p["id"]: {"now_cost": 40} for p in players},
        },
    )
    monkeypatch.setattr(api_module, "fetch", fetch)
    monkeypatch.setattr(api_module, "player_history", lambda _: [])
    result = TestClient(api_module.app).get("/api/teams/7").json()
    assert result["squad"] == permanent
    assert result["bank"] == 4
    assert result["free_transfers"] == 4
    assert result["used_chips"] == [{"chip": "freehit", "gw": 5}]
    assert result["purchase_prices"][str(permanent[1])] == 4

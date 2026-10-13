from fastapi.testclient import TestClient

from backend import app as api_module


def test_market_filters_reach_history_helper(monkeypatch):
    calls = []

    def history(**filters):
        calls.append(filters)
        return {"series": [], "coverage": {"snapshots": 0}}

    monkeypatch.setattr(api_module, "market_history", history)
    response = TestClient(api_module.app).get("/api/market-history", params={
        "gameweek": 7, "fixture_id": 63, "team": "ARS", "source": "fpljoe",
        "since": "2026-10-01T00:00:00Z", "until": "2026-10-13T00:00:00Z",
    })
    assert response.status_code == 200
    assert calls == [{"gameweek": 7, "fixture_id": 63, "team": "ARS", "source": "fpljoe",
                      "since": "2026-10-01T00:00:00Z", "until": "2026-10-13T00:00:00Z"}]


def test_invalid_market_filters_return_422(monkeypatch):
    def invalid(**unused):
        raise ValueError("Timestamp needs a timezone")

    monkeypatch.setattr(api_module, "market_history", invalid)
    response = TestClient(api_module.app).get("/api/market-history?since=2026-10-01")
    assert response.status_code == 422 and "timezone" in response.text


def test_capture_route_returns_cache_receipt_without_forecast_refresh(monkeypatch):
    monkeypatch.setattr(api_module, "capture_market_history", lambda: {"saved": 4, "fresh_fetch": False})
    monkeypatch.setattr(api_module, "forecast_for", lambda _: (_ for _ in ()).throw(AssertionError("unexpected forecast")))
    response = TestClient(api_module.app).post("/api/market-history/capture")
    assert response.status_code == 200
    assert response.json() == {"saved": 4, "fresh_fetch": False}

"""Human stat edits reconcile events without changing unrelated calibration."""

from copy import deepcopy
from datetime import timedelta

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend import app as api_module, model
from backend.capture import read_snapshot
from backend.scenarios import apply_stat_schedule, canonical_stat_schedule
from backend.tests.test_minutes_schedule import synthetic_data, forecast
from backend.tests.test_capture import NOW, capture_clock, capture_dataset


@pytest.fixture
def data(monkeypatch):
    dataset = synthetic_data()
    dataset["fplform"] = {"source_at": "test provider", "players": {
        "2": {"points": {"6": 5.5, "7": 10, "9": 3.2}, "probabilities": {"6": 0.6, "9": 0.7}}
    }}
    monkeypatch.setattr(api_module, "get_data", lambda: dataset)
    monkeypatch.setattr(model, "_projections", None)
    monkeypatch.setattr(model, "_projection_key", None)
    return dataset


def options(**fields):
    return api_module.ForecastRequest(
        use_market=False, provider_weight=0.7, custom_points={"2": {"6": 6.2, "7": 12}},
        blend_weight=0.4, **fields,
    )


def test_stat_edits_preserve_every_unedited_week_and_calibration_exactly(data):
    baseline = api_module.forecast_for(options(), dataset=data)
    frozen = deepcopy(baseline)
    result = api_module.forecast_for(options(stat_schedule={"2": {"7": {"xg": 0.8, "xa": 0.5}}}), dataset=data)
    for original, player in zip(baseline["players"], result["players"]):
        for gw, week in original["gw"].items():
            if player["id"] != 2 or gw != "7":
                assert player["gw"][gw] == week
    assert baseline == frozen
    edited = forecast(result, 2, 7)
    assert sum(f["xg"] for f in edited["fixtures"]) == pytest.approx(0.8)
    assert sum(f["xa"] for f in edited["fixtures"]) == pytest.approx(0.5)
    assert edited["components"]["goals"] == pytest.approx(4)
    assert edited["components"]["assists"] == pytest.approx(1.5)
    assert edited["points"] == pytest.approx(
        forecast(baseline, 2, 7)["points"]
        + 4 - forecast(baseline, 2, 7)["components"]["goals"]
        + 1.5 - forecast(baseline, 2, 7)["components"]["assists"]
    )
    assert edited["prediction_source"]["kind"] == "user-scenario"
    assert edited["prediction_source"]["previous"] == forecast(baseline, 2, 7)["prediction_source"]
    assert edited["stat_scenario"]["source"] == "user-assumed"


def test_double_gw_clean_sheet_points_and_points_residual_reconcile(data):
    result = api_module.forecast_for(options(stat_schedule={"2": {"7": {
        "xg": 0.6, "xa": 0.4, "clean_sheet_probability": 0.8, "expected_points": 9.2,
    }}}), dataset=data)
    week = forecast(result, 2, 7)
    assert week["points"] == pytest.approx(9.2)
    assert week["points"] == pytest.approx(sum(week["components"].values()))
    assert week["points"] == pytest.approx(sum(f["points"] for f in week["fixtures"]))
    assert week["components"]["clean_sheet"] == pytest.approx(sum(0.8 * f["p60"] for f in week["fixtures"]))
    assert "user_points_adjustment" in week["components"]
    for fixture in week["fixtures"]:
        assert fixture["cs"] == 0.8
        assert fixture["points"] == pytest.approx(sum(fixture["components"].values()))
    # Existing point anchors retain their own labels, never turned into xG.
    assert "provider_adjustment" in week["components"]
    assert "imported_adjustment" in week["components"]


def test_event_allocation_uses_original_fixture_shares_and_minutes_fallback(data):
    base = deepcopy(model.projections(None, False, dataset=data))
    week = forecast(base, 2, 7)
    week["fixtures"][0]["xg"], week["fixtures"][1]["xg"] = 0.1, 0.3
    for f in week["fixtures"]:
        f["xa"] = 0
    result = apply_stat_schedule(base, {"2": {"7": {"xg": 0.8, "xa": 0.4}}})
    fixtures = forecast(result, 2, 7)["fixtures"]
    assert [f["xg"] for f in fixtures] == pytest.approx([0.2, 0.6])
    assert [f["xa"] for f in fixtures] == pytest.approx([0.2, 0.2])


def test_minutes_and_stats_combine_with_no_clean_sheet_for_short_appearance(data):
    result = api_module.forecast_for(options(
        minutes_schedule={"1": {"7": {"conditional_minutes": 59, "availability": 1}}},
        stat_schedule={"1": {"7": {"xg": 0.5, "clean_sheet_probability": 1}}},
    ), dataset=data)
    week = forecast(result, 1, 7)
    assert week["xmins"] == 118
    assert week["p60"] == 0
    assert week["components"]["clean_sheet"] == 0
    assert week["components"]["goals"] == pytest.approx(3)
    assert "minutes_scenario" in week and "stat_scenario" in week


def test_blanks_and_zero_appearance_remain_zero(data):
    result = api_module.forecast_for(options(stat_schedule={
        "2": {"8": {"expected_points": 10, "xg": 2}},
        "1": {"6": {"xg": 0, "xa": 0, "clean_sheet_probability": 1, "expected_points": 0}},
    }), dataset=data)
    blank = forecast(result, 2, 8)
    assert blank["points"] == blank["xmins"] == 0
    assert blank["fixtures"] == []
    assert blank["stat_scenario"]["blank_gameweek"] is True
    assert forecast(result, 1, 6)["points"] == 0
    with pytest.raises(HTTPException, match="zero appearance"):
        api_module.forecast_for(options(stat_schedule={"1": {"6": {"xg": 1}}}), dataset=data)


@pytest.mark.parametrize("schedule", [
    {"999": {"6": {"xg": 1}}}, {"02": {"6": {"xg": 1}}},
    {"2": {"5": {"xa": 1}}}, {"2": {"39": {"xa": 1}}},
    {"2": {"06": {"xg": 1}}}, {"2": {"6": {}}},
    {"2": {"6": {"xg": float("nan")}}}, {"2": {"6": {"xa": float("inf")}}},
    {"2": {"6": {"clean_sheet_probability": 1.1}}}, {"2": {"6": {"xg": -0.1}}},
    {"2": {"6": {"xa": 10.1}}}, {"2": {"6": {"expected_points": 60.1}}},
    {"2": {"6": {"xg": True}}}, {"2": {"6": {"foo": 1}}},
])
def test_invalid_direct_stat_schedule_rejected(data, schedule):
    with pytest.raises(ValueError):
        canonical_stat_schedule(schedule, data["players"], range(6, 39))


@pytest.mark.parametrize("fields", [{}, {"xg": True}, {"xg": "0.5"}, {"xg": -1}, {"unknown": 1}])
def test_invalid_http_fields_rejected_before_forecasting(data, fields):
    response = TestClient(api_module.app).post("/api/projections", json={"stat_schedule": {"2": {"6": fields}}})
    assert response.status_code == 422


def test_http_nonfinite_rejected(data):
    response = TestClient(api_module.app).post(
        "/api/projections", content='{"stat_schedule":{"2":{"6":{"xg":NaN}}}}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422


def test_scenario_detail_and_csv_use_edited_forecasts(data, monkeypatch):
    monkeypatch.setattr(api_module, "player_history", lambda _: [])
    client = TestClient(api_module.app)
    body = {"use_market": False, "use_provider": False, "stat_schedule": {"2": {"7": {"expected_points": 12}}}}
    response = client.post("/api/players/2?gw=7", json=body)
    assert response.status_code == 200
    assert response.json()["player"]["gw"]["7"]["points"] == pytest.approx(12)
    assert response.json()["simulation"]["mean"] == pytest.approx(12, abs=0.2)
    assert "User-scenario" in response.json()["simulation"]["label"]
    exported = client.post("/api/export/projections.csv", json=body)
    assert exported.status_code == 200
    assert "User-assumed player stats scenario" in exported.text


def test_snapshot_retains_stat_configuration_targets_and_exploratory_label(tmp_path, monkeypatch):
    dataset = capture_dataset(stamp="stats capture", vendor_points=7)
    dataset["bootstrap"]["events"].append({
        "id": 7, "deadline_time": (NOW + timedelta(days=7)).isoformat(), "finished": False,
    })
    monkeypatch.setattr(api_module, "ROOT", tmp_path)
    monkeypatch.setattr(api_module, "get_data", lambda **_: dataset)
    monkeypatch.setattr(model, "_projections", None)
    monkeypatch.setattr(model, "_projection_key", None)
    capture_clock(monkeypatch, NOW, NOW + timedelta(seconds=1), NOW + timedelta(seconds=2))
    request = api_module.ForecastRequest(use_market=False, stat_schedule={"2": {"7": {"expected_points": 12}}})
    saved = api_module.save_snapshot(request)
    record = read_snapshot(tmp_path / "data" / "snapshots" / saved["filename"])
    assert record["configuration"]["stat_schedule"]["2"]["7"]["expected_points"] == 12
    future = record["future_targets"]["7"]
    player = next(p for p in future["players"] if p["id"] == 2)
    assert player["models"]["Live ensemble"] == pytest.approx(12)
    assert player["stat_scenario"]["expected_points"] == 12
    assert player["models"]["Component model"] != 12
    assert future["capture_receipt"]["eligible_primary"]["Live ensemble"] is False
    assert any("User-assumed" in r for r in future["capture_receipt"]["eligibility_reasons"]["Live ensemble"])
    assert record["capture_receipt"]["eligible_primary"]["Live ensemble"] is True

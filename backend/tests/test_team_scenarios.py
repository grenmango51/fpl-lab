"""Team assumptions preserve sourced forecasts and change both fixture sides."""

from copy import deepcopy
import csv
import io
import json
import math

import pytest
from fastapi.testclient import TestClient

from backend import app as api, model
from backend.team_scenarios import apply_team_strengths, canonical_team_strengths
from backend.tests.test_minutes_schedule import synthetic_data, forecast
from backend.tests.test_capture import NOW, capture_clock, capture_dataset
from backend.capture import read_snapshot


@pytest.fixture
def data(monkeypatch):
    value = synthetic_data()
    for tid in (3, 4):
        value["teams"][tid] = {"id": tid, "short_name": f"T{tid}", "name": f"Team {tid}", "code": tid}
        value["players"][tid] = {**value["players"][2], "id": tid, "code": 1000 + tid, "team": tid}
        value["history"] += [{**r, "code": 1000 + tid, "team": f"T{tid}"}
                             for r in list(value["history"]) if r["code"] == 1002]
    value["players"][5] = {**value["players"][2], "id": 5, "code": 1005, "team": 1}
    value["history"] += [{**r, "code": 1005, "team": "AAA"}
                         for r in list(value["history"]) if r["code"] == 1002]
    value["fixtures"] += [{**value["fixtures"][0], "id": 100, "team_h": 3, "team_a": 4},
                          {**value["fixtures"][0], "id": 101, "event": 7, "team_h": 3, "team_a": 4}]
    # Codes deliberately differ from current official numeric IDs.
    for team in value["teams"].values():
        team["code"] += 100
    value["fplform"] = {"source_at": "provider timestamp", "players": {
        "2": {"points": {"6": 8, "7": 12}, "probabilities": {"6": 0.7}}}}
    monkeypatch.setattr(api, "get_data", lambda: value)
    monkeypatch.setattr(model, "_projections", None)
    monkeypatch.setattr(model, "_projection_key", None)
    return value


def request(**fields):
    return api.ForecastRequest(use_market=False, **fields)


def test_propagates_teammates_opponents_all_weeks_and_preserves_inputs(data):
    baseline = api.forecast_for(request(), dataset=data)
    frozen = deepcopy(baseline)
    changed = apply_team_strengths(baseline, {"101": {"attack": 1.5, "defence": 2}}, data)
    assert baseline == frozen
    for pid in (1, 2, 5):
        for gw in (6, 7, 9, 11):
            a, b = forecast(baseline, pid, gw), forecast(changed, pid, gw)
            for old, new in zip(a["fixtures"], b["fixtures"]):
                factor = 0.5 if pid == 2 else 1.5
                hazard = 1.5 if pid == 2 else 0.5
                assert new["team_goals"] == pytest.approx(old["team_goals"] * factor)
                assert new["conceded"] == pytest.approx(old["conceded"] * hazard)
                assert new["xg"] == pytest.approx(old["xg"] * factor)
                assert new["xa"] == pytest.approx(old["xa"] * factor)
                assert new["cs"] == pytest.approx(old["cs"] ** hazard)
                assert new["source"] == old["source"]
                assert new["source_at"] == old["source_at"]
                assert new["team_strength_scenario"]["base"]["components"] == old["components"]
                assert new["points"] == pytest.approx(sum(new["components"].values()))
            assert b["points"] == pytest.approx(sum(b["components"].values()))
            assert b["points"] == pytest.approx(sum(f["points"] for f in b["fixtures"]))
            for residual in ("provider_adjustment",):
                assert b["components"].get(residual, 0) == a["components"].get(residual, 0)
        assert forecast(changed, pid, 8) is forecast(baseline, pid, 8)
    for pid in (3, 4):
        assert next(p for p in changed["players"] if p["id"] == pid) is next(p for p in baseline["players"] if p["id"] == pid)
    assert forecast(changed, 1)["points"] == 0  # unavailable player stays unavailable


def test_identity_reset_and_two_sided_factors(data):
    baseline = api.forecast_for(request(), dataset=data)
    assert apply_team_strengths(baseline, {}, data) is baseline
    assert apply_team_strengths(baseline, {"101": {"attack": 1, "defence": 1}}, data) is baseline
    altered = api.forecast_for(request(team_strengths={"101": {"attack": 2}, "102": {"defence": 2}}), dataset=data)
    # Cancelling factors leave each fixture exactly unchanged.
    assert forecast(altered, 5) == forecast(baseline, 5)
    assert api.forecast_for(request(team_strengths={}), dataset=data) == baseline


@pytest.mark.parametrize("values", [
    {"1": {"attack": 1.1}}, {"0101": {"attack": 1.1}}, {101: {"attack": 1.1}},
    {"999": {}}, {"101": {"attack": True}}, {"101": {"attack": "1"}},
    {"101": {"attack": math.nan}}, {"101": {"defence": math.inf}},
    {"101": {"attack": 0.49}}, {"101": {"defence": 2.01}},
    {"101": {"attak": 1}}, {str(i): {} for i in range(21)},
])
def test_strict_validation(data, values):
    with pytest.raises(ValueError):
        canonical_team_strengths(values, data["teams"].values())


@pytest.mark.parametrize("values", [
    {"1": {"attack": 1.1}}, {"0101": {}}, {"101": {"attack": True}},
    {"101": {"defence": "1.5"}}, {"101": {"defence": None}}, {"101": {"foo": 1}},
])
def test_http_validation(data, values):
    response = TestClient(api.app).post("/api/projections", json={"team_strengths": values})
    assert response.status_code == 422


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_http_nonfinite_values_are_safe_422(data, literal):
    response = TestClient(api.app).post(
        "/api/projections",
        content='{"team_strengths":{"101":{"attack":' + literal + '}}}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422


@pytest.mark.parametrize("duration", [0, 25, 59, 60, 90])
def test_manual_duration_deductions_use_correct_state(data, duration):
    args = {"minutes_schedule": {"1": {"7": {"conditional_minutes": duration, "availability": 0.6}}}}
    base = api.forecast_for(request(**args), dataset=data)
    changed = api.forecast_for(request(**args, team_strengths={"101": {"defence": 2}}), dataset=data)
    for old, new in zip(forecast(base, 1, 7)["fixtures"], forecast(changed, 1, 7)["fixtures"]):
        def pairs(lam):
            return lam / 2 - (1 - math.exp(-2 * lam)) / 4
        expected = (pairs(old["conceded"] * duration / 90) - pairs(new["conceded"] * duration / 90)) * (0.6 if duration else 0)
        assert new["components"]["deductions"] - old["components"]["deductions"] == pytest.approx(expected)
        assert new["p60"] == old["p60"]
        assert new["xmins"] == old["xmins"]


def test_probabilities_boundaries_and_exact_minutes_state_deductions(data):
    # Mixed short/long duration history ensures mean-duration shortcuts fail.
    for row in data["history"]:
        if row["code"] == 1001:
            row["minutes"] = 25 if row["fixture"] % 2 else 85
    options = request(minutes_schedule={"1": {"7": {"availability": 1}}}, use_provider=False)
    base = api.forecast_for(options, dataset=data)
    for i, fixture in enumerate(forecast(base, 1, 7)["fixtures"]):
        fixture["cs"] = i  # 0 and 1 stay exact under finite hazard factors
    changed = apply_team_strengths(base, {"101": {"defence": 2}}, data)
    means = model.appearance_profile([r for r in data["history"] if r["code"] == 1001 and r["season"] == data["season"]])
    pairs = lambda lam: lam / 2 - (1 - math.exp(-2 * lam)) / 4
    for old, new in zip(forecast(base, 1, 7)["fixtures"], forecast(changed, 1, 7)["fixtures"]):
        def loss(f):
            return pairs(f["conceded"] * means["long_mean"] / 90) * f["p60"] + pairs(f["conceded"] * means["short_mean"] / 90) * (f["pplay"] - f["p60"])
        assert new["components"]["deductions"] - old["components"]["deductions"] == pytest.approx(loss(old) - loss(new))
        assert new["cs"] == old["cs"]


@pytest.mark.parametrize("duration", [0, 25, 59, 60, 90])
@pytest.mark.parametrize("availability_only", [False, True])
def test_legacy_duration_survives_team_deltas_and_availability_only_schedule(data, duration, availability_only):
    data["players"][1]["chance_of_playing_next_round"] = 80
    args = {"overrides": {"1": duration}}
    availability = 0.8
    if availability_only:
        args["minutes_schedule"] = {"1": {"7": {"availability": 0.6}}}
        availability = 0.6
    base = api.forecast_for(request(**args), dataset=data)
    frozen = deepcopy(base)
    changed = api.forecast_for(request(**args, team_strengths={"101": {"defence": 2}}), dataset=data)
    week = forecast(base, 1, 7)
    assert week["minutes_scenario"]["conditional_minutes"] == duration
    pairs = lambda lam: lam / 2 - (1 - math.exp(-2 * lam)) / 4
    for old, new in zip(week["fixtures"], forecast(changed, 1, 7)["fixtures"]):
        expected = availability * (
            pairs(old["conceded"] * duration / 90)
            - pairs(new["conceded"] * duration / 90)
        )
        assert new["components"]["deductions"] - old["components"]["deductions"] == pytest.approx(expected)
        assert new["pplay"] == old["pplay"] == (availability if duration else 0)
        assert new["p60"] == old["p60"] == (availability if duration >= 60 else 0)
        assert new["xmins"] == old["xmins"] == availability * duration
    assert base == frozen


def test_provider_probability_does_not_replace_fixture_component_states(data):
    data["players"][2]["element_type"] = 2
    for row in data["history"]:
        if row["code"] == 1002:
            row["position"] = 2
            row["minutes"] = 25 if row["fixture"] % 2 else 85
    base = api.forecast_for(request(), dataset=data)
    changed = api.forecast_for(request(team_strengths={"101": {"attack": 2}}), dataset=data)
    old_week, new_week = forecast(base, 2, 6), forecast(changed, 2, 6)
    old, new = old_week["fixtures"][0], new_week["fixtures"][0]
    assert old_week["pplay"] != pytest.approx(old["pplay"])
    means = model.appearance_profile([
        r for r in data["history"] if r["code"] == 1002 and r["season"] == data["season"]
    ])
    pairs = lambda lam: lam / 2 - (1 - math.exp(-2 * lam)) / 4
    def loss(f):
        return (pairs(f["conceded"] * means["long_mean"] / 90) * old["p60"]
                + pairs(f["conceded"] * means["short_mean"] / 90) * (old["pplay"] - old["p60"]))
    assert new["components"]["deductions"] - old["components"]["deductions"] == pytest.approx(loss(old) - loss(new))
    assert new_week["pplay"] == old_week["pplay"]
    assert new_week["xmins"] == old_week["xmins"]
    assert new["p60"] == old["p60"]
    assert new_week["components"]["provider_adjustment"] == old_week["components"]["provider_adjustment"]


def test_custom_scoring_and_individual_stats_take_precedence(data):
    scoring = deepcopy(model.DEFAULT_SCORING)
    scoring["goals_scored"]["MID"], scoring["assists"] = 9, 7
    data["bootstrap"]["game_config"] = {"scoring": scoring}
    args = {"team_strengths": {"101": {"attack": 2}}}
    baseline = api.forecast_for(request(), dataset=data)
    changed = api.forecast_for(request(**args), dataset=data)
    old, new = forecast(baseline, 5, 7), forecast(changed, 5, 7)
    assert new["components"]["goals"] == pytest.approx(old["components"]["goals"] * 2)
    assert new["components"]["assists"] == pytest.approx(old["components"]["assists"] * 2)
    explicit = api.forecast_for(request(**args, stat_schedule={"5": {"7": {"xg": 0.3, "expected_points": 15}}}), dataset=data)
    week = forecast(explicit, 5, 7)
    assert sum(f["xg"] for f in week["fixtures"]) == pytest.approx(0.3)
    assert week["points"] == pytest.approx(15)
    assert week["team_strength_scenario"]["points_delta"] == new["team_strength_scenario"]["points_delta"]


def test_untouched_fixture_in_mixed_double_is_identical(data):
    data["fixtures"].append({**data["fixtures"][0], "id": 102, "event": 7, "team_h": 2, "team_a": 3})
    base = api.forecast_for(request(), dataset=data)
    changed = api.forecast_for(request(team_strengths={"101": {"attack": 1.2}}), dataset=data)
    assert forecast(changed, 2, 7)["fixtures"][-1] == forecast(base, 2, 7)["fixtures"][-1]


def test_request_paths_inherit_frozen_configuration(data, monkeypatch):
    body = {"team_strengths": {"101": {"attack": 1.2}}, "use_market": False}
    for cls in (api.ForecastRequest, api.SolveRequest, api.PlanRequest, api.SensitivityRequest, api.ChipStrategyRequest):
        assert "team_strengths" in cls.model_fields
    monkeypatch.setattr(api, "player_history", lambda _: [])
    client = TestClient(api.app)
    result = client.post("/api/players/5?gw=7", json=body)
    assert result.status_code == 200
    assert result.json()["player"]["gw"]["7"]["team_strength_scenario"]["source"] == "user-assumed"
    result = client.post("/api/export/projections.csv", json=body)
    assert result.status_code == 200
    assert "HUMAN team-strength assumption" in result.text
    exported = list(csv.DictReader(io.StringIO(result.text.lstrip("\ufeff"))))
    changed_row = next(row for row in exported if row["player_id"] == "5" and row["gameweek"] == "7")
    scenario = json.loads(changed_row["scenario"])["team_strength_scenario"]
    assert scenario["adjustments"] == {"101": {"attack": 1.2, "defence": 1}}
    assert scenario["adjusted_at"]
    blank_row = next(row for row in exported if row["player_id"] == "5" and row["gameweek"] == "8")
    assert "team_strength_scenario" not in json.loads(blank_row["scenario"])
    schema = api.app.openapi()
    for route in ("/api/optimise", "/api/lineup", "/api/sensitivity", "/api/chip-strategy", "/api/plan/validate", "/api/chips/recommend", "/api/players/{player_id}", "/api/export/projections.csv"):
        # Every registered endpoint's request type contains the scenario field.
        reference = schema["paths"][route]["post"]["requestBody"]["content"]["application/json"]["schema"]["$ref"].split("/")[-1]
        assert "team_strengths" in schema["components"]["schemas"][reference]["properties"]


def test_snapshot_receipt_marks_only_affected_targets(data):
    payload = api.forecast_for(request(team_strengths={"101": {"attack": 1.2}}), dataset=data)
    receipt = {"eligible_primary": {"Live ensemble": True}, "eligibility_reasons": {"Live ensemble": []}}
    api.mark_team_scenario_receipt(receipt, payload, 7)
    assert receipt["eligible_primary"]["Live ensemble"] is False
    receipt = {"eligible_primary": {"Live ensemble": True}, "eligibility_reasons": {"Live ensemble": []}}
    api.mark_team_scenario_receipt(receipt, payload, 8)
    assert receipt["eligible_primary"]["Live ensemble"] is True


def test_snapshot_freezes_strengths_and_separate_component_baseline(tmp_path, monkeypatch):
    from datetime import timedelta

    dataset = capture_dataset(stamp="team strengths capture", vendor_points=7)
    dataset["bootstrap"]["events"].append({
        "id": 7, "deadline_time": (NOW + timedelta(days=7)).isoformat(), "finished": False,
    })
    monkeypatch.setattr(api, "ROOT", tmp_path)
    monkeypatch.setattr(api, "get_data", lambda **_: dataset)
    monkeypatch.setattr(model, "_projections", None)
    monkeypatch.setattr(model, "_projection_key", None)
    capture_clock(monkeypatch, NOW, NOW + timedelta(seconds=1), NOW + timedelta(seconds=2))
    saved = api.save_snapshot(request(team_strengths={"1": {"attack": 1.2}}))
    record = read_snapshot(tmp_path / "data" / "snapshots" / saved["filename"])
    assert record["configuration"]["team_strengths"]["1"] == {"attack": 1.2, "defence": 1}
    assert record["capture_receipt"]["eligible_primary"]["Live ensemble"] is False
    future = record["future_targets"]["7"]
    assert future["capture_receipt"]["eligible_primary"]["Live ensemble"] is False
    player = next(p for p in future["players"] if p["id"] == 2)
    assert player["team_strength_scenario"]["source"] == "user-assumed"
    assert player["models"]["Live ensemble"] != player["models"]["Component model"]

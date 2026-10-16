"""Schedule membership, frozen calibration, original-source context and receipts."""

from copy import deepcopy
from datetime import timedelta
import csv
import hashlib
import io
import json
import math

import pytest
from fastapi.testclient import TestClient

from backend import app as api, model
from backend.capture import read_snapshot
from backend.fixture_scenarios import apply_fixture_moves, canonical_fixture_moves
from backend.tests.test_minutes_schedule import synthetic_data, forecast
from backend.tests.test_capture import NOW, capture_clock, capture_dataset


@pytest.fixture
def data(monkeypatch):
    value = synthetic_data()
    value["players"][1]["chance_of_playing_next_round"] = 100
    for tid in (3, 4):
        value["teams"][tid] = {"id": tid, "code": tid + 100,
                               "short_name": f"T{tid}", "name": f"Team {tid}"}
        value["players"][tid] = {**value["players"][2], "id": tid,
                                 "code": 1000 + tid, "team": tid}
        value["history"] += [{**r, "code": 1000 + tid, "team": f"T{tid}"}
                             for r in list(value["history"]) if r["code"] == 1002]
    value["fixtures"].append({**value["fixtures"][0], "id": 100, "team_h": 3, "team_a": 4})
    value["fplform"] = {"source_at": "original provider time", "players": {
        str(pid): {"points": {"6": 10, "7": 12}, "probabilities": {"6": 0.4}}
        for pid in value["players"]}}
    monkeypatch.setattr(api, "get_data", lambda **_: value)
    monkeypatch.setattr(model, "_projections", None)
    monkeypatch.setattr(model, "_projection_key", None)
    return value


def req(**fields):
    return api.ForecastRequest(use_market=False, **fields)


def test_identity_reset_and_immutable_original_cache(data):
    base = api.forecast_for(req(), dataset=data)
    saved, original = deepcopy(base), deepcopy(data)
    cache, key = model._projections, model._projection_key
    assert apply_fixture_moves(base, {}, data, {}, False, {}) is base
    assert apply_fixture_moves(base, {"10": 6}, data, {}, False, {}) is base
    identity = api.forecast_for(req(fixture_moves={"10": 6}), dataset=data)
    assert identity == base
    changed = api.forecast_for(req(fixture_moves={"10": 7}), dataset=data)
    assert changed != base
    assert data == original and base == saved
    assert model._projections is cache and model._projection_key == key
    assert api.forecast_for(req(), dataset=data) == base


def test_both_clubs_blank_triple_and_all_other_weeks_exact(data):
    base = api.forecast_for(req(), dataset=data)
    changed = api.forecast_for(req(fixture_moves={"10": 7}), dataset=data)
    for pid in (1, 2):
        assert forecast(changed, pid, 6)["points"] == 0
        assert forecast(changed, pid, 6)["fixtures"] == []
        triple = forecast(changed, pid, 7)
        assert {f["id"] for f in triple["fixtures"]} == {10, 11, 12}
        assert triple["points"] == pytest.approx(sum(f["points"] for f in triple["fixtures"]))
        assert triple["points"] == pytest.approx(sum(triple["components"].values()))
        assert triple["xmins"] == pytest.approx(sum(f["xmins"] for f in triple["fixtures"]))
        assert triple["pplay"] == pytest.approx(1 - math.prod(1-f["pplay"] for f in triple["fixtures"]))
        assert "provider_adjustment" not in triple["components"]
        for gw in range(8, 39):
            assert forecast(changed, pid, gw) == forecast(base, pid, gw)
    for pid in (3, 4):
        assert next(p for p in changed["players"] if p["id"] == pid) == next(p for p in base["players"] if p["id"] == pid)
    for schedule in changed["fixture_schedule"]:
        if schedule["event"] is None or schedule["finished"]:
            continue
        for pid in (schedule["team_h"], schedule["team_a"]):
            assert schedule["id"] in {f["id"] for f in forecast(changed, pid, schedule["event"])["fixtures"]}


def test_unset_removes_and_unset_origin_uses_fallback_not_destination_sheet(data):
    removed = api.forecast_for(req(fixture_moves={"10": None}), dataset=data)
    assert forecast(removed, 2, 6)["fixtures"] == []
    row = next(f for f in removed["fixture_schedule"] if f["id"] == 10)
    assert row["event"] is None and row["original_event"] == 6
    assert row["kickoff_time"] is None and row["original_kickoff"]
    data["fixtures"][0]["event"] = None
    data["elevenify"] = {"source_at": "sheet", "goals": {"AAA": {8: 7}, "BBB": {8: 6}},
                         "clean_sheets": {"AAA": {8: 0.1}, "BBB": {8: 0.2}}}
    moved = api.forecast_for(api.ForecastRequest(fixture_moves={"10": 8}), dataset=data)
    fixture = forecast(moved, 2, 8)["fixtures"][0]
    assert "historical fallback" in fixture["source"]
    assert fixture["source_event"] is None and fixture["target_event"] == 8
    assert fixture["kickoff"] is None


@pytest.mark.parametrize("moves", [
    {"010": 7}, {10: 7}, {"9999": 7}, {"10": True}, {"10": "7"},
    {"10": 7.0}, {"10": 5}, {"10": 39}, {"10": []}, [],
])
def test_strict_validation(data, moves):
    with pytest.raises(ValueError):
        canonical_fixture_moves(moves, data)


@pytest.mark.parametrize("update", [
    {"finished": True}, {"finished_provisional": True}, {"event": 5},
])
def test_reject_finished_and_past_even_identity(data, update):
    data["fixtures"][0].update(update)
    with pytest.raises(ValueError):
        canonical_fixture_moves({"10": data["fixtures"][0]["event"]}, data)


def test_reject_completed_event_origin_or_destination(data):
    data["bootstrap"]["events"] = [{"id": 7, "finished": True}]
    with pytest.raises(ValueError):
        canonical_fixture_moves({"10": 7}, data)
    with pytest.raises(ValueError):
        canonical_fixture_moves({"11": 8}, data)


@pytest.mark.parametrize("moves", [{"10": True}, {"10": "7"}, {"10": 7.0}, {"10": 5}, {"010": 7}, {"9999": None}])
def test_http_reject_invalid(data, moves):
    assert TestClient(api.app).post("/api/projections", json={"fixture_moves": moves}).status_code == 422


def test_destination_minutes_stat_and_strength_phase_order(data):
    fields = {"fixture_moves": {"10": 8}, "minutes_schedule": {
        "2": {"6": {"conditional_minutes": 90}, "8": {"conditional_minutes": 25, "availability": 0.5}}}}
    base = api.forecast_for(req(**fields), dataset=data)
    week = forecast(base, 2, 8)
    assert week["xmins"] == 12.5 and week["p60"] == 0 and week["pplay"] == 0.5
    strength = api.forecast_for(req(**fields, team_strengths={"2": {"attack": 1.5}}), dataset=data)
    assert forecast(strength, 2, 8)["fixtures"][0]["xg"] == pytest.approx(week["fixtures"][0]["xg"] * 1.5)
    changed = api.forecast_for(req(**fields, team_strengths={"2": {"attack": 1.5}},
        stat_schedule={"2": {"8": {"xg": 0.7, "expected_points": 9}}}), dataset=data)
    item = forecast(changed, 2, 8)
    assert item["points"] == 9 and item["fixtures"][0]["xg"] == 0.7
    assert item["xmins"] == 12.5
    assert item["fixture_scenario"] and item["team_strength_scenario"] and item["stat_scenario"]


def test_custom_csv_anchor_and_extrapolation_remain_identical_elsewhere(data):
    fields = {"custom_points": {"2": {"6": 15, "7": 20}}, "blend_weight": 1,
              "custom_name": "CSV test", "provider_weight": 0.8}
    base = api.forecast_for(req(**fields), dataset=data)
    changed = api.forecast_for(req(**fields, fixture_moves={"10": 8}), dataset=data)
    for gw in range(6, 39):
        if gw not in (6, 8):
            assert forecast(changed, 2, gw) == forecast(base, 2, gw)
    assert forecast(changed, 2, 9)["prediction_source"]["ratio"] == forecast(base, 2, 9)["prediction_source"]["ratio"]
    assert "imported_adjustment" not in forecast(changed, 2, 8)["components"]
    assert forecast(changed, 2, 6)["fixture_scenario"]["base_prediction_source"]["name"] == "CSV test"


def test_provider_probability_anchor_bypassed_when_existing_single_becomes_double(data):
    base = api.forecast_for(req(), dataset=data)
    moved = api.forecast_for(req(fixture_moves={"11": 6}), dataset=data)
    raw = model.projections({}, False, dataset=data)
    assert forecast(base, 2, 6)["pplay"] < forecast(raw, 2, 6)["pplay"]
    week = forecast(moved, 2, 6)
    assert week["pplay"] == pytest.approx(1 - math.prod(1-f["pplay"] for f in week["fixtures"]))
    assert week["xmins"] == sum(f["xmins"] for f in week["fixtures"])
    assert "provider_adjustment" not in week["components"]
    assert forecast(moved, 2, 9) == forecast(base, 2, 9)


def test_original_single_fixture_sheet_context_preserved_not_new_opponent_aggregate(data):
    # Destination has different opposing clubs: original GW aggregates must
    # never be reassigned as though they describe that new mixed schedule.
    data["fixtures"].append({**data["fixtures"][0], "id": 101, "event": 8, "team_a": 3})
    data["elevenify"] = {"source_at": "original sheet timestamp",
        "goals": {"AAA": {6: 2.7, 8: 5.5}, "BBB": {6: 0.8, 8: 6.5}, "T3": {8: 1.3}},
        "clean_sheets": {"AAA": {6: 0.4, 8: 0.2}, "BBB": {6: 0.1, 8: 0.3}, "T3": {8: 0.1}}}
    base = api.forecast_for(api.ForecastRequest(), dataset=data)
    moved = api.forecast_for(api.ForecastRequest(fixture_moves={"10": 8}), dataset=data)
    fixtures = {f["id"]: f for f in forecast(moved, 1, 8)["fixtures"]}
    assert fixtures[10]["team_goals"] == 2.7 and fixtures[10]["conceded"] == 0.8
    assert fixtures[10]["source_event"] == 6 and fixtures[10]["source_at"] == "original sheet timestamp"
    assert fixtures[101]["team_goals"] == forecast(base, 1, 8)["fixtures"][0]["team_goals"] == 5.5
    assert fixtures[101]["opponent_id"] == 3 and fixtures[10]["opponent_id"] == 2
    assert fixtures[10]["home"] is True and fixtures[10]["kickoff"] is None


def test_original_double_aggregate_never_becomes_single_fixture_source(data):
    data["elevenify"] = {"source_at": "sheet", "goals": {"AAA": {7: 8}, "BBB": {7: 7}},
                         "clean_sheets": {"AAA": {7: 0.4}, "BBB": {7: 0.2}}}
    moved = api.forecast_for(api.ForecastRequest(fixture_moves={"11": 8}), dataset=data)
    assert "historical fallback" in forecast(moved, 1, 7)["fixtures"][0]["source"]
    assert "historical fallback" in forecast(moved, 1, 8)["fixtures"][0]["source"]


def test_joe_original_fixture_context_survives_move(data):
    data["sources"] = {}
    data["joe"] = {"projectionsByPeriod": {"6": {"fixtures": [{
        "homeTeamCode": "AAA", "awayTeamCode": "BBB", "lambdaHome": 3.2,
        "lambdaAway": 0.7, "pHomeCs": 0.6, "pAwayCs": 0.1, "snapshotTsUtc": "joe original"}]}}}
    moved = api.forecast_for(api.ForecastRequest(fixture_moves={"10": 38}), dataset=data)
    fixture = forecast(moved, 1, 38)["fixtures"][0]
    assert fixture["team_goals"] == 3.2 and fixture["source_at"] == "joe original"
    assert fixture["source_event"] == 6 and fixture["target_event"] == 38


def test_inherited_requests_detail_csv_and_receipts(data, monkeypatch):
    for cls in (api.ForecastRequest, api.SolveRequest, api.PlanRequest, api.SensitivityRequest, api.ChipStrategyRequest):
        assert "fixture_moves" in cls.model_fields
    schema = api.app.openapi()
    for route in ("/api/optimise", "/api/lineup", "/api/sensitivity", "/api/chip-strategy", "/api/plan/validate", "/api/chips/recommend", "/api/players/{player_id}", "/api/export/projections.csv"):
        ref = schema["paths"][route]["post"]["requestBody"]["content"]["application/json"]["schema"]["$ref"].split("/")[-1]
        assert "fixture_moves" in schema["components"]["schemas"][ref]["properties"]
    body = {"fixture_moves": {"10": 8}, "use_market": False}
    monkeypatch.setattr(api, "player_history", lambda _: [])
    client = TestClient(api.app)
    result = client.post("/api/players/2?gw=8", json=body)
    assert result.status_code == 200
    assert result.json()["player"]["gw"]["8"]["fixture_scenario"]["moves"][0]["source_event"] == 6
    result = client.post("/api/export/projections.csv", json=body)
    rows = list(csv.DictReader(io.StringIO(result.text.lstrip("\ufeff"))))
    for gw in (6, 8):
        row = next(r for r in rows if r["player_id"] == "2" and r["gameweek"] == str(gw))
        assert json.loads(row["scenario"])["fixture_scenario"]["anchors_bypassed"]
    payload = api.forecast_for(req(fixture_moves={"10": 8}), dataset=data)
    for gw in (6, 7, 8):
        receipt = {"eligible_primary": {"Live ensemble": True}, "eligibility_reasons": {"Live ensemble": []}}
        api.mark_team_scenario_receipt(receipt, payload, gw)
        assert receipt["eligible_primary"]["Live ensemble"] is (gw == 7)


def test_snapshot_source_event_scenario_membership_config_hash_and_unset(tmp_path, monkeypatch):
    data = capture_dataset(stamp="fixture capture")
    data["bootstrap"]["events"].extend({"id": gw, "finished": False,
        "deadline_time": (NOW + timedelta(days=gw)).isoformat()} for gw in (7, 8))
    original = deepcopy(data)
    monkeypatch.setattr(api, "ROOT", tmp_path)
    monkeypatch.setattr(api, "get_data", lambda **_: data)
    capture_clock(monkeypatch, NOW, NOW + timedelta(seconds=1), NOW + timedelta(seconds=2))
    request = req(fixture_moves={"10": 8, "11": None})
    saved = api.save_snapshot(request)
    record = read_snapshot(tmp_path / "data" / "snapshots" / saved["filename"])
    assert data == original
    assert record["configuration"]["fixture_moves"] == {"10": 8, "11": None}
    assert record["configuration_hash"] == hashlib.sha256(json.dumps(request.model_dump(), sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert record["capture_receipt"]["eligible_primary"]["Live ensemble"] is False
    assert record["players"][1]["component_forecast"]["fixtures"][0]["id"] == 10
    future = record["future_targets"]["8"]
    assert future["capture_receipt"]["eligible_primary"]["Live ensemble"] is False
    assert [f["id"] for f in future["fixtures"]] == [10]
    assert future["fixtures"][0]["source_event"] == 6
    player = next(p for p in future["players"] if p["id"] == 2)
    assert player["fixture_ids"] == [10] and player["fixture_context"][0]["source_event"] == 6
    assert player["fixture_scenario"]["moves"][0]["target_event"] == 8

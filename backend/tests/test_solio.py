from copy import deepcopy
from datetime import datetime, timedelta, timezone
import gzip
import json

import pytest

from backend import solio, model
from backend.app import ForecastRequest, forecast_for
from backend.tests.test_minutes_schedule import synthetic_data

NOW = datetime(2026, 10, 18, 7, tzinfo=timezone.utc)
DEADLINE = "2026-10-23T17:30:00Z"


def inputs():
    data = synthetic_data()
    data["players"][2]["web_name"] = "Pláyer 2"
    data["bootstrap"]["events"] = [{"id": 6, "deadline_time": DEADLINE, "finished": False}]
    report = {"gameweek": 6, "generatedAt": NOW.isoformat(), "deadlineIso": DEADLINE,
              "topProjected": [{"name": "Player 2", "team": "BBB", "position": "MID", "prPoints": 7.25}]}
    return data, report


def parsed(data, report):
    return solio.parse_report(report, data["players"], data["teams"], data["bootstrap"]["events"], now=NOW)


@pytest.fixture
def dataset(monkeypatch):
    data, report = inputs()
    data["solio"] = {**parsed(data, report), "usable": True, "source_at": NOW.isoformat()}
    monkeypatch.setattr(model, "_projections", None)
    monkeypatch.setattr(model, "_projection_key", None)
    return data


def test_exact_join_retains_zero_missing_and_stable_identity():
    data, report = inputs()
    report["topProjected"][0]["prPoints"] = 0
    result = parsed(data, report)
    assert result["players"] == {"2": {"code": 1002, "points": {"6": 0}}}
    assert result["matched_players"] == 1
    assert result["pool_players"] == 2
    assert result["full_planner_connected"] is False
    assert "1" not in result["players"]


def test_conflicts_and_ambiguous_names_are_rejected():
    data, report = inputs()
    report["topCaptains"] = [{**report["topProjected"][0], "prPoints": 8}]
    assert parsed(data, report)["players"] == {}
    assert parsed(data, report)["conflicting_ids"] == [2]
    report.pop("topCaptains")
    data["players"][3] = {**data["players"][2], "id": 3, "code": 1003}
    assert parsed(data, report)["players"] == {}


def test_supplied_gkp_label_matches_official_keeper_position():
    data, report = inputs()
    data["players"][2]["element_type"] = 1
    report["topProjected"][0]["position"] = "GKP"
    assert parsed(data, report)["matched_players"] == 1


@pytest.mark.parametrize("change,status", [
    ({"gameweek": True}, "invalid_gameweek"),
    ({"gameweek": 7}, "invalid_receipt"),
    ({"deadlineIso": "2026-10-24T17:30:00Z"}, "invalid_receipt"),
    ({"generatedAt": (NOW + timedelta(minutes=1)).isoformat()}, "invalid_receipt"),
    ({"generatedAt": (NOW - timedelta(hours=9)).isoformat()}, "old_publication"),
])
def test_report_weeks_times_and_publication_freshness_are_not_invented(change, status):
    data, report = inputs()
    assert parsed(data, {**report, **change})["status"] == status


@pytest.mark.parametrize("value", [True, float("nan"), float("inf"), "7.25"])
def test_non_numeric_points_do_not_enter_forecasts(value):
    data, report = inputs()
    report["topProjected"][0]["prPoints"] = value
    assert parsed(data, report)["players"] == {}


def test_only_supplied_player_week_changes_and_components_reconcile(dataset):
    before = deepcopy(dataset)
    base = forecast_for(ForecastRequest(use_solio=False), dataset=dataset)
    result = forecast_for(ForecastRequest(), dataset=dataset)
    for old, new in zip(base["players"], result["players"]):
        for gw, row in old["gw"].items():
            actual = new["gw"][gw]
            if (new["id"], gw) == (2, "6"):
                assert actual["points"] == 7.25
                assert sum(actual["components"].values()) == pytest.approx(7.25)
                assert actual["xmins"] == row["xmins"]
                assert actual["fixtures"] == row["fixtures"]
                assert actual["prediction_source"]["name"] == solio.NAME
            else:
                assert actual == row
    assert dataset == before
    assert result["solio"]["applied_forecasts"] == 1


def test_human_minutes_stats_and_fixture_scenarios_take_precedence(dataset):
    request = ForecastRequest(minutes_schedule={"2": {"6": {"conditional_minutes": 0}}})
    result = forecast_for(request, dataset=dataset)
    assert result["players"][1]["gw"]["6"]["points"] == 0
    assert result["solio"]["applied_forecasts"] == 0
    result = forecast_for(ForecastRequest(stat_schedule={"2": {"6": {"expected_points": 9}}}), dataset=dataset)
    assert result["players"][1]["gw"]["6"]["points"] == pytest.approx(9)
    moved = ForecastRequest(fixture_moves={"10": 9})
    a = forecast_for(moved, dataset=dataset)
    b = forecast_for(moved.model_copy(update={"use_solio": False}), dataset=dataset)
    for key in ("points", "xmins", "components", "fixtures"):
        assert a["players"][1]["gw"]["6"][key] == b["players"][1]["gw"]["6"][key]


def test_stale_source_and_identity_mismatch_fall_back_to_local_model(dataset):
    base = forecast_for(ForecastRequest(use_solio=False), dataset=dataset)
    dataset["solio"]["usable"] = False
    assert forecast_for(ForecastRequest(), dataset=dataset)["players"] == base["players"]
    dataset["solio"]["usable"] = True
    dataset["solio"]["players"]["2"]["code"] = 123
    assert forecast_for(ForecastRequest(), dataset=dataset)["players"] == base["players"]


def test_capture_keeps_independent_forecast_and_raw_points(dataset, tmp_path, monkeypatch):
    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)
    monkeypatch.setattr(solio, "datetime", FrozenDatetime)
    file = solio.archive_observation(dataset, tmp_path)
    with gzip.open(tmp_path / "data" / "snapshots" / "solio" / file, "rt") as handle:
        record = json.load(handle)
    assert len(record["players"]) == 1
    row = record["players"][0]
    assert row["models"]["Solio"] == 7.25
    assert row["models"]["Open FPL without Solio"] != 7.25
    assert record["configuration"]["use_solio"] is False
    assert solio.source_time(record["recorded_at"]) < solio.source_time(record["deadline"])


def test_post_deadline_observation_cannot_become_a_prospective_capture(dataset, tmp_path):
    dataset["solio"]["deadline"] = "2026-10-01T10:00:00Z"
    assert solio.archive_observation(dataset, tmp_path) is None
    assert not (tmp_path / "data" / "snapshots").exists()

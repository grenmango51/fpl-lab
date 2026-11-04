from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
import subprocess

import pytest

from backend import data, model, solio, solio_browser
from backend.app import ForecastRequest, forecast_for
from backend.tests.test_minutes_schedule import synthetic_data

NOW = datetime(2026, 10, 18, 17, tzinfo=timezone.utc)


@pytest.fixture
def before_deadline(monkeypatch):
    # These synthetic GW6 deadlines must not expire as the real clock advances.
    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)

    monkeypatch.setattr(solio, "datetime", FrozenDatetime)


def inputs():
    dataset = synthetic_data()
    dataset["bootstrap"]["events"] = [
        {"id": gw, "deadline_time": (NOW + timedelta(days=gw)).isoformat(), "finished": False, "is_next": gw == 6}
        for gw in range(6, 39)
    ]
    record = {"captured_at": NOW.isoformat(), "sync_confirmed_at": NOW.isoformat(), "headers": ["Name", "Team", "Price", "Avg", *[f"GW{g}" for g in range(6, 11)]],
              "expected_rows": 1, "rows": [{"index": 0, "cells": ["Player 2", "BBB", "5", "4", "7.25", "0", "0", "5", "6"]}],
              "identity": {"elements": [
                  {"fplId": 1, "fplCode": 1001, "name": "Player 1", "position": "DEF", "teamId": "vendor-a", "purchaseable": False},
                  {"fplId": 2, "fplCode": 1002, "name": "Player 2", "position": "MID", "teamId": "vendor-b", "purchaseable": True}],
                  "teams": [{"id": "vendor-a", "fplCode": 1, "abbreviation": "AAA"}, {"id": "vendor-b", "fplCode": 2, "abbreviation": "BBB"}],
                  "scenario": [{"isBase": True, "homeGoalMultiplier": None}], "overrides": 0}}
    return dataset, record


def parsed(dataset, record):
    return solio.parse_planner(record, dataset["players"], dataset["teams"], dataset["bootstrap"]["events"], now=NOW)


def test_complete_eligible_pool_has_five_real_weeks_without_filling_omitted_players():
    dataset, record = inputs()
    source = parsed(dataset, record)
    assert source["status"] == "planner"
    assert source["matched_players"] == source["eligible_players"] == 1
    assert source["pool_players"] == 2
    assert source["omitted_ids"] == [1]
    assert source["weeks"] == [6, 7, 8, 9, 10]
    assert source["players"]["2"]["points"]["7"] == 0
    assert "1" not in source["players"]
    assert source["generated_at"] is None  # Acquisition is not publication.


def test_new_official_listing_keeps_verified_rows_and_leaves_new_player_missing():
    dataset, record = inputs()
    dataset["players"][3] = {**dataset["players"][2], "id": 3, "code": 1003}
    source = parsed(dataset, record)
    assert source["status"] == "planner"
    assert source["matched_players"] == 1
    assert source["pool_players"] == 3
    assert source["unpurchaseable_players"] == source["unlisted_players"] == 1
    assert source["unlisted_ids"] == [3]
    assert source["omitted_ids"] == [1, 3]
    assert "3" not in source["players"]
    assert len(source["players"]["2"]["points"]) == 5


def test_unknown_provider_identity_still_rejects_the_source():
    dataset, record = inputs()
    record["identity"]["elements"].append({**record["identity"]["elements"][1], "fplId": 3, "fplCode": 1003})
    assert parsed(dataset, record)["status"] == "incomplete_identities"


@pytest.mark.parametrize("active,accepted", [(False, True), (True, False), (None, False), (0, False)])
def test_only_explicitly_deactivated_information_sets_are_ignored(active, accepted):
    dataset, record = inputs()
    record["identity"]["scenario"].append({"name": "Old research branch", "isBase": False, "active": active})
    source = parsed(dataset, record)
    assert source["status"] == ("planner" if accepted else "custom_scenario")
    if accepted:
        record["identity"]["overrides"] = 1
        assert parsed(dataset, record)["status"] == "custom_scenario"


@pytest.mark.parametrize("mutation,status", [
    (lambda r: r["rows"].clear(), "incomplete_rows"),
    (lambda r: r["rows"][0].update(index=1), "incomplete_rows"),
    (lambda r: r["headers"].__setitem__(-1, "GW12"), "invalid_window"),
    (lambda r: r["rows"][0]["cells"].__setitem__(-1, ""), "invalid_cells"),
    (lambda r: r["rows"][0]["cells"].__setitem__(-1, "nan"), "invalid_cells"),
    (lambda r: r["identity"]["elements"][1].update(fplCode=999), "invalid_identity"),
    (lambda r: r["identity"]["teams"][1].update(fplCode=999), "invalid_identity"),
    (lambda r: r["identity"].update(overrides=1), "custom_scenario"),
    (lambda r: r["identity"]["scenario"][0].update(homeGoalMultiplier=1.2), "custom_scenario"),
    (lambda r: r.update(captured_at=(NOW + timedelta(seconds=1)).isoformat()), "old_acquisition"),
    (lambda r: r.pop("sync_confirmed_at"), "unconfirmed_sync"),
])
def test_partial_shifted_invalid_or_custom_sources_cannot_replace_forecasts(mutation, status):
    dataset, record = inputs()
    mutation(record)
    source = parsed(dataset, record)
    assert source["status"] == status
    assert source["players"] == {}


def test_five_week_archives_keep_independent_forecasts_and_target_deadlines(tmp_path, monkeypatch, before_deadline):
    dataset, record = inputs()
    dataset["solio"] = {**parsed(dataset, record), "usable": True}
    monkeypatch.setattr(model, "_projections", None)
    monkeypatch.setattr(model, "_projection_key", None)
    filename = solio.archive_observation(dataset, tmp_path)
    with gzip.open(tmp_path / "data" / "snapshots" / "solio" / filename, "rt") as handle:
        archived = json.load(handle)
    assert archived["recorded_at"] == NOW.isoformat()
    assert archived["captured_gameweeks"] == [6, 7, 8, 9, 10]
    assert archived["configuration"]["use_solio"] is False
    assert archived["future_targets"]["10"]["players"][0]["models"]["Solio"] == 6
    assert archived["players"][0]["models"]["Open FPL without Solio"] != 7.25
    assert archived["future_targets"]["10"]["deadline"] == dataset["bootstrap"]["events"][4]["deadline_time"]
    baseline = forecast_for(ForecastRequest(use_solio=False), dataset=dataset)
    applied = forecast_for(ForecastRequest(), dataset=dataset)
    assert applied["players"][0] == baseline["players"][0]
    future = applied["players"][1]["gw"]["11"]
    assert future["prediction_source"]["name"] == "Solio window projection"
    assert future["prediction_source"]["kind"] == "extrapolated"
    assert sum(future["components"].values()) == pytest.approx(future["points"])
    disabled = forecast_for(ForecastRequest(extrapolate=False), dataset=dataset)
    for a, b in zip(baseline["players"], disabled["players"]):
        assert {g: v for g, v in a["gw"].items() if int(g) > 10} == {g: v for g, v in b["gw"].items() if int(g) > 10}


def test_failed_browser_refresh_marks_cached_authentication_stale_without_leaking_errors(tmp_path, monkeypatch):
    cache = tmp_path / "data" / "cache"
    cache.mkdir(parents=True)
    (cache / "solio-browser.json").write_text(json.dumps({"enabled": True, "python": "/python", "cdp_url": "http://localhost:9222"}))
    path = cache / "solio_authenticated.json"
    path.write_text(json.dumps({"fetched_at": datetime.now(timezone.utc).isoformat(), "status": "live", "body": "raw forecast"}))
    def failure(*args, **kwargs):
        raise subprocess.CalledProcessError(1, "private-session-url", stderr="private-token")
    monkeypatch.setattr(solio_browser.subprocess, "run", failure)
    result = solio_browser.load(tmp_path, refresh=True)
    assert result["status"] == "stale"
    assert result["body"] == "raw forecast"
    assert result["error"] == "CalledProcessError"
    assert "private" not in path.read_text()
    assert solio_browser.load(tmp_path)["status"] == "stale"


def test_solio_window_extrapolation_preserves_manual_weeks_and_calibration():
    dataset, record = inputs()
    dataset["solio"] = {**parsed(dataset, record), "usable": True}
    baseline = forecast_for(ForecastRequest(), dataset=dataset)
    changed = forecast_for(ForecastRequest(minutes_schedule={"2": {"6": {"conditional_minutes": 0}}}), dataset=dataset)
    assert changed["players"][1]["gw"]["6"]["points"] == 0
    assert changed["players"][1]["gw"]["11"] == baseline["players"][1]["gw"]["11"]
    future = forecast_for(ForecastRequest(minutes_schedule={"2": {"11": {"conditional_minutes": 0}}}), dataset=dataset)
    assert future["players"][1]["gw"]["11"]["points"] == 0


def test_future_receipt_requires_the_actual_window_source_without_claiming_target_replacement():
    from backend.capture import capture_receipt
    dataset, record = inputs()
    dataset["solio"] = {**parsed(dataset, record), "usable": True,
                        "source_key": "solio_authenticated"}
    # A stale source cannot support a primary future-target result even though
    # the actual target itself has no raw Solio values.
    dataset["sources"] = {key: {"status": "live", "fetched_at": NOW.isoformat()}
                          for key in ("fpl_bootstrap", "fpl_fixtures")}
    dataset["sources"]["solio_authenticated"] = {"status": "stale", "fetched_at": NOW.isoformat()}
    request = ForecastRequest()
    payload = forecast_for(request, dataset=dataset)
    component = model.projections(dataset=dataset)
    receipt = capture_receipt({}, dataset, payload, component, request, NOW, NOW, target_gw=11)
    assert receipt["solio_target_role"] == "earlier-window extrapolation"
    assert "solio_authenticated" in receipt["required_sources"]["Live ensemble"]
    assert not receipt["eligible_primary"]["Live ensemble"]
    assert "Solio" not in receipt["required_sources"]
    assert not any("direct Solio point replacements" in reason for reason in receipt["eligibility_reasons"]["Live ensemble"])


def test_usable_authenticated_source_is_preferred_and_corruption_falls_back(monkeypatch, before_deadline):
    dataset, record = inputs()
    body = json.dumps(record)
    envelope = {"body": body, "sha256": hashlib.sha256(body.encode()).hexdigest(), "status": "live", "fetched_at": record["captured_at"]}
    monkeypatch.setattr(solio_browser, "load", lambda *a, **kw: envelope)
    monkeypatch.setattr(data, "_statuses", {})
    def no_public(*args, **kwargs):
        raise AssertionError("Should prefer complete authenticated data")
    monkeypatch.setattr(data, "fetch", no_public)
    assert solio.load(dataset["players"], dataset["teams"], dataset["bootstrap"]["events"])["status"] == "planner"
    envelope["sha256"] = "corrupted"
    monkeypatch.setattr(data, "fetch", lambda *a, **kw: None)
    source = solio.load(dataset["players"], dataset["teams"], dataset["bootstrap"]["events"])
    assert source["planner_fallback"] == "invalid_hash"
    assert source["usable"] is False

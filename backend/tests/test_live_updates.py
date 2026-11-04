from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from backend import live_updates as updates


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(updates, "ROOT", tmp_path)
    return tmp_path


def test_interval_persists_and_survives_restarts_and_can_be_disabled(root):
    now = datetime(2026, 10, 18, 6, tzinfo=timezone.utc)
    updates.configure(updates.RefreshConfiguration(interval_minutes=30))
    updates.write("auto-refresh-status.json", {"last_attempt_at": now.isoformat()})
    assert not updates.due(now + timedelta(minutes=29, seconds=59))
    assert updates.due(now + timedelta(minutes=30))
    updates.configure(updates.RefreshConfiguration(interval_minutes=60))
    assert not updates.due(now + timedelta(minutes=30))
    updates.configure(updates.RefreshConfiguration(enabled=False))
    assert not updates.due(now + timedelta(days=1))


@pytest.mark.parametrize("value", [0, 4, 1441, True, 30.5, "30"])
def test_invalid_intervals_are_rejected(value):
    with pytest.raises(ValidationError):
        updates.RefreshConfiguration(interval_minutes=value)


def test_refresh_bypasses_live_ttls_and_archives_the_identical_frozen_dataset(root, monkeypatch):
    data = {"loaded_at": "2026-10-18T06:00:00Z", "next_gw": 8, "solio": {},
            "sources": {k: {"status": "live"} for k in ("fpl_bootstrap", "fpl_fixtures")}}
    calls = []
    def get_data(**kwargs):
        calls.append(kwargs)
        return data
    def archive(dataset, target):
        assert dataset is data and target == root
        return "snapshot.json.gz"
    monkeypatch.setattr(updates, "get_data", get_data)
    monkeypatch.setattr(updates, "archive_observation", archive)
    monkeypatch.setattr(updates, "archive_forecasts", lambda: ["independent.json.gz", "anchored.json.gz"])
    assert updates.refresh_once() is data
    assert calls == [{"refresh_live": True}]
    assert updates.status()["solio_capture"] == "snapshot.json.gz"
    assert updates.status()["forecast_captures"] == ["independent.json.gz", "anchored.json.gz"]
    assert updates.status()["core_fresh"] is True


def test_failure_retains_last_success_and_never_publishes_exception_details(root, monkeypatch):
    updates.write("auto-refresh-status.json", {"last_success_at": "old-success", "loaded_at": "old-data"})
    def fail(**kwargs):
        raise RuntimeError("private request detail")
    monkeypatch.setattr(updates, "get_data", fail)
    with pytest.raises(RuntimeError):
        updates.refresh_once()
    status = updates.status()
    assert status["last_success_at"] == "old-success"
    assert status["loaded_at"] == "old-data"
    assert status["last_error"] == "RuntimeError"
    assert "private request detail" not in str(status)


def test_failed_research_campaign_does_not_discard_fresh_forecasts(root, monkeypatch):
    from backend import solio_validation

    dataset = {"loaded_at": "fresh inputs", "next_gw": 9, "solio": {},
               "sources": {key: {"status": "live"} for key in ("fpl_bootstrap", "fpl_fixtures")}}
    monkeypatch.setattr(updates, "get_data", lambda **kwargs: dataset)
    monkeypatch.setattr(updates, "archive_observation", lambda *_: "observed.json.gz")
    monkeypatch.setattr(updates, "archive_forecasts", lambda: ["independent.json.gz", "anchored.json.gz"])
    def reject_changed_deadline(_root):
        raise ValueError("private request detail")
    monkeypatch.setattr(solio_validation, "score_pending", reject_changed_deadline)

    assert updates.refresh_once() is dataset
    state = updates.status()
    assert state["loaded_at"] == "fresh inputs"
    assert state["last_success_at"] and state["last_error"] is None
    assert state["core_fresh"] is True
    assert state["forecast_captures"] == ["independent.json.gz", "anchored.json.gz"]
    assert state["validation_results"] == [{"status": "failed", "error": "ValueError"}]
    assert "private request detail" not in str(state)


def test_scheduled_capture_preserves_both_model_configurations(monkeypatch):
    from backend import app
    calls = []
    def capture(request, refresh_inputs=True):
        calls.append((request.use_solio, refresh_inputs))
        return {"filename": f"{request.use_solio}.json.gz"}
    monkeypatch.setattr(app, "save_snapshot", capture)
    assert updates.archive_forecasts() == ["False.json.gz", "True.json.gz"]
    assert calls == [(False, False), (True, False)]

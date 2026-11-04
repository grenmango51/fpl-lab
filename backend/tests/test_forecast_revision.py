"""Regression cases motivated by the frozen GW12 diagnostic, without vendor data."""

from copy import deepcopy
from datetime import datetime, timezone
import gzip
import hashlib
import json

import pytest

from backend import model, data
from backend.availability import fixture_availability, return_date, selection_rows
from backend.ensemble import blend_forecasts
from backend.replay import replay_dataset
from backend.tests.test_minutes_schedule import synthetic_data, forecast

ORIGIN = datetime(2026, 10, 16, tzinfo=timezone.utc)


@pytest.mark.parametrize("news,before,after", [
    ("Suspended until 7 Nov", "2026-11-06T12:00:00Z", "2026-11-07T12:00:00Z"),
    ("Hamstring injury - Expected back 1 Nov", "2026-10-31T12:00:00Z", "2026-11-02T12:00:00Z"),
    ("Expected back 2 Jan", "2027-01-01T12:00:00Z", "2027-01-03T12:00:00Z"),
])
def test_news_dates_are_applied_to_each_fixture(news, before, after):
    p = {"status": "s", "chance_of_playing_next_round": 0, "news": news}
    assert fixture_availability(p, before, ORIGIN)["value"] == 0
    assert fixture_availability(p, after, ORIGIN)["value"] == 1
    assert fixture_availability(p, after, ORIGIN)["return_date"]


def test_unknown_recovery_is_explicit_and_never_restores_unregistered_players():
    p = {"status": "i", "chance_of_playing_next_round": 0, "news": "Unknown return date"}
    first = fixture_availability(p, "2026-11-13T00:00:00Z", ORIGIN)
    assert first["value"] == 0.5
    assert first["half_life_days"] == 28
    assert fixture_availability(p, "2026-11-13T00:00:00Z", ORIGIN, next_week=True)["value"] == 0
    for status in ("u", "n", "s"):
        assert fixture_availability({**p, "status": status}, "2027-05-01T00:00:00Z", ORIGIN)["value"] == 0
    assert fixture_availability(p, None, ORIGIN)["value"] == 0
    assert return_date("Expected back 31 Feb", ORIGIN) is None


def test_current_absence_does_not_erase_role_but_available_bench_dnp_counts():
    rows = [{"minutes": n, "season": "2026-27"} for n in (80, 90, 85, 0, 0, 0)]
    frozen = deepcopy(rows)
    injured = {"status": "i", "chance_of_playing_next_round": 0}
    assert len(selection_rows(rows, "2026-27", injured)) == 3
    assert len(selection_rows(rows, "2026-27", {**injured, "status": "a"})) == 6
    assert rows == frozen


def test_double_can_straddle_return_and_manual_availability_wins():
    d = synthetic_data()
    d["loaded_at"] = ORIGIN.isoformat()
    d["players"][1]["news"] = "Suspended until 7 Nov"
    d["players"][1]["status"] = "s"
    d["fixtures"][1]["kickoff_time"] = "2026-11-06T12:00:00Z"
    d["fixtures"][2]["kickoff_time"] = "2026-11-08T12:00:00Z"
    base = model.projections(dataset=d)
    a, b = forecast(base, gw=7)["fixtures"]
    assert a["pplay"] == 0 < b["pplay"]
    assert forecast(base, gw=7)["xmins"] == b["xmins"]
    forced = model.projections(minutes_schedule={"1": {"7": {"availability": 0}}}, dataset=d)
    assert forecast(forced, gw=7)["points"] == 0


def test_provider_can_restore_zero_base_and_updates_every_appearance_state():
    base = model.projections(dataset=synthetic_data())
    frozen = deepcopy(base)
    changed = blend_forecasts(base, {"1": {"6": 4}}, 1, "FPL Form", probabilities={"1": {"6": 0.8}})
    row = forecast(changed)
    fixture = row["fixtures"][0]
    assert row["pplay"] == fixture["pplay"] == 0.8
    assert 0 < row["p60"] == fixture["p60"] <= 0.8
    assert 0 < row["xmins"] == fixture["xmins"] <= 90 * 0.8
    assert sum(row["components"].values()) == pytest.approx(4)
    assert sum(fixture["components"].values()) == pytest.approx(fixture["points"])
    assert base == frozen


def test_conditional_scoring_does_not_count_appearance_change_twice():
    base = model.projections(dataset=synthetic_data())
    p = base["players"][1]
    gw = p["gw"]["6"]
    source_p = gw["pplay"] / 2
    changed = blend_forecasts(base, {"2": {"6": gw["points"] / 2}}, 1, "FPL Form", probabilities={"2": {"6": source_p}})
    future = forecast(changed, 2, 11)
    assert future["prediction_source"]["ratio"] == pytest.approx(1)
    assert future["points"] / future["pplay"] == pytest.approx(p["gw"]["11"]["points"] / p["gw"]["11"]["pplay"])


def test_first_fixture_provider_probability_never_collapses_a_future_double():
    base = model.projections(dataset=synthetic_data())
    p = base["players"][1]
    changed = blend_forecasts(base, {"2": {"6": 4}}, 1, "FPL Form", probabilities={"2": {"6": 0.2}})
    week = forecast(changed, 2, 7)
    assert week["fixtures"] == p["gw"]["7"]["fixtures"]
    assert week["pplay"] == p["gw"]["7"]["pplay"]
    assert len(week["fixtures"]) == 2


def test_later_anchors_have_more_influence_and_blanks_are_excluded():
    base = model.projections(dataset=synthetic_data())
    p = base["players"][1]
    changed = blend_forecasts(base, {"2": {"6": p["gw"]["6"]["points"] * 0.5,
                                         "9": p["gw"]["9"]["points"] * 1.5,
                                         "10": 60}}, 1, "CSV")
    source = forecast(changed, 2, 11)["prediction_source"]
    assert source["ratio"] > 1
    assert source["anchor_gameweeks"] == [6, 9]
    assert forecast(changed, 2, 10)["points"] == 0


def test_zero_probability_can_be_restored_by_a_later_layer():
    base = model.projections(dataset=synthetic_data())
    zero = blend_forecasts(base, {"2": {"6": 0}}, 1, "FPL Form", probabilities={"2": {"6": 0}})
    restored = blend_forecasts(zero, {"2": {"6": 3}}, 1, "CSV", probabilities={"2": {"6": 0.7}})
    row = forecast(restored, 2)
    assert row["pplay"] == 0.7
    assert 0 < row["xmins"] <= 63
    assert row["p60"] <= row["pplay"]


def test_long_state_rescaling_respects_strict_probability_boundary():
    base = model.projections(dataset=synthetic_data())
    base = deepcopy(base)
    row = forecast(base, 2)
    row["pplay"] = row["p60"] = 0.9382640384775709
    row["fixtures"][0]["pplay"] = row["fixtures"][0]["p60"] = row["pplay"]
    changed = blend_forecasts(base, {"2": {"6": 4}}, 1, "FPL Form",
                              probabilities={"2": {"6": 0.9379797247349969}})
    fixture = forecast(changed, 2)["fixtures"][0]
    assert 0 <= fixture["p60"] <= fixture["pplay"] <= 1


def test_replay_rejects_changed_raw_payload_and_restores_acquisition_globals(tmp_path, monkeypatch):
    original = data._dataset
    digest = hashlib.sha256(b"original").hexdigest()
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(json.dumps({"recorded_at": ORIGIN.isoformat(), "sources": {
        "fpl_bootstrap": {"sha256": digest}}}))
    raw = tmp_path / "data" / "raw" / "fpl_bootstrap" / f"{digest}.payload.gz"
    raw.parent.mkdir(parents=True)
    raw.write_bytes(gzip.compress(b"changed"))
    monkeypatch.setattr(data.httpx.Client, "get", lambda *a, **k: pytest.fail("Replay used network"))
    with pytest.raises(ValueError, match="hash mismatch"):
        replay_dataset(snapshot, tmp_path)
    assert data._dataset is original


def test_replay_uses_the_original_input_clock_for_recovery_not_the_later_record_time(tmp_path):
    synthetic = synthetic_data()
    bootstrap = {"events": [{"id": 6, "is_next": True, "finished": False,
                             "deadline_time": "2026-10-20T10:00:00Z"}],
                 "teams": list(synthetic["teams"].values()),
                 "elements": list(synthetic["players"].values())}
    sources = {}
    for key, value in (("fpl_bootstrap", bootstrap), ("fpl_fixtures", synthetic["fixtures"])):
        raw = json.dumps(value).encode()
        digest = hashlib.sha256(raw).hexdigest()
        path = tmp_path / "data" / "raw" / key / f"{digest}.payload.gz"
        path.parent.mkdir(parents=True)
        path.write_bytes(gzip.compress(raw))
        sources[key] = {"sha256": digest}
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(json.dumps({"recorded_at": "2026-10-19T10:00:00Z",
                                   "capture_receipt": {"dataset_loaded_at": ORIGIN.isoformat()},
                                   "sources": sources}))
    replayed = replay_dataset(snapshot, tmp_path)
    assert replayed["loaded_at"] == ORIGIN.isoformat()

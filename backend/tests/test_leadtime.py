"""Frozen lead bins, matched coverage and player-GW weighted error checks."""

from datetime import datetime, timedelta, timezone
import gzip
import json
import math

import pytest

from backend import leadtime


NOW = datetime(2026, 11, 1, tzinfo=timezone.utc)
DEADLINES = {
    5: datetime(2026, 9, 20, 10, tzinfo=timezone.utc),
    6: datetime(2026, 9, 27, 10, tzinfo=timezone.utc),
}


def player(pid=1, live=4, component=5, vendor=3, *, minutes=70):
    models = {"Live ensemble": live, "Component model": component}
    if vendor is not None:
        models["FPL Form"] = vendor
    return {
        "id": pid,
        "code": 1000 + pid,
        "forecast": {"points": live, "xmins": minutes},
        "component_forecast": {"points": component, "xmins": minutes},
        "models": models,
    }


def dataset(*, finished=True, checked=True):
    events = []
    for gw, deadline in DEADLINES.items():
        event = {"id": gw, "deadline_time": deadline.isoformat(), "finished": finished}
        if checked is not None:
            event["data_checked"] = checked
        events.append(event)
    return {"season": "2026-27", "bootstrap": {"events": events}}


def receipt(gw, *, primary=True):
    return {
        "target_gameweek": gw,
        "target_season": "2026-27",
        "eligible_primary": {
            name: primary for name in ("Live ensemble", "Component model", "FPL Form")
        },
        "comparison_models": ["Live ensemble", "Component model"],
        "eligibility_reasons": {},
    }


def capture(root, gw=5, hours=10, *, tag="test", rows=None, primary=True, legacy=False):
    target = {
        "gameweek": gw,
        "deadline": DEADLINES[gw].isoformat(),
        "capture_receipt": receipt(gw, primary=primary),
        "players": rows if rows is not None else [player()],
    }
    record = {
        "season": "2026-27",
        "recorded_at": (DEADLINES[gw] - timedelta(hours=hours)).isoformat(),
        "model_version": "version-test",
        "configuration_hash": "config-hash",
        "configuration": {
            "minutes_schedule": {"1": {"5": {"conditional_minutes": 90}}},
            "secret": "must-not-leak",
        },
        "origin_gameweek": gw,
    }
    if legacy:
        record.update(target)
        record.pop("season")
    else:
        record["future_targets"] = {str(gw): target}
    path = root / "data" / "snapshots" / f"2026-27_gw{gw}_{tag}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record), encoding="utf-8")
    return path, record


@pytest.fixture
def actuals(monkeypatch):
    calls, outcomes = [], {5: {1: 0}, 6: {1: 0, 2: 0, 3: 0}}

    def fetch(url, key, ttl):
        gw = int(url.split("/event/")[1].split("/")[0])
        calls.append(gw)
        return json.dumps(
            {
                "elements": [
                    {"id": pid, "stats": {"total_points": points}}
                    for pid, points in outcomes[gw].items()
                ]
            }
        )

    monkeypatch.setattr(leadtime, "fetch", fetch)
    monkeypatch.setattr(
        leadtime,
        "source_metadata",
        lambda key: {
            "status": "live",
            "fetched_at": NOW.isoformat(),
            "sha256": "actual-hash",
        },
    )
    return calls, outcomes


@pytest.mark.parametrize(
    "hours,expected",
    [
        (-1, None),
        (0, None),
        (0.0001, "0-24"),
        (23.999, "0-24"),
        (24, "24-72"),
        (72, "72-168"),
        (168, "168-336"),
        (336, "336-672"),
        (672, "672+"),
        (1000, "672+"),
        (float("nan"), None),
        (float("inf"), None),
    ],
)
def test_predeclared_half_open_bin_boundaries(hours, expected):
    assert leadtime.lead_bin(hours) == expected


def test_latest_capture_per_target_bin_and_deterministic_filename_tie(
    tmp_path, actuals
):
    capture(tmp_path, hours=20, tag="older", rows=[player(live=99)])
    capture(tmp_path, hours=5, tag="a", rows=[player(live=7)])
    capture(tmp_path, hours=5, tag="z", rows=[player(live=9)], primary=False)
    capture(tmp_path, hours=100, tag="far")
    result = leadtime.score(dataset(), tmp_path, NOW)
    near = result["bins"][0]["gameweeks"][0]
    assert near["snapshot"].endswith("_z.json")
    assert near["mae"] == 9
    assert near["pairwise_comparisons"]["Component model"]["eligible_primary"] is False
    assert (
        result["bins"][0]["pairwise_comparisons"]["Component model"]["primary"]["count"]
        == 0
    )
    assert len(result["bins"][2]["gameweeks"]) == 1
    assert actuals[0] == [5]  # Different lead bins reuse exactly one official fetch.
    assert (tmp_path / "data" / "lead-time.json").is_file()
    assert "must-not-leak" not in json.dumps(result)
    assert near["configuration_hash"] == "config-hash"
    assert near["manual_configuration"] is True


def test_legacy_top_capture_remains_eligible_by_stored_deadline(tmp_path, actuals):
    capture(tmp_path, hours=24, legacy=True)
    result = leadtime.score(dataset(), tmp_path, NOW, save=False)
    row = result["bins"][1]["gameweeks"][0]
    assert row["lead_hours"] == 24
    assert row["pairwise_comparisons"]["FPL Form"]["count"] == 1


@pytest.mark.parametrize(
    "finished,checked,status", [(False, True, "pending"), (True, False, "unchecked")]
)
def test_pending_and_unchecked_targets_show_coverage_without_outcome_fetch(
    tmp_path, actuals, finished, checked, status
):
    capture(tmp_path)
    data = dataset(finished=finished, checked=checked)
    inventory = leadtime.capture_inventory(data, tmp_path, NOW)
    assert actuals[0] == []
    pending = inventory["bins"][0]["pending_targets"][0]
    assert pending["status"] == status
    assert pending["coverage"]["FPL Form"]["forecast_count"] == 1
    report = leadtime.score(data, tmp_path, NOW, save=False)
    assert actuals[0] == []
    assert report["bins"][0]["gameweeks"] == []


def test_missing_checked_flag_is_exploratory_even_with_fresh_receipt(tmp_path, actuals):
    capture(tmp_path)
    result = leadtime.score(dataset(checked=None), tmp_path, NOW, save=False)
    pair = result["bins"][0]["gameweeks"][0]["pairwise_comparisons"]["FPL Form"]
    assert pair["eligibility"] == "exploratory"
    assert pair["eligible_primary"] is False


def test_changed_deadline_retains_original_lead_bin_and_is_exploratory(
    tmp_path, actuals
):
    capture(tmp_path, hours=30)
    data = dataset()
    data["bootstrap"]["events"][0]["deadline_time"] = (
        DEADLINES[5] + timedelta(hours=100)
    ).isoformat()
    report = leadtime.score(data, tmp_path, NOW, save=False)
    row = report["bins"][1]["gameweeks"][0]
    assert row["lead_hours"] == 30
    assert row["deadline_changed"] is True
    assert all(
        pair["eligible_primary"] is False
        for pair in row["pairwise_comparisons"].values()
    )
    assert (
        report["bins"][2]["gameweeks"] == []
    )  # Never re-bin to current 130-hour lead.


def test_capture_after_revised_earlier_deadline_is_excluded_without_older_fallback(
    tmp_path, actuals
):
    capture(tmp_path, hours=20, tag="older")
    capture(tmp_path, hours=5, tag="newer")
    data = dataset()
    data["bootstrap"]["events"][0]["deadline_time"] = (
        DEADLINES[5] - timedelta(hours=10)
    ).isoformat()
    report = leadtime.score(data, tmp_path, NOW, save=False)
    assert actuals[0] == []
    assert report["bins"][0]["gameweeks"] == []
    assert (
        report["bins"][0]["pending_targets"][0]["status"] == "excluded_current_deadline"
    )
    assert report["bins"][0]["pending_targets"][0]["snapshot"].endswith("_newer.json")


def test_pairwise_aggregates_weight_players_not_gameweek_maes_and_keep_sparse_vendor(
    tmp_path, actuals
):
    capture(tmp_path, 5, 10, rows=[player(1, 1, 1, 4)])
    capture(
        tmp_path,
        6,
        10,
        rows=[player(1, 3, 5, None), player(2, 3, 5, 2), player(3, 3, 5, 2)],
    )
    report = leadtime.score(dataset(), tmp_path, NOW, save=False)
    pairs = report["bins"][0]["pairwise_comparisons"]
    component = pairs["Component model"]["primary"]
    assert component["count"] == 4
    assert component["gameweek_count"] == 2
    assert component["model"]["mae"] == 4  # (1 + 5 + 5 + 5) / 4, not (1 + 5) / 2.
    assert component["model"]["rmse"] == pytest.approx(math.sqrt(19))
    assert component["model"]["bias"] == 4
    assert component["ensemble"]["mae"] == 2.5
    form = pairs["FPL Form"]
    assert form["primary"]["count"] == 3
    assert form["primary"]["model"]["mae"] == pytest.approx(8 / 3)
    assert form["primary"]["ensemble"]["mae"] == pytest.approx(7 / 3)
    assert form["coverage"]["missing_forecast_count"] == 1
    assert form["primary"]["player_gw_ids"] == [
        {"gw": 5, "player_id": 1},
        {"gw": 6, "player_id": 2},
        {"gw": 6, "player_id": 3},
    ]


def test_absent_far_provider_has_zero_coverage_without_dropping_component_scores(
    tmp_path, actuals
):
    capture(tmp_path, hours=672, rows=[player(vendor=None)])
    report = leadtime.score(dataset(), tmp_path, NOW, save=False)
    pairs = report["bins"][-1]["pairwise_comparisons"]
    assert pairs["FPL Form"]["all"]["count"] == 0
    assert pairs["FPL Form"]["all"]["model"] is None
    assert pairs["FPL Form"]["coverage"]["missing_forecast_count"] == 1
    assert pairs["Component model"]["all"]["count"] == 1


def test_malformed_naive_postdeadline_and_future_records_do_not_abort_or_leak(
    tmp_path, actuals
):
    valid, _ = capture(tmp_path, tag="valid")
    (valid.parent / "2026-27_gw5_broken.json").write_text(
        "not-json with private-text", encoding="utf-8"
    )
    for tag, change in (
        ("naive", {"recorded_at": "2026-09-20T01:00:00"}),
        ("future", {"recorded_at": (NOW + timedelta(seconds=1)).isoformat()}),
        ("postdeadline", {"recorded_at": DEADLINES[5].isoformat()}),
        ("otherseason", {"season": "2025-26"}),
    ):
        path, record = capture(tmp_path, tag=tag)
        record.update(change)
        path.write_text(json.dumps(record), encoding="utf-8")
    path, record = capture(tmp_path, tag="bad-target")
    record["future_targets"]["6"] = {"gameweek": 6, "deadline": "naive", "players": []}
    record["future_targets"]["5"]["players"][0]["models"]["FPL Form"] = float("inf")
    path.write_text(json.dumps(record), encoding="utf-8")
    report = leadtime.score(dataset(), tmp_path, NOW, save=False)
    assert report["bins"][0]["gameweeks"][0]["snapshot"] == valid.name
    assert len(report["diagnostics"]) >= 5
    assert "private-text" not in json.dumps(report)
    json.dumps(report, allow_nan=False)


def test_source_stale_and_receipt_target_mismatch_are_never_primary(
    tmp_path, actuals, monkeypatch
):
    path, record = capture(tmp_path)
    record["future_targets"]["5"]["capture_receipt"]["target_gameweek"] = 6
    path.write_text(json.dumps(record), encoding="utf-8")
    monkeypatch.setattr(leadtime, "source_metadata", lambda key: {"status": "stale"})
    report = leadtime.score(dataset(), tmp_path, NOW, save=False)
    pair = report["bins"][0]["gameweeks"][0]["pairwise_comparisons"]["Component model"]
    assert pair["eligible_primary"] is False
    assert (
        report["bins"][0]["pairwise_comparisons"]["Component model"]["primary"]["count"]
        == 0
    )


def test_inventory_never_fetches_outcomes_even_when_targets_are_complete(
    tmp_path, monkeypatch
):
    capture(tmp_path)
    monkeypatch.setattr(
        leadtime,
        "fetch",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("Inventory must not fetch outcomes")
        ),
    )
    inventory = leadtime.capture_inventory(dataset(), tmp_path, NOW)
    assert inventory["bins"][0]["ready_count"] == 1
    assert inventory["bins"][0]["pending_count"] == 0
    assert not (tmp_path / "data" / "lead-time.json").exists()


def test_nonfinite_and_out_of_range_vendor_predictions_report_invalid_coverage(
    tmp_path, actuals
):
    capture(tmp_path, rows=[player(vendor=float("inf"))])
    report = leadtime.score(dataset(), tmp_path, NOW, save=False)
    coverage = report["bins"][0]["gameweeks"][0]["coverage"]["FPL Form"]
    assert coverage["invalid_forecast_count"] == 1
    assert report["bins"][0]["pairwise_comparisons"]["FPL Form"]["all"]["count"] == 0
    assert (
        report["bins"][0]["pairwise_comparisons"]["Component model"]["all"]["count"]
        == 1
    )
    json.dumps(report, allow_nan=False)
    capture(tmp_path, hours=5, tag="huge", rows=[player(vendor=10**1000)])
    report = leadtime.score(dataset(), tmp_path, NOW, save=False)
    assert (
        report["bins"][0]["gameweeks"][0]["coverage"]["FPL Form"][
            "invalid_forecast_count"
        ]
        == 1
    )


def test_multi_target_capture_uses_each_targets_own_receipt(tmp_path, actuals):
    path, record = capture(tmp_path)
    record["future_targets"]["6"] = {
        "gameweek": 6,
        "deadline": DEADLINES[6].isoformat(),
        "capture_receipt": receipt(6, primary=False),
        "players": [player()],
    }
    path.write_text(json.dumps(record), encoding="utf-8")
    report = leadtime.score(dataset(), tmp_path, NOW, save=False)
    assert (
        report["bins"][0]["gameweeks"][0]["pairwise_comparisons"]["Component model"][
            "eligible_primary"
        ]
        is True
    )
    far = report["bins"][3]["gameweeks"][0]
    assert far["gw"] == 6
    assert far["lead_hours"] == 178
    assert far["pairwise_comparisons"]["Component model"]["eligible_primary"] is False
    assert actuals[0] == [5, 6]


def test_frozen_fixture_schedule_is_visible_and_changes_disclosed_without_exclusion(
    tmp_path, actuals
):
    path, record = capture(tmp_path)
    frozen = [
        {"id": 101, "team_h": 1, "team_a": 2, "kickoff_time": "2026-09-20T14:00:00Z"}
    ]
    record["future_targets"]["5"]["fixtures"] = frozen
    path.write_text(json.dumps(record), encoding="utf-8")
    data = dataset()
    data["fixtures"] = [
        {**frozen[0], "event": 5, "kickoff_time": "2026-09-21T14:00:00Z"}
    ]
    report = leadtime.score(data, tmp_path, NOW, save=False)
    result = report["bins"][0]["gameweeks"][0]
    assert result["fixtures"] == frozen
    assert result["fixture_schedule_changed"] is True
    assert result["pairwise_comparisons"]["Component model"]["eligible_primary"] is True
    assert report["bins"][0]["label"] == "<24 hours"


def test_gzip_and_legacy_selection_score_identically_and_skip_corrupt_gzip(
    tmp_path, actuals
):
    plain, record = capture(tmp_path, hours=10)
    baseline = leadtime.score(dataset(), tmp_path, NOW, save=False)
    compressed = plain.with_suffix(".json.gz")
    compressed.write_bytes(gzip.compress(json.dumps(record).encode("utf-8"), mtime=0))
    (plain.parent / "2026-27_gw5_zzz-corrupt.json.gz").write_bytes(b"not a gzip file")
    (plain.parent / "2026-27_gw5_zzz-truncated.json.gz").write_bytes(
        gzip.compress(json.dumps(record).encode(), mtime=0)[:-8]
    )
    (plain.parent / "2026-27_gw5_zzz-temp.json.gz.tmp").write_text(
        json.dumps(record), encoding="utf-8"
    )
    report = leadtime.score(dataset(), tmp_path, NOW, save=False)
    assert report["bins"][0]["gameweeks"][0]["snapshot"] == compressed.name
    assert (
        report["bins"][0]["pairwise_comparisons"]
        == baseline["bins"][0]["pairwise_comparisons"]
    )
    assert len(report["diagnostics"]) == 2
    assert plain.read_text(encoding="utf-8") == json.dumps(record)

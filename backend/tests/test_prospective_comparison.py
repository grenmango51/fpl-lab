"""Prospective comparisons use captured cohorts and expose incomplete coverage."""

import json
import gzip
import sys

import pytest

from backend import prospective


def player(pid, live, component, vendor=None, *, minutes=70, live_minutes=70):
    models = {"Live ensemble": live, "Component model": component}
    if vendor is not None:
        models["FPL Form"] = vendor
    return {
        "id": pid,
        "forecast": {"xmins": live_minutes, "points": live},
        "component_forecast": {"xmins": minutes, "points": component},
        "models": models,
    }


def scored_record(
    tmp_path,
    monkeypatch,
    players,
    actuals,
    *,
    checked=True,
    status="live",
    receipt=True,
):
    directory = tmp_path / "data" / "snapshots"
    directory.mkdir(parents=True)
    deadline = "2026-09-20T10:00:00Z"
    record = {
        "deadline": deadline,
        "recorded_at": "2026-09-19T10:00:00Z",
        "model_version": "comparison-test",
        "players": players,
    }
    if receipt:
        record["capture_receipt"] = {
            "eligible_primary": {
                name: True for name in ("Live ensemble", "Component model", "FPL Form")
            },
            "eligibility_reasons": {},
        }
    event = {"id": 5, "deadline_time": deadline, "finished": True}
    if checked is not None:
        event["data_checked"] = checked
    (directory / "2026-27_gw5_comparison.json").write_text(
        json.dumps(record), encoding="utf-8"
    )
    monkeypatch.setattr(prospective, "ROOT", tmp_path)
    monkeypatch.setattr(
        prospective,
        "get_data",
        lambda: {"season": "2026-27", "bootstrap": {"events": [event]}},
    )
    monkeypatch.setattr(prospective.data_module, "_statuses", {})

    def fetch_actuals(url, key, ttl):
        assert url.endswith("/event/5/live/")
        prospective.data_module._statuses[key] = {
            "url": url,
            "status": status,
            "fetched_at": "2026-09-23T12:00:00Z",
            "sha256": "actual-test-hash",
            "raw_archive": "data/raw/test.payload.gz",
        }
        return json.dumps(
            {
                "elements": [
                    {"id": pid, "stats": {"total_points": points, "minutes": 0}}
                    for pid, points in actuals.items()
                ]
            }
        )

    monkeypatch.setattr(prospective, "fetch", fetch_actuals)
    return record


def test_one_missing_vendor_row_keeps_matched_provider_comparison(
    tmp_path, monkeypatch
):
    players = [
        player(1, 4, 5, 3),
        player(2, 7, 6),
        player(3, 99, 99, 99, minutes=20),
        player(4, 8, 9, 5, live_minutes=10),
    ]
    scored_record(tmp_path, monkeypatch, players, {1: 10, 2: 0, 3: 100, 4: 6})
    result = prospective.score()["gameweeks"][0]
    assert result["cohort"]["eligible_player_ids"] == [1, 2, 4]
    assert result["count"] == 3
    assert result["mae"] == 5
    assert result["cohort"]["selection_source_counts"] == {
        "component_forecast": 3,
        "legacy_ensemble_forecast": 0,
    }
    assert result["coverage"]["FPL Form"]["forecast_count"] == 2
    assert result["coverage"]["FPL Form"]["missing_player_ids"] == [2]
    assert result["common_player_ids"] == [1, 4]
    assert result["common_cohort_count"] == 2
    assert all(m["count"] == 2 for m in result["models"].values())
    matched = result["pairwise_comparisons"]["FPL Form"]
    assert matched["player_ids"] == [1, 4]
    assert matched["model"]["count"] == matched["ensemble"]["count"] == 2
    assert matched["model"]["mae"] == 4
    assert matched["ensemble"]["mae"] == 4
    assert matched["eligible_primary"] is True
    assert result["pairwise_comparisons"]["Component model"]["count"] == 3
    # Actual appearance minutes are zero: cohort never filters on realized play.
    assert result["actual_source"]["sha256"] == "actual-test-hash"


def test_target_model_list_keeps_common_component_cohort_and_absent_provider_coverage():
    record = {
        "players": [player(1, 4, 5), player(2, 7, 6)],
        "capture_receipt": {
            "comparison_models": ["Live ensemble", "Component model"],
            "eligible_primary": {
                "Live ensemble": True,
                "Component model": True,
                "FPL Form": False,
            },
        },
    }
    result = prospective.score_cohorts(record, {1: 0, 2: 10}, {"status": "live"}, True)
    assert result["common_cohort_count"] == 2
    assert set(result["models"]) == {"Live ensemble", "Component model"}
    assert result["coverage"]["FPL Form"]["forecast_count"] == 0
    assert result["pairwise_comparisons"]["FPL Form"]["count"] == 0
    assert result["pairwise_comparisons"]["Component model"]["eligible_primary"] is True


@pytest.mark.parametrize(
    "field,value",
    [("deadline", 123), ("recorded_at", "2026-09-19T10:00:00"), ("recorded_at", None)],
)
def test_invalid_capture_timestamp_is_skipped_without_requesting_outcomes(
    tmp_path, monkeypatch, field, value
):
    record = scored_record(tmp_path, monkeypatch, [player(1, 4, 5)], {1: 0})
    record[field] = value
    path = tmp_path / "data" / "snapshots" / "2026-27_gw5_comparison.json"
    path.write_text(json.dumps(record), encoding="utf-8")
    monkeypatch.setattr(
        prospective,
        "fetch",
        lambda *args: pytest.fail("Invalid capture must not fetch outcomes"),
    )
    assert prospective.score()["gameweeks"] == []


def test_sparse_models_keep_pairwise_rows_when_no_all_model_intersection(
    tmp_path, monkeypatch
):
    first, second = player(1, 4, 5, 3), player(2, 7, 6)
    second["models"]["Other provider"] = 8
    scored_record(tmp_path, monkeypatch, [first, second], {1: 0, 2: 10})
    result = prospective.score()["gameweeks"][0]
    assert result["models"] == {}
    assert result["common_cohort_count"] == 0
    assert result["pairwise_comparisons"]["FPL Form"]["player_ids"] == [1]
    assert result["pairwise_comparisons"]["Other provider"]["player_ids"] == [2]
    assert result["pairwise_comparisons"]["Component model"]["player_ids"] == [1, 2]


def test_missing_outcomes_and_invalid_forecasts_have_separate_coverage(
    tmp_path, monkeypatch
):
    players = [player(1, 4, 5, float("nan")), player(2, 7, 6, 8), player(3, 8, 9)]
    scored_record(tmp_path, monkeypatch, players, {1: 0, 3: 10})
    report = prospective.score()
    result = report["gameweeks"][0]
    assert result["cohort"]["eligible_count"] == 3
    assert result["cohort"]["scored_count"] == 2
    assert result["cohort"]["missing_actual_ids"] == [2]
    assert result["coverage"]["FPL Form"]["forecast_count"] == 1
    assert result["coverage"]["FPL Form"]["invalid_player_ids"] == [1]
    assert result["coverage"]["FPL Form"]["missing_player_ids"] == [3]
    assert result["coverage"]["FPL Form"]["scored_count"] == 0
    pair = result["pairwise_comparisons"]["FPL Form"]
    assert pair["count"] == 0
    assert pair["model"] is pair["ensemble"] is None
    assert pair["eligible_primary"] is False
    json.dumps(report, allow_nan=False)


@pytest.mark.parametrize(
    "checked,status", [(None, "live"), (True, "stale"), (True, "unknown")]
)
def test_unchecked_or_stale_outcomes_never_mark_primary(
    tmp_path, monkeypatch, checked, status
):
    scored_record(
        tmp_path,
        monkeypatch,
        [player(1, 4, 5, 3)],
        {1: 0},
        checked=checked,
        status=status,
    )
    result = prospective.score()["gameweeks"][0]
    pair = result["pairwise_comparisons"]["FPL Form"]
    assert pair["eligibility"] == "exploratory"
    assert pair["eligible_primary"] is False
    assert pair["eligibility_reasons"]
    assert result["actual_data_checked"] is checked
    assert result["actual_source"]["status"] == status


def test_capture_receipt_ineligibility_propagates_to_each_matched_pair(
    tmp_path, monkeypatch
):
    record = scored_record(tmp_path, monkeypatch, [player(1, 4, 5, 3)], {1: 0})
    record["capture_receipt"]["eligible_primary"]["FPL Form"] = False
    record["capture_receipt"]["eligibility_reasons"]["FPL Form"] = [
        "Provider refresh used a stale fallback."
    ]
    (tmp_path / "data" / "snapshots" / "2026-27_gw5_comparison.json").write_text(
        json.dumps(record)
    )
    result = prospective.score()["gameweeks"][0]
    form = result["pairwise_comparisons"]["FPL Form"]
    assert form["eligibility"] == "exploratory"
    assert "Provider refresh used a stale fallback." in form["eligibility_reasons"]
    assert result["pairwise_comparisons"]["Component model"]["eligible_primary"] is True


def test_unchecked_finished_gameweek_is_excluded_without_fetching(
    tmp_path, monkeypatch
):
    scored_record(tmp_path, monkeypatch, [player(1, 4, 5, 3)], {1: 0}, checked=False)
    monkeypatch.setattr(
        prospective,
        "fetch",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("Unchecked outcomes must not be fetched")
        ),
    )
    result = prospective.score()
    assert result["gameweeks"] == []
    assert result["excluded_gameweeks"][0]["gw"] == 5


def test_legacy_cohort_and_missing_receipt_remain_scoreable_with_unknown_eligibility(
    tmp_path, monkeypatch
):
    first, second = player(1, 4, 5, 3), player(2, 7, 6, minutes=70, live_minutes=20)
    first.pop("component_forecast")
    second.pop("component_forecast")
    scored_record(
        tmp_path,
        monkeypatch,
        [first, second],
        {1: 10, 2: 0},
        receipt=False,
        checked=None,
    )
    result = prospective.score()["gameweeks"][0]
    assert result["cohort"]["eligible_player_ids"] == [1]
    assert result["cohort"]["selection_source_counts"]["legacy_ensemble_forecast"] == 1
    assert result["models"]["FPL Form"]["mae"] == 7
    assert result["pairwise_comparisons"]["FPL Form"]["eligibility"] == "unknown"
    assert result["pairwise_comparisons"]["FPL Form"]["eligible_primary"] is False


def test_live_capture_ineligibility_blocks_all_provider_primary_claims(
    tmp_path, monkeypatch
):
    record = scored_record(tmp_path, monkeypatch, [player(1, 4, 5, 3)], {1: 0})
    record["capture_receipt"]["eligible_primary"]["Live ensemble"] = False
    (tmp_path / "data" / "snapshots" / "2026-27_gw5_comparison.json").write_text(
        json.dumps(record)
    )
    result = prospective.score()["gameweeks"][0]
    assert all(
        pair["eligible_primary"] is False
        for pair in result["pairwise_comparisons"].values()
    )


def test_receipt_declared_provider_with_zero_rows_reports_missing_coverage(
    tmp_path, monkeypatch
):
    record = scored_record(
        tmp_path, monkeypatch, [player(1, 4, 5), player(2, 7, 6)], {1: 0, 2: 10}
    )
    record["capture_receipt"]["eligible_primary"]["FPL Form"] = False
    (tmp_path / "data" / "snapshots" / "2026-27_gw5_comparison.json").write_text(
        json.dumps(record)
    )
    result = prospective.score()["gameweeks"][0]
    assert result["coverage"]["FPL Form"]["forecast_count"] == 0
    assert result["coverage"]["FPL Form"]["missing_player_ids"] == [1, 2]
    assert result["pairwise_comparisons"]["FPL Form"]["count"] == 0
    assert result["pairwise_comparisons"]["FPL Form"]["eligible_primary"] is False
    assert result["pairwise_comparisons"]["Component model"]["count"] == 2


@pytest.mark.parametrize("flags,refresh", [([], True), (["--cached"], False)])
def test_cli_capture_defaults_to_live_refresh_with_explicit_cached_opt_out(
    monkeypatch, flags, refresh
):
    calls = []
    monkeypatch.setattr(sys, "argv", ["prospective", *flags])

    def capture(request, *, refresh_inputs):
        calls.append(refresh_inputs)
        return {"saved": True}

    monkeypatch.setattr(prospective, "save_snapshot", capture)
    prospective.main()
    assert calls == [refresh]


def test_compressed_capture_keeps_matched_scoring_and_corrupt_gzip_is_ignored(
    tmp_path, monkeypatch
):
    record = scored_record(tmp_path, monkeypatch, [player(1, 4, 5, 3)], {1: 0})
    baseline = prospective.score()["gameweeks"][0]
    record["recorded_at"] = "2026-09-19T11:00:00Z"
    directory = tmp_path / "data" / "snapshots"
    compressed = directory / "2026-27_gw5_newer.json.gz"
    compressed.write_bytes(gzip.compress(json.dumps(record).encode("utf-8"), mtime=0))
    (directory / "2026-27_gw5_corrupt.json.gz").write_bytes(b"not a gzip file")
    (directory / "2026-27_gw5_truncated.json.gz").write_bytes(
        gzip.compress(json.dumps(record).encode(), mtime=0)[:-8]
    )
    (directory / "2026-27_gw5_temp.json.gz.tmp").write_text(
        json.dumps(record), encoding="utf-8"
    )
    result = prospective.score()["gameweeks"][0]
    assert result["snapshot"] == compressed.name
    assert result["models"] == baseline["models"]
    assert result["pairwise_comparisons"] == baseline["pairwise_comparisons"]

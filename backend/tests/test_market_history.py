"""Offline archives: identities, units and observed timestamps, not forecasts."""
import hashlib
import json

import pytest

from backend.market_history import build_history, market_history, timestamp


def archived(payload, at="2026-10-02T10:00:00Z", source=None):
    raw = (payload if isinstance(payload, str) else json.dumps(payload)).encode()
    return dict(raw=raw, at=timestamp(at), sha256=hashlib.sha256(raw).hexdigest(),
                source=source, meta={})


def mappings(double=False):
    bootstrap = archived({"teams": [{"id": 7, "short_name": "ARS"}, {"id": 9, "short_name": "CHE"}]})
    fixtures = [{"id": 123, "code": 987, "event": 7, "team_h": 7, "team_a": 9,
                 "kickoff_time": "2026-10-15T19:00:00Z"}]
    if double:
        fixtures.append({**fixtures[0], "id": 124, "code": 988})
    return [bootstrap], [archived(fixtures)]


def joe(at, goals=1.5, cs=0.3, home="ARS", season="2026-27"):
    return archived({"season": season, "projectionsByPeriod": {"7": {"fixtures": [{
        "gw": 7, "homeTeamCode": home, "awayTeamCode": "CHE", "homeTeamId": 999,
        "fixtureId": "vendor:444", "lambdaHome": goals, "lambdaAway": 1.0,
        "pHomeCs": cs, "pAwayCs": .2, "snapshotTsUtc": "2026-10-02T09:00:00Z",
        "kickoffTsUtc": "2026-10-15T19:00:00Z"}]}}}, at, "fpljoe")


def query(records, **filters):
    bs, fs = mappings()
    return build_history(records, bs, fs, **filters)


def home_rows(result):
    return {r["metric"]: r for r in result["series"] if r["team"] == "ARS"}


def test_timezone_normalisation_and_invalid_filters():
    assert timestamp("2026-10-02T13:00:00+03:00") == "2026-10-02T10:00:00+00:00"
    with pytest.raises(ValueError):
        timestamp("2026-10-02T10:00:00")
    with pytest.raises(ValueError):
        query([], source="model")
    with pytest.raises(ValueError):
        query([], since="2026-10-03T10:00:00Z", until="2026-10-02T10:00:00Z")


def test_same_fixture_maps_club_codes_not_vendor_ids_and_converts_cs_units():
    rows = home_rows(query([joe("2026-10-02T11:00:00Z"), joe("2026-10-02T12:00:00Z", 1.7, .35)]))
    assert rows["goals"]["fixture_id"] == 123
    assert rows["goals"]["delta"] == pytest.approx(.2)
    assert rows["clean_sheet_probability"]["delta"] == pytest.approx(5)
    assert rows["clean_sheet_probability"]["unit"] == "percentage_points"
    point = rows["goals"]["latest"]
    assert point["provider_at"] != point["extracted_at"]
    assert len(point["fixture_mapping_sha256"]) == 64


def test_single_snapshot_and_window_do_not_invent_comparison():
    records = [joe("2026-10-02T11:00:00Z"), joe("2026-10-03T12:00:00Z", 1.7)]
    rows = home_rows(query(records, since="2026-10-03T00:00:00Z"))
    assert rows["goals"]["state"] == "single_snapshot"
    assert rows["goals"]["delta"] is None


def test_missing_partial_metric_is_not_zero_and_latest_missing_has_no_delta():
    rows = home_rows(query([joe("2026-10-02T11:00:00Z"), joe("2026-10-03T12:00:00Z", None, .35)]))
    assert rows["goals"]["latest"]["value"] is None
    assert rows["goals"]["state"] == "missing_latest"
    assert rows["goals"]["delta"] is None
    assert rows["clean_sheet_probability"]["delta"] == pytest.approx(5)


def test_different_fixture_club_or_season_does_not_compare():
    result = query([joe("2026-10-02T11:00:00Z"), joe("2026-10-03T12:00:00Z", 2, home="CHE")])
    assert result["coverage"]["comparable_series"] == 0
    assert result["diagnostics"]["unmatched_fixture"] == 1
    result = query([joe("2026-10-02T11:00:00Z"), joe("2026-10-03T12:00:00Z", 2, season="2027-28")])
    assert result["coverage"]["comparable_series"] == 0


def test_mapping_must_exist_before_source_extraction_and_ambiguous_fixture_is_excluded():
    bs, fs = mappings()
    result = build_history([joe("2026-10-02T09:00:00Z")], bs, fs)
    assert not result["series"]
    assert result["diagnostics"]["missing_contemporaneous_mapping"] == 1
    bs, fs = mappings(double=True)
    assert not build_history([joe("2026-10-02T11:00:00Z")], bs, fs)["series"]


def test_elevenify_double_gw_cannot_become_per_fixture_and_source_is_separate():
    sheet = archived("Team,GW1,GW7\nArsenal,,1.8\nChelsea,,1.1\nTeam,GW1,GW7\nArsenal,,0.4\nChelsea,,0.2\n", "2026-10-02T12:00:00Z", "elevenify_sheet")
    records = [joe("2026-10-02T11:00:00Z"), sheet]
    rows = query(records)["series"]
    assert {r["source"] for r in rows} == {"fpljoe", "elevenify_sheet"}
    assert all(r["delta"] is None for r in rows)
    bs, fs = mappings(double=True)
    assert not build_history(records, bs, fs)["series"]


def test_hash_mismatch_archive_is_rejected_without_raw_payload_exposure(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "fpljoe.json").write_text(json.dumps(dict(body="secret payload", sha256="bad", fetched_at="2026-10-02T12:00:00Z")))
    result = market_history(roots=[tmp_path])
    assert result["diagnostics"]["hash_mismatch"] == 1
    assert "secret payload" not in json.dumps(result)


def test_capture_preserves_original_extraction_and_identical_hash_does_not_add_history(tmp_path, monkeypatch):
    from backend import market_history as module
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module, "PRIOR", tmp_path / "absent")
    cache = tmp_path / "data" / "cache"
    cache.mkdir(parents=True)
    bs, fs = mappings()
    record = joe("2026-10-02T11:00:00Z")
    for key, r in [("fpljoe", record), ("fpl_bootstrap", bs[0]), ("fpl_fixtures", fs[0])]:
        (cache / f"{key}.json").write_text(json.dumps(dict(body=r["raw"].decode(), sha256=r["sha256"], fetched_at=r["at"])))
    capture = module.capture_market_history()
    assert capture["saved"] == 3 and capture["fresh_fetch"] is False
    assert module.capture_market_history()["saved"] == 0
    result = module.market_history()
    assert result["coverage"]["snapshots"] == 1
    assert all(len(r["points"]) == 1 for r in result["series"])
    assert result["coverage"]["last_extracted_at"] == record["at"]


def test_valid_hash_with_invalid_schema_is_reported_not_served(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    raw = '[]'
    (cache / "fpljoe.json").write_text(json.dumps(dict(body=raw, sha256=hashlib.sha256(raw.encode()).hexdigest(), fetched_at="2026-10-02T12:00:00Z")))
    result = market_history(roots=[tmp_path])
    assert result["diagnostics"]["invalid_payload_schema"] == 1
    assert not result["series"]

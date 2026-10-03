"""Capture boundary and provenance checks without network or real user data."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import gzip
import json

import httpx
import pytest
from fastapi import HTTPException

from backend import app as api_module
from backend import data as data_module
from backend import model
from backend.capture import latest_capture_receipts, read_snapshot, snapshot_paths
from backend.tests.test_minutes_schedule import synthetic_data


NOW = datetime(2026, 10, 10, 9, 50, tzinfo=timezone.utc)
DEADLINE = "2026-10-10T10:00:00Z"


@pytest.fixture(autouse=True)
def isolated_model_cache(monkeypatch):
    monkeypatch.setattr(model, "_projections", None)
    monkeypatch.setattr(model, "_projection_key", None)


def cache_envelope(tmp_path, monkeypatch, *, age_seconds=120):
    monkeypatch.setattr(data_module, "ROOT", tmp_path)
    monkeypatch.setattr(data_module, "CACHE", tmp_path / "data" / "cache")
    monkeypatch.setattr(data_module, "_statuses", {})
    monkeypatch.setattr(data_module.time, "time", lambda: NOW.timestamp())
    monkeypatch.setattr(data_module, "utcnow", lambda: NOW.isoformat())
    body = '{"forecast": 7.25}'
    old = {
        "url": "https://provider.example/forecast",
        "body": body,
        "fetched_at": (NOW - timedelta(seconds=age_seconds)).isoformat(),
        "fetched_epoch": NOW.timestamp() - age_seconds,
        "sha256": hashlib.sha256(body.encode()).hexdigest(),
        "status": "live",
        "bytes": len(body),
    }
    path = data_module.CACHE / "provider.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(old), encoding="utf-8")
    return path, old


def fake_client(monkeypatch, body, *, failure=False):
    calls = []

    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *unused):
            return False

        def get(self, url):
            calls.append(url)
            if failure:
                raise httpx.ConnectError("Simulated acquisition failure")
            return httpx.Response(
                200,
                content=body.encode(),
                request=httpx.Request("GET", url),
                headers={"content-type": "application/json"},
            )

    monkeypatch.setattr(data_module.httpx, "Client", Client)
    return calls


def test_forced_fetch_bypasses_fresh_ttl_and_records_unchanged_content_new_time(
    tmp_path, monkeypatch
):
    path, old = cache_envelope(tmp_path, monkeypatch)
    calls = fake_client(monkeypatch, old["body"])
    assert data_module.fetch(old["url"], "provider", 3600) == old["body"]
    assert calls == []
    assert data_module.source_metadata("provider")["status"] == "cached"
    assert data_module.fetch(old["url"], "provider", 3600, refresh=True) == old["body"]
    assert calls == [old["url"]]
    refreshed = json.loads(path.read_text(encoding="utf-8"))
    assert refreshed["sha256"] == old["sha256"]
    assert refreshed["fetched_at"] == NOW.isoformat() != old["fetched_at"]
    assert refreshed["fetched_epoch"] == NOW.timestamp()
    assert data_module.source_metadata("provider")["status"] == "live"


def test_failed_forced_fetch_labels_stale_without_expiring_saved_envelope(
    tmp_path, monkeypatch
):
    path, old = cache_envelope(tmp_path, monkeypatch)
    before = path.read_bytes()
    calls = fake_client(monkeypatch, old["body"], failure=True)
    assert data_module.fetch(old["url"], "provider", 3600, refresh=True) == old["body"]
    source = data_module.source_metadata("provider")
    assert source["status"] == "stale"
    assert "Simulated acquisition failure" in source["error"]
    assert source["fetched_at"] == old["fetched_at"]
    assert path.read_bytes() == before
    assert data_module.fetch(old["url"], "provider", 3600) == old["body"]
    assert len(calls) == 1  # Failure never expires the previously valid envelope.


def capture_dataset(*, stamp, vendor_points=7, fetched_at=None):
    dataset = synthetic_data()
    dataset["loaded_at"] = stamp
    dataset["bootstrap"]["events"] = [
        {"id": 6, "deadline_time": DEADLINE, "is_next": True, "finished": False}
    ]
    fetched_at = fetched_at or NOW
    dataset["sources"] = {
        key: {
            "url": f"https://source.example/{key}",
            "status": "live",
            "fetched_at": fetched_at.isoformat(),
            "sha256": f"hash-{key}",
        }
        for key in ("fpl_bootstrap", "fpl_fixtures", "fplform_2026-27_gw6")
    }
    dataset["fplform"] = {
        "source_at": fetched_at.isoformat(),
        "players": {
            str(pid): {"points": {"6": vendor_points}, "probabilities": {"6": 0.8}}
            for pid in dataset["players"]
        },
    }
    return dataset


def capture_clock(monkeypatch, *moments):
    clock = iter(moments)

    class CaptureClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return next(clock)

    monkeypatch.setattr(api_module, "datetime", CaptureClock)


def test_capture_freezes_future_targets_without_inventing_vendor_forecasts(
    tmp_path, monkeypatch
):
    dataset = capture_dataset(stamp="all horizons")
    dataset["bootstrap"]["events"].extend(
        [
            {"id": gw, "deadline_time": f"2026-10-{day}T10:00:00Z", "finished": False}
            for gw, day in ((7, "17"), (8, "24"))
        ]
    )
    frozen_inputs(tmp_path, monkeypatch, dataset, dataset)
    capture_clock(
        monkeypatch, NOW, NOW + timedelta(seconds=10), NOW + timedelta(seconds=11)
    )
    result = api_module.save_snapshot(api_module.ForecastRequest())
    record = read_snapshot(tmp_path / "data" / "snapshots" / result["filename"])
    assert result["filename"].endswith(".json.gz")
    assert result["captured_gameweeks"] == [6, 7, 8]
    assert (
        record["future_targets"]["6"]["players"][1]["models"]
        == record["players"][1]["models"]
    )
    for gw in (7, 8):
        target = record["future_targets"][str(gw)]
        assert target["capture_receipt"]["target_gameweek"] == gw
        assert target["capture_receipt"]["eligible_primary"]["FPL Form"] is False
        assert all("FPL Form" not in row["models"] for row in target["players"])
        assert all(
            row["forecast"]["points"] == row["models"]["Live ensemble"]
            for row in target["players"]
        )
    # The stored fixture membership belongs to the capture, including doubles/blanks.
    assert record["future_targets"]["7"]["players"][1]["fixture_ids"] == [11, 12]
    assert record["future_targets"]["8"]["players"][1]["forecast"] == {
        "points": 0.0,
        "xmins": 0.0,
    }
    assert record["future_targets"]["8"]["players"][1]["fixture_ids"] == []


def frozen_inputs(tmp_path, monkeypatch, before, refreshed):
    calls = []

    def get_data(*args, **kwargs):
        calls.append((args, kwargs))
        if kwargs == {"refresh_live": True}:
            return refreshed
        assert not args and not kwargs and len(calls) == 1, (
            "Capture reacquired inputs after freezing its dataset"
        )
        return before

    monkeypatch.setattr(api_module, "ROOT", tmp_path)
    monkeypatch.setattr(api_module, "get_data", get_data)
    monkeypatch.setattr(
        model,
        "get_data",
        lambda: (_ for _ in ()).throw(
            AssertionError("Injected model dataset must not reacquire data")
        ),
    )
    return calls


def test_snapshot_uses_one_refreshed_dataset_for_every_model_and_receipt(
    tmp_path, monkeypatch
):
    before = capture_dataset(
        stamp="before", vendor_points=99, fetched_at=NOW - timedelta(minutes=10)
    )
    refreshed = capture_dataset(
        stamp="refreshed", vendor_points=7, fetched_at=NOW + timedelta(seconds=10)
    )
    before["players"][2]["chance_of_playing_next_round"] = 25
    refreshed["sources"]["fpl_fixtures"]["sha256"] = "new-fixture-hash"
    original = deepcopy(refreshed)
    calls = frozen_inputs(tmp_path, monkeypatch, before, refreshed)
    capture_clock(
        monkeypatch, NOW, NOW + timedelta(seconds=20), NOW + timedelta(seconds=21)
    )
    result = api_module.save_snapshot(api_module.ForecastRequest())
    record = read_snapshot(tmp_path / "data" / "snapshots" / result["filename"])
    assert calls == [((), {}), ((), {"refresh_live": True})]
    assert record["sources"] == refreshed["sources"]
    assert record["capture_receipt"]["dataset_loaded_at"] == "refreshed"
    assert (
        record["capture_receipt"]["sources"]["fpl_bootstrap"]["content_changed"]
        is False
    )
    assert (
        record["capture_receipt"]["sources"]["fpl_fixtures"]["content_changed"] is True
    )
    assert all(
        source["refetched"] for source in record["capture_receipt"]["sources"].values()
    )
    assert all(record["capture_receipt"]["eligible_primary"].values())
    assert record["capture_receipt"]["refresh_requested"] is True
    for row in record["players"]:
        assert row["models"]["FPL Form"] == 7
        assert row["models"]["Component model"] == row["component_forecast"]["points"]
        assert row["models"]["Live ensemble"] == pytest.approx(
            (row["models"]["Component model"] + 7) / 2
        )
    assert (
        next(p for p in record["players"] if p["id"] == 2)["component_forecast"][
            "pplay"
        ]
        > 0.8
    )
    assert refreshed == original


@pytest.mark.parametrize("field,value", [("next_gw", 7), ("season", "2027-28")])
def test_refresh_changing_capture_target_writes_no_file(
    tmp_path, monkeypatch, field, value
):
    before = capture_dataset(stamp="before")
    refreshed = capture_dataset(stamp="refreshed")
    refreshed[field] = value
    frozen_inputs(tmp_path, monkeypatch, before, refreshed)
    capture_clock(monkeypatch, NOW)
    monkeypatch.setattr(
        api_module,
        "forecast_for",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("Changed target must be rejected before model computation")
        ),
    )
    with pytest.raises(HTTPException, match="capture target changed"):
        api_module.save_snapshot(api_module.ForecastRequest())
    assert list(snapshot_paths(tmp_path, "2026-27")) == []


@pytest.mark.parametrize("stage", ["acquisition_or_computation", "serialisation"])
def test_capture_crossing_deadline_writes_no_file(tmp_path, monkeypatch, stage):
    before = capture_dataset(stamp="before")
    refreshed = capture_dataset(stamp="refreshed")
    frozen_inputs(tmp_path, monkeypatch, before, refreshed)
    deadline = datetime.fromisoformat(DEADLINE.replace("Z", "+00:00"))
    moments = (
        [deadline - timedelta(seconds=10), deadline + timedelta(seconds=1)]
        if stage == "acquisition_or_computation"
        else [
            deadline - timedelta(seconds=10),
            deadline - timedelta(seconds=1),
            deadline + timedelta(seconds=1),
        ]
    )
    capture_clock(monkeypatch, *moments)
    with pytest.raises(HTTPException, match="deadline passed"):
        api_module.save_snapshot(api_module.ForecastRequest())
    assert list(snapshot_paths(tmp_path, "2026-27")) == []


def test_no_refresh_capture_exposes_source_ages_and_stale_primary_flags(
    tmp_path, monkeypatch
):
    before = capture_dataset(stamp="cached", fetched_at=NOW - timedelta(minutes=40))
    before["sources"]["fpl_fixtures"]["status"] = "stale"
    calls = frozen_inputs(tmp_path, monkeypatch, before, before)
    capture_clock(
        monkeypatch, NOW, NOW + timedelta(seconds=20), NOW + timedelta(seconds=21)
    )
    result = api_module.save_snapshot(
        api_module.ForecastRequest(), refresh_inputs=False
    )
    receipt = result["capture_receipt"]
    assert calls == [((), {})]
    assert receipt["refresh_requested"] is False
    assert receipt["sources"]["fpl_fixtures"]["status"] == "stale"
    assert receipt["sources"]["fpl_bootstrap"]["age_seconds"] == 2420
    assert all(source["refetched"] is False for source in receipt["sources"].values())
    assert all(eligible is False for eligible in receipt["eligible_primary"].values())
    assert (
        "fpl_fixtures: stale input."
        in receipt["eligibility_reasons"]["Component model"]
    )
    assert any(
        "older than 30 minutes" in reason
        for reason in receipt["eligibility_reasons"]["Live ensemble"]
    )


def test_injected_model_dataset_never_calls_global_acquisition(monkeypatch):
    dataset = synthetic_data()
    before = deepcopy(dataset)
    monkeypatch.setattr(
        model,
        "get_data",
        lambda: (_ for _ in ()).throw(AssertionError("Frozen dataset must be used")),
    )
    result = model.projections(
        None,
        False,
        {"1": {"7": {"conditional_minutes": 90, "availability": 1}}},
        dataset=dataset,
    )
    recovered = next(p for p in result["players"] if p["id"] == 1)["gw"]["7"]
    assert recovered["xmins"] == 180
    assert recovered["pplay"] == 1
    assert dataset == before


def test_default_capture_refreshes_real_acquisition_despite_all_fresh_caches(
    tmp_path, monkeypatch
):
    """Exercise capture→dataset→HTTP refresh, not just the refresh argument."""
    before = capture_dataset(
        stamp="cached-dataset", vendor_points=7, fetched_at=NOW - timedelta(seconds=120)
    )
    bootstrap = {
        **before["bootstrap"],
        "teams": list(before["teams"].values()),
        "elements": list(before["players"].values()),
    }
    form_key = "fplform_2026-27_gw6"
    form_url = "https://provider.example/fplform"
    bodies = {
        "fpl_bootstrap": (
            f"{data_module.FPL}/bootstrap-static/",
            json.dumps(bootstrap),
        ),
        "fpl_fixtures": (
            f"{data_module.FPL}/fixtures/",
            json.dumps(before["fixtures"]),
        ),
        "fpljoe": (
            "https://www.fpljoe.com/api/odds/projections?competition=premier-league&season=2026-27&scope=season%3A2026-27",
            "{}",
        ),
        form_key: (form_url, json.dumps(before["fplform"]["players"])),
    }
    cache = tmp_path / "data" / "cache"
    cache.mkdir(parents=True)
    before["sources"] = {}
    for key, (url, body) in bodies.items():
        envelope = {
            "url": url,
            "body": body,
            "sha256": hashlib.sha256(body.encode()).hexdigest(),
            "fetched_at": (NOW - timedelta(seconds=120)).isoformat(),
            "fetched_epoch": NOW.timestamp() - 120,
            "status": "live",
            "bytes": len(body),
        }
        (cache / f"{key}.json").write_text(json.dumps(envelope), encoding="utf-8")
        before["sources"][key] = {k: v for k, v in envelope.items() if k != "body"}
    monkeypatch.setattr(data_module, "ROOT", tmp_path)
    monkeypatch.setattr(data_module, "CACHE", cache)
    monkeypatch.setattr(data_module, "_dataset", before)
    monkeypatch.setattr(data_module, "_loaded", NOW.timestamp())
    monkeypatch.setattr(data_module, "_statuses", deepcopy(before["sources"]))
    fetched = NOW + timedelta(seconds=5)
    monkeypatch.setattr(data_module.time, "time", lambda: fetched.timestamp())
    monkeypatch.setattr(data_module, "utcnow", lambda: fetched.isoformat())
    monkeypatch.setattr(
        data_module,
        "load_archive",
        lambda season: [r for r in before["history"] if r["season"] == season],
    )
    monkeypatch.setattr(data_module, "load_elevenify", lambda *args, **kwargs: {})
    monkeypatch.setattr(
        data_module, "load_elevenify_reference", lambda *args, **kwargs: {}
    )

    def load_form(season, gw, players, teams, *, refresh=False):
        rows = json.loads(data_module.fetch(form_url, form_key, 3600, refresh=refresh))
        return {
            "players": rows,
            "source_at": data_module.source_metadata(form_key)["fetched_at"],
        }

    monkeypatch.setattr(data_module, "load_fplform", load_form)
    calls = []
    by_url = dict(bodies.values())

    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *unused):
            return False

        def get(self, url):
            calls.append(url)
            assert url in by_url, "Unexpected request outside the mocked live inputs"
            return httpx.Response(
                200, content=by_url[url].encode(), request=httpx.Request("GET", url)
            )

    monkeypatch.setattr(data_module.httpx, "Client", Client)
    monkeypatch.setattr(api_module, "ROOT", tmp_path)
    monkeypatch.setattr(api_module, "get_data", data_module.get_data)
    monkeypatch.setattr(
        model,
        "get_data",
        lambda: (_ for _ in ()).throw(
            AssertionError("Models must use the captured dataset")
        ),
    )
    capture_clock(
        monkeypatch, NOW, NOW + timedelta(seconds=10), NOW + timedelta(seconds=11)
    )
    result = api_module.save_snapshot(api_module.ForecastRequest())
    assert sorted(calls) == sorted(by_url)
    receipt = result["capture_receipt"]
    assert receipt["dataset_loaded_at"] == fetched.isoformat()
    assert all(receipt["eligible_primary"].values())
    for key in bodies:
        source = receipt["sources"][key]
        assert source["fetched_at"] == fetched.isoformat()
        assert source["content_changed"] is False
        assert source["refetched"] is True
        assert source["age_seconds"] == 5


def test_legacy_and_gzip_snapshot_reads_and_receipt_scanner_ignore_corrupt_temps(
    tmp_path,
):
    directory = tmp_path / "data" / "snapshots"
    directory.mkdir(parents=True)
    record = {
        "deadline": DEADLINE,
        "recorded_at": NOW.isoformat(),
        "players": [{"id": 1, "name": "Player Ø"}],
        "capture_receipt": {"eligible_primary": {"Live ensemble": True}},
    }
    plain = directory / "2026-27_gw6_20261010T095000Z.json"
    raw = json.dumps(record, ensure_ascii=False).encode("utf-8")
    plain.write_bytes(raw)
    compressed = directory / "2026-27_gw6_20261010T095000Z.json.gz"
    compressed.write_bytes(gzip.compress(raw, mtime=0))
    assert read_snapshot(plain) == read_snapshot(compressed) == record
    (directory / "2026-27_gw6_zzz-corrupt.json.gz").write_bytes(b"not a gzip file")
    (directory / "2026-27_gw6_zzz-truncated.json.gz").write_bytes(
        gzip.compress(raw, mtime=0)[:-8]
    )
    (directory / "2026-27_gw6_zzz-invalid-deflate.json.gz").write_bytes(
        gzip.compress(raw, mtime=0)[:10] + b"\xff" * 20
    )
    (directory / "2026-27_gw6_zzz-temp.json.gz.tmp").write_bytes(raw)
    (directory / "2026-27_gw6_zzz-temp.json.tmp").write_bytes(raw)
    receipts = latest_capture_receipts(tmp_path, "2026-27")
    assert len(receipts) == 1
    assert receipts[0]["filename"] == compressed.name
    assert receipts[0]["players"] == 1
    assert len(list(snapshot_paths(tmp_path, "2026-27"))) == 5
    with pytest.raises(ValueError, match="Unsupported"):
        read_snapshot(directory / "2026-27_gw6_zzz-temp.json.tmp")

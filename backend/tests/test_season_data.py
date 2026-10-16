"""Official observations and receipts, without loading the forecasting dataset."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from backend import data
from backend import season_data as module


def bootstrap(player_count=2, team_count=2):
    teams = [{"id": i, "code": 100 + i, "name": f"Club {i}", "short_name": f"T{i}"}
             for i in range(1, team_count + 1)]
    return {
        "events": [
            {"id": 38, "deadline_time": "2027-05-23T13:30:00Z"},
            {"id": 1, "deadline_time": "2026-08-21T17:30:00Z"},
        ],
        "teams": teams,
        "elements": [{
            "id": i, "code": 10000 + i, "web_name": f"Player {i}",
            "first_name": "First", "second_name": f"Last {i}",
            "element_type": (i - 1) % 4 + 1, "team": (i - 1) % team_count + 1,
            "team_code": 100 + (i - 1) % team_count + 1,
            "minutes": 90, "total_points": 8, "goals_scored": 25,
            "clean_sheets": 19, "goals_conceded": 27, "now_cost": 65,
            "selected_by_percent": "18.7", "expected_goals": "0.72",
            "expected_assists": "0.00", "ep_next": "12.5", "ep_this": "10",
            "xg90": 0.8, "xa90": 0.7, "expected_goals_per_90": "0.9",
            "price_change_projections": {"future": 2},
        } for i in range(1, player_count + 1)],
    }


def fixture(fid, home, away, hs, aws, *, finished=True, **extra):
    return {"id": fid, "team_h": home, "team_a": away, "team_h_score": hs,
            "team_a_score": aws, "finished": finished, "event": 1, **extra}


@pytest.fixture
def isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(data, "CACHE", tmp_path / "cache")
    monkeypatch.setattr(data, "ROOT", tmp_path)
    monkeypatch.setattr(data, "_statuses", {})
    data.CACHE.mkdir()

    def forbidden(*args, **kwargs):
        raise AssertionError("Season data must not load the model/dataset or refresh a valid cache")

    monkeypatch.setattr(data, "get_data", forbidden)
    monkeypatch.setattr(data, "fetch", forbidden)
    return tmp_path


def write_cache(key, payload, *, age=60, **overrides):
    body = json.dumps(payload, ensure_ascii=False)
    at = datetime.now(timezone.utc) - timedelta(seconds=age)
    meta = {
        "url": f"{data.FPL}/{'bootstrap-static' if key == 'fpl_bootstrap' else 'fixtures'}/",
        "body": body, "sha256": hashlib.sha256(body.encode()).hexdigest(),
        "fetched_at": at.isoformat(), "fetched_epoch": at.timestamp(), "status": "live",
        **overrides,
    }
    (data.CACHE / f"{key}.json").write_text(json.dumps(meta), encoding="utf-8")
    return meta


def client():
    app = FastAPI()
    app.include_router(module.router)
    return TestClient(app)


def test_get_route_preserves_source_and_official_identity_without_shared_state(isolated_cache, monkeypatch):
    boot = bootstrap()
    source = write_cache("fpl_bootstrap", boot)
    fixture_source = write_cache("fpl_fixtures", [fixture(1, 1, 2, 2, 0)])
    sentinel = {"forecast": "untouched"}
    monkeypatch.setattr(data, "_dataset", sentinel)
    before = {path.name: path.read_bytes() for path in data.CACHE.iterdir()}
    response = client().get("/api/season-data")
    assert response.status_code == 200
    result = response.json()
    assert result["season"] == "2026-27"  # Earliest deadline, not current year/list order.
    for key, original in (("source", source), ("fixture_source", fixture_source)):
        assert result[key]["status"] == "cached"
        assert result[key]["hash_verified"] is True
        for field in ("url", "fetched_at", "sha256"):
            assert result[key][field] == original[field]
    player = result["players"][0]
    assert {k: player[k] for k in ("id", "code", "name", "full_name", "position", "position_id", "team", "team_code", "team_name", "team_short")} == {
        "id": 1, "code": 10001, "name": "Player 1", "full_name": "First Last 1",
        "position": "GKP", "position_id": 1, "team": 1, "team_code": 101,
        "team_name": "Club 1", "team_short": "T1",
    }
    assert player["stats"]["price"] == 6.5
    assert player["stats"]["ownership"] == 18.7
    assert player["stats"]["expected_goals"] == 0.72
    assert data._dataset is sentinel
    assert before == {path.name: path.read_bytes() for path in data.CACHE.iterdir()}
    assert data._statuses == {}


@pytest.mark.parametrize("value", [None, "", "  ", "n/a", "nan", "inf", float("nan"), float("inf"), True, [], {}])
def test_missing_invalid_values_stay_null_and_real_zero_survives(value):
    boot = bootstrap()
    boot["elements"][0].update({"assists": value, "selected_by_percent": value, "now_cost": value})
    result = module.build_season_data(boot, [], {}, {})
    stats = result["players"][0]["stats"]
    assert stats["assists"] is None and stats["price"] is None and stats["ownership"] is None
    assert stats["expected_assists"] == 0
    assert stats["tackles"] is None
    assert set(stats) == set(module.PLAYER_FIELDS)
    json.dumps(result, allow_nan=False)


def test_metrics_label_historical_expected_measures_and_do_not_leak_forecasts():
    result = module.build_season_data(bootstrap(), [], {}, {})
    stats = result["players"][0]["stats"]
    assert set(stats).isdisjoint({"ep_next", "ep_this", "xg90", "xa90", "expected_goals_per_90", "price_change_projections", "now_cost", "selected_by_percent"})
    metrics = {m["key"]: m for m in result["available_metrics"] if m["scope"] == "player"}
    assert metrics["expected_goals"]["label"] == "Historical xG"
    assert "not a forecast" in metrics["expected_goals"]["description"]
    assert metrics["price"]["source_field"] == "now_cost"
    assert metrics["ownership"]["unit"] == "%"
    assert metrics["tackles"]["available"] is False
    assert metrics["tackles"]["available_count"] == 0
    assert metrics["minutes"]["available_count"] == 2
    assert result["maps"]["available"] is False and result["maps"]["reason"]


def test_team_results_use_completed_scores_not_player_totals_or_provisional_games():
    fixtures = [
        fixture(1, 1, 2, 2, 0), fixture(2, 2, 1, 1, 1), fixture(3, 1, 2, 0, 3),
        fixture(4, 1, 2, None, None, finished=False, event=None),  # Postponed.
        fixture(5, 2, 1, None, None, finished=False),
        fixture(6, 2, 1, 5, 0, finished=False, finished_provisional=True),
    ]
    result = module.build_season_data(bootstrap(), fixtures, {}, {})
    assert result["teams"][0]["stats"] == {
        "games": 3, "goals_scored": 3, "goals_conceded": 4, "clean_sheets": 1,
        "wins": 1, "draws": 1, "losses": 1, "points": 4, "goal_difference": -1,
    }
    assert result["teams"][1]["stats"] == {
        "games": 3, "goals_scored": 4, "goals_conceded": 3, "clean_sheets": 1,
        "wins": 1, "draws": 1, "losses": 1, "points": 4, "goal_difference": 1,
    }
    assert result["coverage"]["completed_fixtures"] == 3
    assert result["coverage"]["fixtures"] == 6


@pytest.mark.parametrize("scores", [(None, 1), ("", 0), (-1, 0), (0.5, 0), (True, 0)])
def test_incomplete_completed_results_do_not_become_zero_or_partial_team_totals(scores):
    result = module.build_season_data(bootstrap(team_count=3), [
        fixture(1, 1, 2, 3, 0), fixture(2, 1, 2, *scores),
    ], {}, {})
    assert all(v is None for team in result["teams"][:2] for v in team["stats"].values())
    assert result["teams"][2]["stats"]["games"] == 0
    assert result["coverage"]["unusable_completed_fixtures"] == 1


def test_duplicate_completed_fixture_cannot_double_count_team_results():
    game = fixture(1, 1, 2, 2, 0)
    result = module.build_season_data(bootstrap(), [game, game], {}, {})
    assert all(value is None for row in result["teams"] for value in row["stats"].values())
    assert result["coverage"]["unusable_completed_fixtures"] == 1


def test_fixture_snapshot_from_another_season_cannot_reuse_current_club_ids():
    receipt = {"url": "official-fixtures", "fetched_at": "2025-09-01T00:00:00Z", "sha256": "original"}
    result = module.build_season_data(bootstrap(), [
        fixture(1, 1, 2, 3, 0, kickoff_time="2025-08-23T15:00:00Z"),
    ], {}, receipt)
    assert result["coverage"]["team_results_available"] is False
    assert result["fixture_source"]["status"] == "unavailable"
    assert result["fixture_source"]["sha256"] == receipt["sha256"]
    assert all(value is None for team in result["teams"] for value in team["stats"].values())


def test_stale_valid_cache_is_labelled_and_timestamp_preserved(isolated_cache):
    meta = write_cache("fpl_bootstrap", bootstrap(), age=86400)
    write_cache("fpl_fixtures", [], age=86400)
    result = client().get("/api/season-data").json()
    assert result["source"]["status"] == "stale"
    assert result["source"]["fetched_at"] == meta["fetched_at"]
    assert result["source"]["cache_age_seconds"] >= 86400
    assert result["fixture_source"]["status"] == "stale"


def test_missing_optional_fixtures_preserves_players_with_null_team_statistics(isolated_cache, monkeypatch):
    write_cache("fpl_bootstrap", bootstrap())
    calls = []

    def fetch(url, key, ttl, **kwargs):
        calls.append(key)
        return None

    monkeypatch.setattr(data, "fetch", fetch)
    result = client().get("/api/season-data").json()
    assert calls == ["fpl_fixtures"]
    assert len(result["players"]) == 2
    assert result["fixture_source"]["status"] == "unavailable"
    assert all(v is None for team in result["teams"] for v in team["stats"].values())
    assert result["coverage"]["team_results_available"] is False


@pytest.mark.parametrize("invalid", ["hash", "url", "timestamp", "schema", "duplicate_player", "duplicate_code", "team_code", "position"])
def test_invalid_cache_needs_verified_reacquisition_and_is_never_silently_used(isolated_cache, monkeypatch, invalid):
    bad = bootstrap()
    overrides = {}
    if invalid == "hash":
        overrides["sha256"] = "0" * 64
    elif invalid == "url":
        overrides["url"] = "https://other.example/bootstrap-static/"
    elif invalid == "timestamp":
        overrides["fetched_at"] = "2026-08-01T00:00:00"
    elif invalid == "schema":
        bad.pop("elements")
    elif invalid == "duplicate_player":
        bad["elements"][1]["id"] = bad["elements"][0]["id"]
    elif invalid == "duplicate_code":
        bad["elements"][1]["code"] = bad["elements"][0]["code"]
    elif invalid == "team_code":
        bad["elements"][0]["team_code"] = 999
    else:
        bad["elements"][0]["element_type"] = 99
    old = write_cache("fpl_bootstrap", bad, **overrides)
    calls = []

    def fetch(url, key, ttl, **kwargs):
        calls.append((key, kwargs))
        # Simulate data.fetch's stale fallback to the unusable old envelope.
        data._statuses[key] = {**old, "status": "stale"}
        return old["body"]

    monkeypatch.setattr(data, "fetch", fetch)
    response = client().get("/api/season-data")
    assert response.status_code == 503
    assert calls == [("fpl_bootstrap", {"optional": True, "refresh": True})]


def test_absent_cache_acquires_only_two_official_feeds_and_uses_acquisition_receipts(isolated_cache, monkeypatch):
    calls = []
    receipts = {}

    def fetch(url, key, ttl, **kwargs):
        calls.append((url, key))
        meta = write_cache(key, bootstrap() if key == "fpl_bootstrap" else [])
        receipts[key] = meta
        data._statuses[key] = {k: v for k, v in meta.items() if k != "body"}
        return meta["body"]

    monkeypatch.setattr(data, "fetch", fetch)
    response = client().get("/api/season-data")
    assert response.status_code == 200
    assert calls == [(f"{data.FPL}/bootstrap-static/", "fpl_bootstrap"), (f"{data.FPL}/fixtures/", "fpl_fixtures")]
    result = response.json()
    assert result["source"]["status"] == "live"
    assert result["source"]["fetched_at"] == receipts["fpl_bootstrap"]["fetched_at"]
    assert result["source"]["sha256"] == receipts["fpl_bootstrap"]["sha256"]


def test_original_bom_digest_is_preserved_when_fetch_has_decoded_it(isolated_cache):
    meta = write_cache("fpl_bootstrap", bootstrap())
    digest = hashlib.sha256(b"\xef\xbb\xbf" + meta["body"].encode()).hexdigest()
    write_cache("fpl_bootstrap", bootstrap(), sha256=digest)
    write_cache("fpl_fixtures", [])
    result = client().get("/api/season-data").json()
    assert result["source"]["hash_verified"] is True
    assert result["source"]["sha256"] == digest


def test_all_667_players_and_20_clubs_retain_stable_codes_without_filtering(isolated_cache):
    boot = bootstrap(player_count=667, team_count=20)
    before = deepcopy(boot)
    # An unselectable/removed player is still part of the official season pool.
    boot["elements"][-1].update({"removed": True, "can_select": False})
    write_cache("fpl_bootstrap", boot)
    write_cache("fpl_fixtures", [])
    result = client().get("/api/season-data").json()
    assert result["coverage"]["players"] == result["coverage"]["expected_players"] == 667
    assert result["coverage"]["teams"] == result["coverage"]["expected_teams"] == 20
    assert [(p["id"], p["code"], p["team_code"]) for p in result["players"]] == [
        (p["id"], p["code"], p["team_code"]) for p in before["elements"]
    ]
    assert [(t["id"], t["code"]) for t in result["teams"]] == [(t["id"], t["code"]) for t in before["teams"]]

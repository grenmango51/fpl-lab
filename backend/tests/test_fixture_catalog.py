from copy import deepcopy

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from backend import fixture_catalog as module


def dataset():
    def fixture(fid, event, **changes):
        return {"id": fid, "event": event, "team_h": 1, "team_a": 2,
                "kickoff_time": None, "finished": False, **changes}

    return {
        "next_gw": 7, "season": "2026-27",
        "bootstrap": {"events": [{"id": gw, "finished": gw < 7} for gw in range(1, 39)]},
        "fixtures": [fixture(1, 6), fixture(2, 7, finished=True),
                     fixture(71, 7, kickoff_time="2026-10-17T12:00:00Z"),
                     fixture(72, 38), fixture(73, None),
                     fixture(74, 9, team_a=999)],
        "sources": {"fpl_fixtures": {"status": "stale", "fetched_at": "2026-10-16T00:00:00Z"},
                    "fpl_bootstrap": {"status": "cached"}, "vendor": {"unrelated": True}},
    }


def client():
    app = FastAPI()
    app.include_router(module.router)
    return TestClient(app)


def test_original_catalog_includes_unset_both_clubs_and_all_remaining_weeks_without_mutation(monkeypatch):
    original = dataset()
    before = deepcopy(original)
    calls = []

    def existing_get_data(*args, **kwargs):
        calls.append((args, kwargs))
        return original

    monkeypatch.setattr(module, "get_data", existing_get_data)
    result = client().get("/api/fixture-schedule")
    assert result.status_code == 200
    payload = result.json()
    assert calls == [((), {})]  # No forced refresh or additional acquisition.
    assert payload["gameweeks"] == list(range(7, 39))
    assert payload["next_gw"] == 7
    assert payload["season"] == "2026-27"
    assert [row["id"] for row in payload["fixtures"]] == [71, 72, 73, 74]
    assert payload["fixtures"][0] == {"id": 71, "event": 7, "team_h": 1, "team_a": 2,
                                      "kickoff_time": "2026-10-17T12:00:00Z"}
    assert payload["fixtures"][2]["event"] is None
    assert payload["fixtures"][3]["team_a"] == 999  # Visible issue, not silent remapping.
    assert set(payload["sources"]) == {"fpl_fixtures", "fpl_bootstrap"}
    assert payload["sources"]["fpl_fixtures"]["status"] == "stale"
    assert original == before


def test_catalog_is_independent_of_forecasts_and_returns_new_receipts():
    original = dataset()
    result = module.build_fixture_catalog(original)
    result["sources"]["fpl_fixtures"]["status"] = "changed"
    result["fixtures"][0]["event"] = None
    assert original["sources"]["fpl_fixtures"]["status"] == "stale"
    assert original["fixtures"][2]["event"] == 7


@pytest.mark.parametrize("patch", [
    {"id": "71"}, {"id": True}, {"team_h": None}, {"team_a": 1}, {"event": 7.0}, {"event": "7"},
])
def test_malformed_official_identity_is_explicitly_unavailable(monkeypatch, patch):
    original = dataset()
    original["fixtures"][2].update(patch)
    monkeypatch.setattr(module, "get_data", lambda: original)
    response = client().get("/api/fixture-schedule")
    assert response.status_code == 503


def test_finished_event_is_excluded_even_if_fixture_flag_lags():
    original = dataset()
    original["bootstrap"]["events"][6]["finished"] = True
    result = module.build_fixture_catalog(original)
    assert 7 not in result["gameweeks"]
    assert 71 not in [row["id"] for row in result["fixtures"]]


def test_provisionally_finished_fixture_is_not_offered_for_restore_or_editing():
    original = dataset()
    original["fixtures"][2]["finished_provisional"] = True
    result = module.build_fixture_catalog(original)
    assert 7 in result["gameweeks"]
    assert 71 not in [row["id"] for row in result["fixtures"]]
    assert [row["id"] for row in result["fixtures"]] == [72, 73, 74]


def test_duplicate_official_fixture_identity_is_not_silently_collapsed(monkeypatch):
    original = dataset()
    original["fixtures"].append(deepcopy(original["fixtures"][2]))
    monkeypatch.setattr(module, "get_data", lambda: original)
    assert client().get("/api/fixture-schedule").status_code == 503

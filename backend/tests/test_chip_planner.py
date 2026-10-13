"""Fixed-plan chip placement retains full squad EV and official allowances."""

from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from backend import app as api_module
from backend.chip_planner import recommend_chips
from backend.scenarios import apply_stat_schedule
from backend.scoring import team_points
from backend.tests.test_autosubs import setup


def fixed_plan(gameweeks=(7, 8)):
    starters, bench, lookup = setup()
    for player in lookup.values():
        player.update({"team": player["id"] % 5 + 1, "price": 4, "name": str(player["id"])})
        player["gw"] = {
            str(gw): {"points": 2, "pplay": 1, "p60": 1, "xmins": 90}
            for gw in gameweeks
        }
    weeks = [{
        "gw": gw, "squad": list(lookup), "starters": starters[:], "bench": bench[:],
        "captain": 5, "vice": 6, "chip": "none", "hits": 0,
    } for gw in gameweeks]
    return list(lookup.values()), weeks


def test_joint_chip_enumeration_beats_greedy_captain_placement_and_prevents_collision():
    players, weeks = fixed_plan()
    lookup = {p["id"]: p for p in players}
    lookup[5]["gw"]["7"]["points"] = 10
    lookup[5]["gw"]["8"]["points"] = 9
    for pid in weeks[0]["bench"]:
        lookup[pid]["gw"]["7"]["points"] = 3.5
        lookup[pid]["gw"]["8"]["points"] = 0.25
    result = recommend_chips(weeks, players)
    assert result["chips"] == {"7": "benchboost", "8": "triplecaptain"}
    assert result["improvement"] == pytest.approx(23)
    assert len({item["gw"] for item in result["recommendations"]}) == 2
    assert result["candidate_counts"]["triplecaptain"] == result["candidate_counts"]["benchboost"] == 2
    assert result["candidate_counts"]["joint_combinations"] == 8  # 7 legal first-half pairs plus empty second half.


def test_one_week_uses_only_the_better_chip():
    players, weeks = fixed_plan((7,))
    result = recommend_chips(weeks, players)
    assert result["chips"] == {"7": "benchboost"}
    assert result["improvement"] == 8
    assert len(result["recommendations"]) == 1


def test_used_allowances_in_both_halves_return_no_change():
    players, weeks = fixed_plan((23, 24))
    history = [
        {"chip": "triplecaptain", "gw": 1}, {"chip": "benchboost", "gw": 2},
        {"chip": "triplecaptain", "gw": 20}, {"chip": "benchboost", "gw": 21},
    ]
    result = recommend_chips(weeks, players, history)
    assert result["status"] == "no-change"
    assert result["chips"] == {} and result["recommendations"] == []
    assert result["improvement"] == 0
    assert all(window["already_used"] and not window["gameweeks"] for window in result["available_windows"])


def test_manual_chips_preserved_and_never_used_as_automatic_candidates():
    players, weeks = fixed_plan((7, 8, 9, 10))
    for week, chip in zip(weeks, ("wildcard", "freehit", "triplecaptain", "none")):
        week["chip"] = chip
    result = recommend_chips(weeks, players)
    assert result["chips"] == {"7": "wildcard", "8": "freehit", "9": "triplecaptain", "10": "benchboost"}
    assert result["recommendations"] == [{"chip": "benchboost", "gw": 10, "half": 1, "marginal_points": 8}]


def test_separate_half_allowances_allow_four_noncolliding_placements():
    players, weeks = fixed_plan((18, 19, 20, 21))
    result = recommend_chips(weeks, players)
    assert len(result["recommendations"]) == 4
    for half in (1, 2):
        selected = [r for r in result["recommendations"] if r["half"] == half]
        assert {r["chip"] for r in selected} == {"triplecaptain", "benchboost"}
        assert len({r["gw"] for r in selected}) == 2
    assert result["improvement"] == 20


def test_sparse_candidate_horizon_never_invents_unprovided_weeks():
    players, weeks = fixed_plan((7, 11, 24))
    result = recommend_chips(weeks, players)
    assert set(map(int, result["chips"])).issubset({7, 11, 24})
    assert all(set(window["gameweeks"]).issubset({7, 11, 24}) for window in result["available_windows"])
    assert len(result["recommendations"]) == 3


def test_captain_absence_uses_extra_vice_fallback_in_tc_marginal():
    players, weeks = fixed_plan((7,))
    lookup = {p["id"]: p for p in players}
    lookup[5]["gw"]["7"].update({"pplay": 0, "points": 0})
    lookup[6]["gw"]["7"]["points"] = 8
    result = recommend_chips(weeks, players, [{"chip": "benchboost", "gw": 1}])
    assert result["chips"] == {"7": "triplecaptain"}
    assert result["recommendations"][0]["marginal_points"] == 8
    assert result["improvement"] == 8
    assert result["weeks"][0]["captain"] == 5


def test_bb_marginal_removes_autosubs_without_adding_extra_captain():
    players, weeks = fixed_plan((7,))
    lookup = {p["id"]: p for p in players}
    for pid in (1, 2):
        lookup[pid]["gw"]["7"].update({"pplay": 0, "points": 0})
    for pid, points in ((12, 2), (13, 20), (14, 6), (15, 3)):
        lookup[pid]["gw"]["7"]["points"] = points
    baseline = team_points(weeks[0]["starters"], weeks[0]["bench"], 5, 6, lookup, 7)
    assert baseline["autosub_points"] == 8
    result = recommend_chips(weeks, players, [{"chip": "triplecaptain", "gw": 1}])
    assert result["chips"] == {"7": "benchboost"}
    assert result["improvement"] == pytest.approx(31 - baseline["autosub_points"])


def test_zero_or_negative_chip_gain_does_not_spend_an_allowance():
    players, weeks = fixed_plan((7, 8))
    for player in players:
        for forecast in player["gw"].values():
            forecast["points"] = 0
    result = recommend_chips(weeks, players)
    assert result["recommendations"] == [] and result["improvement"] == 0


def test_no_mutation_and_deterministic_recommendations():
    players, weeks = fixed_plan()
    frozen = deepcopy((players, weeks))
    result = recommend_chips(weeks, players)
    assert result == recommend_chips(weeks, players)
    assert (players, weeks) == frozen


def test_api_consumes_stat_override_and_freezes_one_payload(monkeypatch):
    players, weeks = fixed_plan()
    players[4]["gw"]["7"]["points"] = 20
    for player in players:
        for forecast in player["gw"].values():
            parts = {"appearance": 2, "goals": 0, "assists": 0, "clean_sheet": 0,
                     "defensive_contribution": 0, "bonus": 0, "saves": 0, "penalty_saves": 0, "deductions": 0}
            parts["provider_adjustment"] = forecast["points"] - 2
            forecast.update({"components": parts, "fixtures": [{
                "id": 1, "xg": 0, "xa": 0, "cs": 0.3, "points": forecast["points"],
                "components": dict(parts), "pplay": 1, "p60": 1, "xmins": 90,
            }]})
    payload = {"players": players, "gameweeks": [7, 8], "next_gw": 7, "model_version": "test", "limitations": []}
    calls = []

    def forecast(request):
        calls.append(request)
        return apply_stat_schedule(payload, request.model_dump(exclude_none=True)["stat_schedule"])

    monkeypatch.setattr(api_module, "forecast_for", forecast)
    body = {"base_squad": weeks[0]["squad"], "bank": 40, "free_transfers": 3,
            "weeks": weeks, "stat_schedule": {"5": {"8": {"expected_points": 30}}}}
    response = TestClient(api_module.app).post("/api/chips/recommend", json=body)
    assert response.status_code == 200, response.text
    result = response.json()
    assert len(calls) == 1
    assert result["chips"] == {"7": "benchboost", "8": "triplecaptain"}
    assert result["improvement"] == pytest.approx(38)
    assert result["recommended_net_points"] == pytest.approx(sum(w["net_points"] for w in result["weeks"]))
    assert all(week["bank"] == 40 and week["hits"] == 0 for week in result["weeks"])
    assert [week["next_free_transfers"] for week in result["weeks"]] == [4, 5]
    assert result["weeks"][1]["vice_points"] == 0
    assert [week["chip"] for week in weeks] == ["none", "none"]


def test_endpoint_validates_initial_plan_and_duplicate_history(monkeypatch):
    players, weeks = fixed_plan()
    monkeypatch.setattr(api_module, "forecast_for", lambda _: {"players": players, "gameweeks": [7, 8]})
    client = TestClient(api_module.app)
    body = {"base_squad": weeks[0]["squad"], "bank": 40, "weeks": deepcopy(weeks)}
    body["weeks"][0]["captain"] = 12  # Reserve keeper.
    assert client.post("/api/chips/recommend", json=body).status_code == 422
    body["weeks"] = weeks
    body["used_chips"] = [{"chip": "triplecaptain", "gw": 1}, {"chip": "triplecaptain", "gw": 2}]
    response = client.post("/api/chips/recommend", json=body)
    assert response.status_code == 422
    assert "once per half" in response.json()["detail"]

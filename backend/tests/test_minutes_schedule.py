"""User assumptions alter appearance states, not inferred injury recovery dates."""

from copy import deepcopy

import pytest

from backend import model
from backend.ensemble import blend_forecasts


def synthetic_data():
    teams = {
        1: {"id": 1, "short_name": "AAA", "name": "Team A", "code": 1},
        2: {"id": 2, "short_name": "BBB", "name": "Team B", "code": 2},
    }
    players = {}
    history = []
    for pid, pos in ((1, 2), (2, 3)):
        players[pid] = {
            "id": pid,
            "code": 1000 + pid,
            "element_type": pos,
            "team": pid,
            "chance_of_playing_next_round": 0 if pid == 1 else 100,
            "status": "i" if pid == 1 else "a",
            "web_name": f"Player {pid}",
            "first_name": "Player",
            "second_name": str(pid),
            "now_cost": 50,
            "selected_by_percent": "10",
            "form": "4",
            "total_points": 12,
            "minutes": 270,
        }
        for i, season in enumerate(("2025-26", "2026-27", "2026-27", "2026-27")):
            history.append(
                {
                    "code": 1000 + pid,
                    "position": pos,
                    "season": season,
                    "minutes": 90,
                    "fixture": i + 1,
                    "team": teams[pid]["short_name"],
                    "opponent": teams[3 - pid]["short_name"],
                    "date": f"2026-0{5 if i == 0 else 8}-{i + 1:02d}",
                    "home": pid == 1,
                    "expected_goals": 0.2,
                    "expected_assists": 0.1,
                    "expected_goals_conceded": 0.2,
                    "team_goals": 1,
                    "opponent_goals": 1,
                    "total_points": 4,
                    "defensive_contribution": 15,
                }
            )
    fixtures = [
        {
            "id": i + 10,
            "event": gw,
            "team_h": 1,
            "team_a": 2,
            "finished": False,
            "team_h_difficulty": 2,
            "team_a_difficulty": 2,
            "kickoff_time": f"2026-10-{i + 10:02d}T12:00:00Z",
        }
        for i, gw in enumerate((6, 7, 7, 9, 11))
    ]
    return {
        "loaded_at": "synthetic schedule test",
        "next_gw": 6,
        "season": "2026-27",
        "players": players,
        "teams": teams,
        "history": history,
        "fixtures": fixtures,
        "joe": {},
        "bootstrap": {"events": []},
        "sources": [],
    }


@pytest.fixture
def data(monkeypatch):
    value = synthetic_data()
    monkeypatch.setattr(model, "get_data", lambda: value)
    monkeypatch.setattr(model, "_projections", None)
    monkeypatch.setattr(model, "_projection_key", None)
    return value


def forecast(result, pid=1, gw=6):
    return next(p for p in result["players"] if p["id"] == pid)["gw"][str(gw)]


def test_duration_does_not_restore_official_zero_availability(data):
    result = model.projections(
        {"1": 90}, False, {"1": {"7": {"conditional_minutes": 90}}}
    )
    assert forecast(result)["points"] == 0
    assert forecast(result, gw=7)["xmins"] == 0
    assert forecast(result, gw=7)["minutes_scenario"]["availability"] == 0


def test_explicit_recovery_only_affects_selected_week_and_reconciles_components(data):
    result = model.projections({"1": 90}, False, {"1": {"7": {"availability": 1}}})
    week = forecast(result, gw=7)
    assert week["xmins"] == 180
    assert week["pplay"] == week["p60"] == 1
    assert week["points"] == pytest.approx(sum(week["components"].values()))
    assert week["points"] == pytest.approx(sum(f["points"] for f in week["fixtures"]))
    assert all(f["xmins"] == 90 and f["p60"] == 1 for f in week["fixtures"])
    assert forecast(result)["points"] == forecast(result, gw=9)["points"] == 0
    scenario = week["minutes_scenario"]
    assert scenario["conditional_minutes"] == 90
    assert scenario["availability_source"] == "user-assumed"


@pytest.mark.parametrize("minutes,pplay,p60", [(0, 0, 0), (59, 0.5, 0), (60, 0.5, 0.5)])
def test_appearance_and_clean_sheet_thresholds(data, minutes, pplay, p60):
    result = model.projections(
        None, False, {"1": {"6": {"conditional_minutes": minutes, "availability": 0.5}}}
    )
    week = forecast(result)
    assert week["xmins"] == minutes * 0.5
    assert week["pplay"] == pplay
    assert week["p60"] == p60
    assert week["components"]["appearance"] == 2 * p60 + pplay - p60
    assert (week["components"]["clean_sheet"] > 0) == (minutes >= 60)


def test_availability_only_keeps_automatic_duration_and_blanks_zero(data):
    result = model.projections(
        None, False, {"1": {"7": {"availability": 0.5}, "8": {"availability": 1}}}
    )
    week = forecast(result, gw=7)
    assert 0 < week["xmins"] < 90
    assert week["pplay"] == pytest.approx(1 - (1 - week["fixtures"][0]["pplay"]) ** 2)
    assert week["minutes_scenario"]["conditional_minutes"] is None
    blank = forecast(result, gw=8)
    assert blank["points"] == blank["xmins"] == blank["pplay"] == blank["p60"] == 0
    assert blank["fixtures"] == []


def test_schedule_cache_is_canonical_and_baseline_remains_immutable(data, monkeypatch):
    baseline = model.projections(None, False)
    original = deepcopy(baseline)
    calls = []
    original_profile = model.player_profile

    def counted_profile(*args, **kwargs):
        calls.append(1)
        return original_profile(*args, **kwargs)

    monkeypatch.setattr(model, "player_profile", counted_profile)
    a = model.projections(
        None,
        False,
        {
            "1": {
                "7": {"availability": 1, "conditional_minutes": 90},
                "9": {"availability": 1},
            }
        },
    )
    b = model.projections(
        None,
        False,
        {
            "1": {
                "9": {"availability": 1.0},
                "7": {"conditional_minutes": 90.0, "availability": 1.0},
            }
        },
    )
    assert a is b
    assert len(calls) == len(data["players"])  # Rates fit once per player, not per GW.
    assert baseline == original
    assert model.projections(None, False) == original


@pytest.mark.parametrize(
    "schedule",
    [
        {"999": {"6": {"availability": 1}}},
        {"1": {"5": {"availability": 1}}},
        {"1": {"7": {}}},
        {"1": {"7": {"availability": float("nan")}}},
        {"1": {"7": {"conditional_minutes": float("inf")}}},
        {"1": {"7": {"conditional_minutes": -1}}},
        {"1": {"7": {"availability": 1.01}}},
        {"1": {"7": {"availability": True}}},
        {"1": {"7": {"recovery_date": "2026-10-20"}}},
    ],
)
def test_invalid_direct_schedules_are_rejected(data, schedule):
    with pytest.raises(ValueError):
        model.projections(None, False, schedule)


def test_manual_weeks_bypass_direct_extrapolated_and_layered_probabilities(data):
    schedule = {"2": {"7": {"conditional_minutes": 59}, "9": {"availability": 0.5}}}
    base = model.projections(None, False, schedule)
    original = deepcopy(base)
    anchors = {"2": {"6": forecast(base, 2, 6)["points"] * 2, "7": 100}}
    probabilities = {"2": {"6": 0.2, "7": 0.1}}
    provider = blend_forecasts(
        base,
        anchors,
        1,
        "FPL Form",
        probabilities=probabilities,
        minutes_schedule=schedule,
    )
    imported = blend_forecasts(
        provider,
        anchors,
        0.5,
        "CSV",
        probabilities=probabilities,
        minutes_schedule=schedule,
    )
    for gw in (7, 9):
        assert forecast(provider, 2, gw) == forecast(base, 2, gw)
        assert forecast(imported, 2, gw) == forecast(base, 2, gw)
    assert forecast(provider, 2, 6)["points"] == anchors["2"]["6"]
    assert forecast(provider, 2, 6)["pplay"] == 0.2
    future = forecast(provider, 2, 11)
    assert future["prediction_source"]["kind"] == "extrapolated"
    assert future["prediction_source"]["ratio"] == pytest.approx(2)
    assert future["prediction_source"]["anchor_gameweeks"] == [6]
    assert base == original


def test_parallel_reference_preserves_other_weeks_across_provider_csv_layers(data):
    """A local change must not drop its ordinary anchors from future calibration."""
    schedule = {
        "2": {
            "6": {"conditional_minutes": 0},
            "7": {"conditional_minutes": 59, "availability": 0.2},
            "9": {"availability": 0.2},
        }
    }
    reference_base = model.projections(None, False)
    scheduled_base = model.projections(None, False, schedule)
    originals = deepcopy((reference_base, scheduled_base))
    provider_anchors = {
        "2": {
            "6": forecast(reference_base, 2, 6)["points"] * 1.8,
            "7": forecast(reference_base, 2, 7)["points"] * 0.8,
        }
    }
    provider_probabilities = {"2": {"6": 0.1}}
    reference_provider = blend_forecasts(
        reference_base,
        provider_anchors,
        0.6,
        "FPL Form",
        probabilities=provider_probabilities,
    )
    scheduled_provider = blend_forecasts(
        scheduled_base,
        provider_anchors,
        0.6,
        "FPL Form",
        probabilities=provider_probabilities,
        minutes_schedule=schedule,
        calibration_payload=reference_base,
    )
    csv_anchors = {
        "2": {
            "6": forecast(reference_provider, 2, 6)["points"] * 1.4,
            "7": forecast(reference_provider, 2, 7)["points"] * 0.7,
            "9": forecast(reference_provider, 2, 9)["points"] * 0.5,
        }
    }
    csv_probabilities = {"2": {"6": 0.8, "9": 0.6}}
    reference_csv = blend_forecasts(
        reference_provider,
        csv_anchors,
        0.5,
        "CSV",
        probabilities=csv_probabilities,
    )
    scheduled_csv = blend_forecasts(
        scheduled_provider,
        csv_anchors,
        0.5,
        "CSV",
        probabilities=csv_probabilities,
        minutes_schedule=schedule,
        calibration_payload=reference_provider,
    )
    for reference, scheduled in (
        (reference_provider, scheduled_provider),
        (reference_csv, scheduled_csv),
    ):
        for player in reference["players"]:
            for gw in player["gw"]:
                expected = (
                    forecast(scheduled_base, player["id"], int(gw))
                    if gw in schedule.get(str(player["id"]), {})
                    else player["gw"][gw]
                )
                assert forecast(scheduled, player["id"], int(gw)) == expected
    assert forecast(scheduled_csv, 2, 6)["points"] == 0
    assert forecast(scheduled_csv, 2, 11)["prediction_source"]["anchor_gameweeks"] == [
        6,
        7,
        9,
    ]
    assert (
        forecast(scheduled_csv, 2, 11)["pplay"]
        == forecast(reference_csv, 2, 11)["pplay"]
    )
    assert (reference_base, scheduled_base) == originals


def test_calibration_reference_requires_scheduled_player(data):
    schedule = {"2": {"6": {"conditional_minutes": 0}}}
    base = model.projections(None, False, schedule)
    with pytest.raises(ValueError, match="missing a scheduled player"):
        blend_forecasts(
            base,
            {"2": {"6": 10}},
            1,
            "FPL Form",
            minutes_schedule=schedule,
            calibration_payload={"players": []},
        )

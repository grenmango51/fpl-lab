"""Fitted v0.3 sub-models: valid distributions, causal training cases, live rows."""

import math

import pytest
from scipy import stats

from backend import fit
from backend import forecast_model as F
from backend.availability import absence_censored_rows
from backend.data import event_rows
from backend.model import attach_team_xg


def history(minutes, season="2025-26", start_gw=1):
    return [
        {"season": season, "gw": start_gw + i, "minutes": m, "starts": int(m >= 45),
         "team": "AAA", "price": 6.0, "expected_goals": 0.3 * m / 90,
         "expected_assists": 0.1 * m / 90, "goals_scored": 0, "assists": 0,
         "bonus": 0, "saves": 0, "yellow_cards": 0, "defensive_contribution": 0}
        for i, m in enumerate(minutes)
    ]


def probabilities(minutes, lead=1, pos=3):
    state = F.player_state(history(minutes), "2025-26")
    return F.minutes_probabilities(F.role_vector(state, 6.0, pos, False), lead)


def test_fitted_params_are_committed():
    assert F.PARAMS is not None
    assert F.PARAMS["minutes"]["features"] == F.MINUTES_FEATURES
    assert len(F.PARAMS["minutes"]["mean"]) == len(F.MINUTES_FEATURES)
    assert set(F.PARAMS["availability"]) >= set(F.FLAG_LEVELS)


@pytest.mark.parametrize("lead", [1, 4, 12, 20, 30])
def test_minutes_probabilities_form_a_distribution(lead):
    result = probabilities([90] * 10, lead)
    assert len(result) == 3
    assert all(0 < p < 1 for p in result)
    assert sum(result) == pytest.approx(1)


def test_minutes_horizon_is_capped_and_decays():
    assert probabilities([90] * 10, 30) == probabilities([90] * 10, 20)
    assert probabilities([90] * 10, 12)[2] < probabilities([90] * 10, 1)[2]


def test_dropped_player_is_less_likely_to_start_than_regular():
    regular = probabilities([90] * 10)
    dropped = probabilities([90] * 6 + [0] * 4)
    assert dropped[2] < regular[2]
    assert dropped[0] > regular[0]


def test_player_state_streaks_and_windows():
    state = F.player_state(history([90, 90, 20, 0, 0]), "2025-26")
    assert state["zero_streak"] == 2
    assert state["since_start"] == 3
    assert state["m3"] == pytest.approx(20 / 270)
    assert state["p10"] == pytest.approx(3 / 5)
    assert state["cur_n"] == 5 and state["prev_n"] == 0


@pytest.mark.parametrize("threshold,mean,k", [(10, 8.0, 20), (12, 5.5, 20), (1, 0.4, 3)])
def test_negative_binomial_tail_matches_scipy(threshold, mean, k):
    p = k / (k + mean)
    assert F.negative_binomial_tail(threshold, mean, k) == pytest.approx(
        stats.nbinom.sf(threshold - 1, k, p), abs=1e-12
    )


def test_dc_probability_is_zero_for_keepers_and_rises_with_minutes():
    assert F.dc_hit_probability(10, 90, 1, 20) == 0
    assert F.dc_hit_probability(10, 90, 2, 20) > F.dc_hit_probability(10, 45, 2, 20) > 0


def test_clean_sheet_probability_falls_with_expected_conceded():
    assert F.clean_sheet_probability(0.6) > F.clean_sheet_probability(1.6)
    a, b = F.PARAMS["clean_sheet"]
    assert F.clean_sheet_probability(1.0) == pytest.approx(1 / (1 + math.exp(-a)))


def test_training_origins_use_only_earlier_gameweeks():
    rows = []
    for season in ("2023-24", "2024-25"):
        for gw in range(1, 7):
            for code, team, opponent, home in ((1, "AAA", "BBB", True), (2, "BBB", "AAA", False)):
                rows.append({
                    "season": season, "gw": gw, "code": code, "position": 3, "team": team,
                    "opponent": opponent, "home": home, "price": 6.0, "minutes": 90,
                    "fixture": f"{season}:{gw}",
                    "date": f"{season[:4]}-09-{gw:02d}T15:00:00Z",
                    "team_goals": 1, "opponent_goals": 0, "expected_goals": 0.2,
                })
    cases = list(fit.origins(attach_team_xg(rows), ["2024-25"], horizons=(1, 3)))
    assert cases
    for case in cases:
        origin = (case["season"], case["gw"])
        assert all((r["season"], r["gw"]) < origin for r in case["prior"])
        for h, target, _gf, _ga in case["targets"]:
            assert (target["season"], target["gw"]) == (case["season"], case["gw"] + h - 1)


def test_only_flagged_players_have_trailing_absence_censored():
    rows = history([90, 90, 0, 0])
    injured = {"status": "i", "chance_of_playing_next_round": 0}
    available = {"status": "a", "chance_of_playing_next_round": None}
    assert len(absence_censored_rows(rows, injured)) == 2
    assert len(absence_censored_rows(rows, available)) == 4


def test_event_rows_include_provisionally_finished_fixtures():
    teams = {1: {"short_name": "AAA"}, 2: {"short_name": "BBB"}, 3: {"short_name": "CCC"},
             4: {"short_name": "DDD"}}
    players = {
        10: {"code": 110, "team": 1, "element_type": 3, "now_cost": 60},
        20: {"code": 120, "team": 3, "element_type": 3, "now_cost": 60},
    }
    fixtures = [
        {"id": 1, "event": 7, "team_h": 1, "team_a": 2, "finished": False,
         "finished_provisional": True, "kickoff_time": "2026-10-03T14:00:00Z",
         "team_h_score": 2, "team_a_score": 0},
        {"id": 2, "event": 7, "team_h": 3, "team_a": 4, "finished": False,
         "finished_provisional": False, "kickoff_time": "2026-10-04T14:00:00Z",
         "team_h_score": None, "team_a_score": None},
    ]
    live = {"elements": [
        {"id": 10, "stats": {"minutes": 90, "total_points": 6}, "explain": [{"fixture": 1}]},
        {"id": 20, "stats": {"minutes": 0, "total_points": 0}, "explain": []},
    ]}
    rows = event_rows(7, live, fixtures, players, teams, "2026-27")
    assert [(r["code"], r["provisional"], r["team_goals"]) for r in rows] == [(110, True, 2)]


@pytest.mark.parametrize("status,chance,level", [
    ("a", None, "available"), ("a", 100, "available"), ("d", 75, "d75"), ("d", 50, "d50"),
    ("d", 25, "d25"), ("i", 0, "out"), ("s", None, "out"), ("u", 0, None), ("n", None, None),
])
def test_flag_categories(status, chance, level):
    assert F.flag_category(status, chance) == level


def test_fitted_availability_is_bounded_and_recovers_with_lead():
    assert F.availability_factor(1, "available", 0.9) == 1
    assert F.availability_factor(1, None, 0.9) == 0
    out = [F.availability_factor(lead, "out", 0.9) for lead in (1, 2, 4, 12, 30)]
    assert 0 <= out[0] < 0.05 and out[0] < out[1] < out[2] < out[3] <= 1
    assert out[4] == F.availability_factor(20, "out", 0.9)
    levels = [F.availability_factor(1, level, 0.9) for level in ("d25", "d50", "d75")]
    assert levels == sorted(levels)
    # Regulars come back from a flag sooner than fringe players.
    assert F.availability_factor(4, "out", 0.95) > F.availability_factor(4, "out", 0.5)


def test_flagged_return_shifts_appearances_toward_cameos():
    base = F.role_vector(F.player_state(history([90] * 10), "2025-26"), 6.0, 3, False)
    available = F.minutes_probabilities(base, 1)
    doubtful = F.minutes_probabilities(base, 1, flag="d50")
    assert sum(doubtful) == pytest.approx(1)
    assert doubtful[0] == pytest.approx(available[0])
    assert doubtful[2] < available[2] and doubtful[1] > available[1]


def test_fitted_availability_keeps_dated_returns_and_suspensions():
    from backend.model import fitted_fixture_availability

    base = F.role_vector(F.player_state(history([90] * 10), "2025-26"), 6.0, 3, False)
    dated = {"value": 0, "source": "official news return-date assumption"}
    injured = {"status": "i", "chance_of_playing_next_round": 0}
    assert fitted_fixture_availability(dated, injured, base, 2) is dated
    undated = {"value": 0.4, "source": "unknown-return planning decay"}
    assert fitted_fixture_availability(undated, injured, None, 4) is undated
    fitted = fitted_fixture_availability(undated, injured, base, 4)
    assert fitted["source"] == "fitted flag availability model"
    assert fitted["flag"] == "out"
    selection = 1 - F.minutes_probabilities(base, 4)[0]
    assert fitted["value"] == F.availability_factor(4, "out", selection)
    suspended = {"status": "s", "chance_of_playing_next_round": 0}
    declared = {"value": 0, "source": "official next-round availability"}
    assert fitted_fixture_availability(declared, suspended, base, 1) is declared


def test_availability_fit_recovers_a_known_curve():
    import numpy as np

    rng = np.random.default_rng(0)
    base = np.array([F.role_vector(F.player_state(history(m), "2025-26"), 6.0, 3, False)
                     for m in ([90] * 10, [90, 0, 70, 90, 20, 90, 90, 0, 90, 60])])
    n = 6000
    state = rng.integers(0, 2, n)
    flags = rng.integers(1, len(F.FLAG_LEVELS) + 1, n)
    h = rng.choice([1, 2, 4, 8], n)
    examples = {"base": base[state], "states": {"flag": flags.astype(float)},
                "fixtures": {"state": np.arange(n), "h": h}}
    P = fit.minutes_matrix_probabilities(examples, np.arange(n), F.PARAMS["minutes"])
    truth = 1 / (1 + np.exp(-(-1.0 + 1.2 * np.log(h))))
    u = rng.random(n)
    played = u < truth * (1 - P[:, 0])
    long = rng.random(n) < P[:, 2] / (1 - P[:, 0])
    examples["fixtures"]["a_minutes"] = np.where(played, np.where(long, 90, 20), 0)
    fitted = fit.fit_availability(examples, np.ones(n, bool), F.PARAMS["minutes"])
    params = {**F.PARAMS, "availability": fitted}
    for level in F.FLAG_LEVELS:
        for lead in (2, 8):
            for selection in (P[state == 0, 0], P[state == 1, 0]):
                assert F.availability_factor(lead, level, 1 - selection[0], params) == pytest.approx(
                    1 / (1 + math.exp(-(-1.0 + 1.2 * math.log(lead)))), abs=0.08)
        shift = fitted[level]["long_shift"]
        assert abs(shift[0] + shift[1] * math.log(4)) < 0.5


def test_flag_weeks_failing_validation_are_dropped(monkeypatch):
    rows = [{"season": "2024-25", "code": code, "gw": gw, "minutes": minutes}
            for code in range(40) for gw, minutes in ((2, 0), (3, 90 if code < 10 else 0))]
    weeks = {code: {1: ("i", 0.0, ""), 2: ("i", 0.0, "")} for code in range(40)}
    monkeypatch.setattr(fit, "load_flag_archive", lambda season: weeks if season == "2024-25" else {})
    assert sorted(fit.training_flags(rows)) == [("2024-25", 1)]

import pytest

from backend.scoring import appearance, team_points


def setup():
    # 3-4-3; bench keeper, MID, DEF, DEF.
    positions = [1] + [2] * 3 + [3] * 4 + [4] * 3 + [1, 3, 2, 2]
    lookup = {
        i: {"id": i, "position_id": pos, "pplay": 1, "gw": {"6": {"points": 2.0}}}
        for i, pos in enumerate(positions, 1)
    }
    return list(range(1, 12)), [12, 13, 14, 15], lookup


def absent(lookup, i):
    lookup[i]["pplay"] = 0
    lookup[i]["gw"]["6"]["points"] = 0


def test_minimum_defenders_skip_first_midfielder():
    starters, bench, players = setup()
    absent(players, 2)
    players[13]["gw"]["6"]["points"] = 20
    players[14]["gw"]["6"]["points"] = 7
    result = team_points(starters, bench, 5, 6, players, 6)
    assert result["autosub_points"] == 7
    assert result["points"] == 29


def test_bench_order_and_conditional_score():
    starters, bench, players = setup()
    players[5]["pplay"] = 0.5
    players[13]["pplay"] = 0.6
    # Conditional score is 8, unconditional score is .6*8.
    players[13]["gw"]["6"]["points"] = 4.8
    players[14]["gw"]["6"]["points"] = 7
    result = team_points(starters, bench, 6, 7, players, 6)
    assert result["autosub_points"] == pytest.approx(0.5 * (0.6 * 8 + 0.4 * 7))


def test_goalkeeper_cover_and_captain_fallback():
    starters, bench, players = setup()
    absent(players, 1)
    absent(players, 5)
    players[6]["gw"]["6"]["points"] = 6
    result = team_points(starters, bench, 5, 6, players, 6)
    assert result["autosub_points"] == 4  # Keeper plus the first outfield sub.
    assert result["vice_points"] == 6
    tc = team_points(starters, bench, 5, 6, players, 6, "triplecaptain")
    assert tc["vice_points"] == 12


def test_benchboost_counts_all_without_extra_subs():
    starters, bench, players = setup()
    absent(players, 1)
    result = team_points(starters, bench, 5, 6, players, 6, "benchboost")
    assert result["autosub_points"] == 0
    assert result["points"] == 30


def test_cameo_blocks_automatic_sub():
    starters, bench, players = setup()
    players[5]["gw"]["6"]["points"] = 1
    result = team_points(starters, bench, 6, 7, players, 6)
    assert result["autosub_points"] == 0


def test_double_and_blank_appearance():
    player = {
        "pplay": 0.8,
        "gw": {
            "6": {"fixtures": [{"pplay": 0.5}, {"pplay": 0.4}]},
            "7": {"fixtures": []},
        },
    }
    assert appearance(player, 6) == pytest.approx(0.7)
    assert appearance(player, 7) == 0


def test_multiple_vacancies_preserve_formation_and_priority():
    starters, bench, players = setup()
    for i in [2, 3, 5]:
        absent(players, i)
    result = team_points(starters, bench, 6, 7, players, 6)
    assert result["autosub_points"] == 6
    # Two missing defenders, with one defender on the bench and two midfielders.
    players[15]["position_id"] = 3
    absent(players, 5)  # Still one midfield vacancy.
    assert team_points(starters, bench, 6, 7, players, 6)["autosub_points"] == 4

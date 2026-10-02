from backend.solver import optimise
from backend.tests.test_rules import pool


def test_existing_excluded_player_is_sold_and_funds_accounted_for():
    players = pool()
    base = optimise(players, start_gw=6, horizon=1, seconds=5)["weeks"][0]
    excluded = base["squad"][0]
    result = optimise(
        players,
        squad=base["squad"],
        bank=40,
        free_transfers=1,
        max_transfers=1,
        start_gw=6,
        horizon=1,
        excluded=[excluded],
        seconds=5,
    )
    week = result["weeks"][0]
    assert excluded not in week["squad"]
    assert excluded in week["transfers_out"]
    assert week["bank"] == 40
    assert len(week["transfers_in"]) == 1
    assert week["hits"] == 0

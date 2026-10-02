from copy import deepcopy

import pytest

from backend.ensemble import blend_forecasts
from backend.scoring import appearance


def payload():
    return {
        "next_gw": 6,
        "model_version": "test",
        "limitations": [],
        "players": [
            {
                "id": 1,
                "pplay": 0.8,
                "xmins": 64,
                "gw": {
                    "6": {
                        "points": 4,
                        "xmins": 64,
                        "fixtures": [{"pplay": 0.8}],
                        "components": {"base": 4},
                    },
                    "7": {
                        "points": 6,
                        "xmins": 64,
                        "fixtures": [{"pplay": 0.8}],
                        "components": {"base": 6},
                    },
                    "8": {"points": 0, "xmins": 0, "fixtures": [], "components": {}},
                    "12": {
                        "points": 8,
                        "xmins": 64,
                        "fixtures": [{"pplay": 0.8}],
                        "components": {"base": 8},
                    },
                },
            }
        ],
    }


def test_anchor_then_fade_through_fixture_schedule_without_mutation():
    base = payload()
    original = deepcopy(base)
    result = blend_forecasts(base, {"1": {"6": 8}}, 1, "FPL Form", half_life=6)
    player = result["players"][0]
    assert player["gw"]["6"]["points"] == 8
    assert player["gw"]["7"]["points"] == pytest.approx(6 * (1 + 2 ** (-1 / 6)))
    assert player["gw"]["12"]["points"] == 12
    assert player["gw"]["8"]["points"] == 0
    assert player["gw"]["12"]["prediction_source"]["kind"] == "extrapolated"
    assert sum(player["gw"]["12"]["components"].values()) == 12
    assert base == original


def test_no_extrapolation_and_zero_weight_leave_unmatched_weeks():
    base = payload()
    result = blend_forecasts(base, {"1": {"6": 8}}, 0.5, "CSV", extrapolate=False)
    assert result["players"][0]["gw"]["6"]["points"] == 6
    assert result["players"][0]["gw"]["7"]["points"] == 6
    assert blend_forecasts(base, {"1": {"6": 8}}, 0, "CSV") is base


def test_appearance_probabilities_are_anchored_and_blank_stays_zero():
    base = payload()
    result = blend_forecasts(
        base, {"1": {"6": 8, "8": 9}}, 0.5, "FPL Form", probabilities={"1": {"6": 0.6}}
    )
    player = result["players"][0]
    assert appearance(player, 6) == pytest.approx(0.7)
    assert player["gw"]["6"]["xmins"] == pytest.approx(56)
    assert player["gw"]["8"]["points"] == 0


def test_double_points_preserved_but_first_fixture_probability_not_used():
    base = payload()
    base["players"][0]["gw"]["6"]["fixtures"].append({"pplay": 0.8})
    result = blend_forecasts(
        base, {"1": {"6": 8}}, 1, "FPL Form", probabilities={"1": {"6": 0.1}}
    )
    assert result["players"][0]["gw"]["6"]["points"] == 8
    assert appearance(result["players"][0], 6) == pytest.approx(0.96)


def test_tiny_base_cannot_create_unbounded_extrapolation():
    base = payload()
    base["players"][0]["gw"]["6"]["points"] = 0.01
    result = blend_forecasts(base, {"1": {"6": 60}}, 1, "CSV")
    assert result["players"][0]["gw"]["12"]["points"] == 8


def test_layered_appearance_reductions_do_not_corrupt_component_inputs():
    base = payload()
    a = blend_forecasts(
        base, {"1": {"6": 8}}, 0.5, "FPL Form", probabilities={"1": {"6": 0.6}}
    )
    b = blend_forecasts(a, {"1": {"6": 9}}, 1, "CSV")
    assert b["players"][0]["gw"]["6"]["points"] == 9
    assert sum(b["players"][0]["gw"]["6"]["components"].values()) == 9
    assert appearance(b["players"][0], 6) == pytest.approx(0.7)

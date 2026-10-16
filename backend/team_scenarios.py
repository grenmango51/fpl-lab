"""Local HUMAN team-strength assumptions; never replace source observations."""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone

from .model import DEFAULT_SCORING, POSITIONS, appearance_profile, components
from .scenarios import _shares


def canonical_team_strengths(values, teams):
    """Validate stable official club codes, including non-HTTP callers."""
    codes = {str(team["code"]) for team in teams}
    if not isinstance(values, dict) or len(values) > 20:
        raise ValueError("Team strengths must map at most 20 official club codes to factors.")
    result = {}
    for code, fields in values.items():
        if not isinstance(code, str) or code not in codes:
            raise ValueError("Team strengths must use canonical stable official club CODE strings.")
        if not isinstance(fields, dict) or set(fields) - {"attack", "defence"}:
            raise ValueError("Team strengths accept only attack and defence factors.")
        factors = {"attack": 1.0, "defence": 1.0}
        for name, value in fields.items():
            if (isinstance(value, bool) or not isinstance(value, (int, float))
                    or not math.isfinite(value) or not 0.5 <= value <= 2):
                raise ValueError("Team strengths must be finite numeric factors from 0.5 to 2.")
            factors[name] = float(value)
        # Identity inputs are an exact no-op, also for metadata/snapshots.
        if factors != {"attack": 1.0, "defence": 1.0}:
            result[code] = factors
    return result


def _conceded_loss(fixture, pos, means):
    # Use the exact component model rather than an average-duration Poisson.
    profile = {
        **means, "p60": fixture["p60"],
        "pshort": fixture["pplay"] - fixture["p60"],
        "pplay": fixture["pplay"], "xmins": fixture["xmins"],
        "team_xg": 1, "dc_prob": 0,
        "rates": dict.fromkeys(("expected_goals", "expected_assists", "saves", "bonus",
                                "penalties_saved", "yellow_cards", "red_cards", "own_goals",
                                "penalties_missed"), 0),
    }
    return -components(profile, pos, 1, fixture["conceded"])["components"]["deductions"]


def apply_team_strengths(payload, strengths, dataset):
    strengths = canonical_team_strengths(strengths, dataset["teams"].values())
    if not strengths:
        return payload
    scoring = dataset["bootstrap"].get("game_config", {}).get("scoring") or DEFAULT_SCORING
    codes = {tid: str(t["code"]) for tid, t in dataset["teams"].items()}
    histories = defaultdict(list)
    for row in sorted(dataset["history"], key=lambda r: r["date"]):
        histories[row["code"]].append(row)
    adjusted_at = datetime.now(timezone.utc).isoformat()
    output = {**payload, "players": []}
    fixture_count = 0
    for original in payload["players"]:
        own = strengths.get(str(original["team_code"]), {"attack": 1, "defence": 1})
        player = original
        rows = histories[original["code"]]
        current = [r for r in rows if r["season"] == dataset["season"]]
        appearance_rows = current if len(current) >= 3 else rows
        for gw, old in original["gw"].items():
            affected = []
            for index, fixture in enumerate(old["fixtures"]):
                opponent = strengths.get(codes[fixture["opponent_id"]], {"attack": 1, "defence": 1})
                attack = own["attack"] / opponent["defence"]
                hazard = opponent["attack"] / own["defence"]
                if attack != 1 or hazard != 1:
                    affected.append((index, attack, hazard))
            if not affected:
                continue
            if player is original:
                player = {**original, "gw": dict(original["gw"]), "overridden": True}
            item = {**old, "components": dict(old["components"]), "fixtures": list(old["fixtures"])}
            player["gw"][gw] = item
            edited = []
            duration = old.get("minutes_scenario", {}).get("conditional_minutes")
            means = appearance_profile(appearance_rows, minutes_override=duration)
            for index, attack, hazard in affected:
                base = old["fixtures"][index]
                fixture = {**base, "components": dict(base["components"])}
                item["fixtures"][index] = fixture
                edited.append(fixture)
                fixture["team_goals"] = base["team_goals"] * attack
                fixture["conceded"] = base["conceded"] * hazard
                fixture["cs"] = base["cs"] ** hazard
                label = POSITIONS[player["position_id"]]
                for field, component, score in (("xg", "goals", scoring["goals_scored"][label]),
                                                 ("xa", "assists", scoring.get("assists", 3))):
                    fixture[field] = base[field] * attack
                    fixture["components"][component] += (fixture[field] - base[field]) * score
                fixture["components"]["clean_sheet"] += (
                    fixture["cs"] - base["cs"]
                ) * base["p60"] * scoring["clean_sheets"][label]
                fixture["components"]["deductions"] += (
                    _conceded_loss(base, player["position_id"], means)
                    - _conceded_loss(fixture, player["position_id"], means)
                )
                fixture["team_strength_scenario"] = {
                    "source": "user-assumed", "label": "HUMAN team-strength assumption",
                    "adjusted_at": adjusted_at, "attack_factor": attack, "conceded_factor": hazard,
                    "base": {key: base.get(key) for key in (
                        "team_goals", "conceded", "cs", "xg", "xa", "points", "components",
                        "source", "source_at", "source_at_scope", "source_extracted_at")},
                }
                fixture_count += 1
            # Keep original GW-only provider/imported residuals. Assign them to
            # changed fixtures so untouched fixtures remain byte equivalent.
            shares = _shares(edited, "xmins")
            for key, value in old["components"].items():
                residual = value - sum(f["components"].get(key, 0) for f in old["fixtures"])
                if residual:
                    for fixture, share in zip(edited, shares):
                        fixture["components"][key] = fixture["components"].get(key, 0) + residual * share
            parts = {}
            for fixture in edited:
                fixture["points"] = sum(fixture["components"].values())
            for fixture in item["fixtures"]:
                for key, value in fixture["components"].items():
                    parts[key] = parts.get(key, 0) + value
            item["components"] = parts
            item["points"] = sum(parts.values())
            item["team_strength_scenario"] = {
                "source": "user-assumed", "label": "HUMAN team-strength assumption",
                "adjusted_at": adjusted_at, "base_points": old["points"],
                "points_delta": item["points"] - old["points"],
                "fixture_ids": [f["id"] for f in edited],
            }
            item["prediction_source"] = {
                "kind": "user-scenario", "name": "HUMAN team strengths", "source_at": adjusted_at,
                "base_points": old["points"], "previous": old.get("prediction_source"),
            }
        output["players"].append(player)
    output["team_strength_scenario"] = {
        "source": "user-assumed", "label": "HUMAN team-strength assumptions",
        "adjusted_at": adjusted_at, "adjustments": strengths,
        "affected_player_fixtures": fixture_count,
        "scope": "all remaining gameweeks",
    }
    output["forecast_layers"] = [*payload.get("forecast_layers", []), {
        "name": "HUMAN team strengths", "kind": "user-scenario", "source_at": adjusted_at,
    }]
    output["limitations"] = [*payload.get("limitations", []),
        "Team strengths are HUMAN assumptions, not sourced market odds or calibrated Solio values. Goal/assist rates and conceded hazards scale after provider calibration; minutes, bonus, saves and defensive contributions stay fixed."]
    output["model_version"] = payload["model_version"] + " · human team strengths"
    return output

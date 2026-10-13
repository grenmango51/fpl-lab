"""Explicit human component edits, applied after normal forecast calibration."""

from __future__ import annotations

import math
from datetime import datetime, timezone

from .model import DEFAULT_SCORING, POSITIONS

STAT_LIMITS = {
    "expected_points": (-5, 60),
    "xg": (0, 10),
    "xa": (0, 10),
    "clean_sheet_probability": (0, 1),
}


def canonical_stat_schedule(schedule, player_ids, gameweeks):
    """Also validate non-HTTP callers before allocating any scenario values."""
    if schedule is None:
        return {}
    if not isinstance(schedule, dict) or len(schedule) > 700:
        raise ValueError("Stat schedules must map current player IDs to gameweeks.")
    result = {}
    for raw_pid, weeks in schedule.items():
        try:
            pid = str(int(raw_pid))
        except (ValueError, TypeError, OverflowError):
            raise ValueError("Invalid stat-schedule player ID.") from None
        if isinstance(raw_pid, bool) or str(raw_pid) != pid or int(pid) not in player_ids:
            raise ValueError("Stat schedules must use current player IDs.")
        if not isinstance(weeks, dict) or not weeks or len(weeks) > 38:
            raise ValueError("Each stat-schedule player needs gameweek scenarios.")
        result[pid] = {}
        for raw_gw, fields in weeks.items():
            try:
                gw = str(int(raw_gw))
            except (ValueError, TypeError, OverflowError):
                raise ValueError("Invalid stat-schedule gameweek.") from None
            if isinstance(raw_gw, bool) or str(raw_gw) != gw or int(gw) not in gameweeks:
                raise ValueError("Stat schedules must use remaining gameweeks.")
            if not isinstance(fields, dict) or set(fields) - STAT_LIMITS.keys():
                raise ValueError("Unknown stat-schedule field.")
            values = {}
            for name, value in fields.items():
                if value is None:
                    continue
                low, high = STAT_LIMITS[name]
                if (
                    isinstance(value, bool)
                    or not isinstance(value, (float, int))
                    or not math.isfinite(value)
                    or not low <= value <= high
                ):
                    raise ValueError(f"{name} must be a finite number from {low} to {high}.")
                values[name] = float(value)
            if not values:
                raise ValueError("A stat scenario needs at least one editable field.")
            result[pid][gw] = values
    return result


def apply_stat_schedule(payload, schedule, scoring=None):
    """Copy only edited weeks; preserve all ordinary provider calibration.

    Provider point residuals are distributed onto edited fixtures, retaining
    their labels. Event edits then alter their own scoring components. This
    makes fixture/GW sums agree without claiming event information from a
    provider's scalar point anchor.
    """
    schedule = canonical_stat_schedule(
        schedule, {p["id"] for p in payload["players"]}, payload["gameweeks"]
    )
    if not schedule:
        return payload
    scoring = scoring or DEFAULT_SCORING
    adjusted_at = datetime.now(timezone.utc).isoformat()
    output = {**payload, "players": []}
    count = 0
    for original in payload["players"]:
        weeks = schedule.get(str(original["id"]), {})
        if not weeks:
            output["players"].append(original)
            continue
        player = {**original, "gw": dict(original["gw"]), "overridden": True}
        output["players"].append(player)
        position = POSITIONS[player["position_id"]]
        for gw, fields in weeks.items():
            old = original["gw"][gw]
            item = {
                **old,
                "components": dict(old["components"]),
                "fixtures": [{**f, "components": dict(f["components"])} for f in old["fixtures"]],
            }
            player["gw"][gw] = item
            fixtures = item["fixtures"]
            scenario = {
                **fields,
                "label": "User-assumed player stats scenario",
                "source": "user-assumed",
                "adjusted_at": adjusted_at,
                "base": {
                    "expected_points": old["points"],
                    "xg": sum(f["xg"] for f in old["fixtures"]),
                    "xa": sum(f["xa"] for f in old["fixtures"]),
                    "clean_sheet_probabilities": [f["cs"] for f in old["fixtures"]],
                },
            }
            item["stat_scenario"] = scenario
            item["prediction_source"] = {
                "kind": "user-scenario", "name": "User-assumed stats", "source_at": adjusted_at,
                "base_points": old["points"], "previous": old.get("prediction_source"),
            }
            count += 1
            if not fixtures:
                scenario["blank_gameweek"] = True
                # Supplied blank assumptions are retained for inspection but
                # never invent a fixture or score.
                continue
            eligible = [f for f in fixtures if f.get("pplay", 0) > 0]
            if not eligible and (
                fields.get("xg", 0) > 0 or fields.get("xa", 0) > 0
                or fields.get("expected_points", 0) != 0
            ):
                raise ValueError(
                    f"Player {player['id']} has zero appearance in GW{gw}; edit minutes/availability before positive stats or points."
                )
            allocation = _shares(eligible, "xmins") if eligible else _shares(fixtures, "xmins")
            targets = eligible or fixtures
            # Reconcile existing GW-only point layers before event edits.
            for key, value in old["components"].items():
                residual = value - sum(f["components"].get(key, 0) for f in fixtures)
                if residual:
                    for f, share in zip(targets, allocation):
                        f["components"][key] = f["components"].get(key, 0) + residual * share
            for name, component, score in (
                ("xg", "goals", scoring["goals_scored"][position]),
                ("xa", "assists", scoring.get("assists", 3)),
            ):
                if name not in fields:
                    continue
                shares = _shares(eligible, name) if eligible else []
                for f in fixtures:
                    f[name] = 0
                    f["components"][component] = 0
                for f, share in zip(eligible, shares):
                    f[name] = fields[name] * share
                    f["components"][component] = f[name] * score
            if "clean_sheet_probability" in fields:
                for f in fixtures:
                    f["cs"] = fields["clean_sheet_probability"]
                    f["components"]["clean_sheet"] = (
                        f["cs"] * f["p60"] * scoring["clean_sheets"][position]
                    )
            base_points = sum(sum(f["components"].values()) for f in fixtures)
            if "expected_points" in fields:
                residual = fields["expected_points"] - base_points
                for f, share in zip(targets, allocation):
                    f["components"]["user_points_adjustment"] = residual * share
            parts = {}
            for f in fixtures:
                f["points"] = sum(f["components"].values())
                for key, value in f["components"].items():
                    parts[key] = parts.get(key, 0) + value
            item["components"] = parts
            item["points"] = sum(parts.values())
        first = player["gw"][str(payload["next_gw"])]
        player["xmins"], player["pplay"], player["p60"] = first["xmins"], first["pplay"], first["p60"]
    output["forecast_layers"] = [*payload.get("forecast_layers", []), {
        "name": "User-assumed player stats", "kind": "user-scenario", "edited_forecasts": count,
        "source_at": adjusted_at,
    }]
    output["limitations"] = [*payload.get("limitations", []),
        "Player stats edits are explicit human scenarios. xG/xA are unconditional GW totals; a CS assumption applies to each fixture. Ordinary provider residuals remain separately labelled; unedited weeks retain their normal calibration."]
    output["model_version"] = payload["model_version"] + " · user stats scenarios"
    return output


def _shares(fixtures, field):
    values = [max(0, f.get(field, 0)) for f in fixtures]
    total = sum(values)
    if not total and field != "xmins":
        return _shares(fixtures, "xmins")
    return [v / total for v in values] if total else [1 / len(fixtures)] * len(fixtures)

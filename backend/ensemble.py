"""Transparent short-range provider anchoring, with fading extrapolation.

This is an explicitly declared heuristic, not an evaluated learned model.
It carries a player's relative point level through the base fixture schedule,
without pretending a scalar point forecast identifies xG, xA or injury duration.
"""

from __future__ import annotations

from .scoring import appearance


def blend_forecasts(
    payload,
    anchors,
    weight,
    name,
    extrapolate=True,
    half_life=6,
    probabilities=None,
    source_at=None,
    minutes_schedule=None,
    calibration_payload=None,
):
    """Blend unscheduled outputs using a pre-layer, unscheduled reference.

    Pass the reference through the same sequence of blend layers in parallel.
    This keeps a local minutes scenario from changing other gameweeks' anchor
    scales or appearance deltas. Without a reference, scheduled anchors are
    excluded, preserving the historical direct-call behavior.
    """
    if not anchors or weight <= 0:
        return payload
    output = {
        **payload,
        "players": [],
        "limitations": list(payload["limitations"]),
        "forecast_layers": list(payload.get("forecast_layers", [])),
    }
    probabilities = probabilities or {}
    minutes_schedule = minutes_schedule or {}
    reference_players = (
        {str(p["id"]): p for p in calibration_payload["players"]}
        if calibration_payload is not None
        else {}
    )
    direct = extended = 0
    for original in payload["players"]:
        # Fixture/component inputs are immutable. Copy only changed forecast
        # dictionaries so a full-season response does not clone them twice.
        player = {**original, "gw": dict(original["gw"])}
        output["players"].append(player)
        pid = str(player["id"])
        manual_weeks = {str(gw) for gw in minutes_schedule.get(pid, {})}
        supplied = anchors.get(pid, {})
        if not supplied:
            continue
        if (
            calibration_payload is not None
            and manual_weeks
            and pid not in reference_players
        ):
            raise ValueError("Calibration reference is missing a scheduled player")
        reference = reference_players.get(pid, original)
        valid = {
            gw: point
            for gw, point in supplied.items()
            if (calibration_payload is not None or gw not in manual_weeks)
            and gw in player["gw"]
            and gw in reference["gw"]
            and reference["gw"][gw]["fixtures"]
        }
        # Low/base-zero rows cannot identify a stable scale. Avoid division by
        # a tiny forecast or assuming that a blank week supplies a player rate.
        calibrating = [
            (gw, point)
            for gw, point in valid.items()
            if reference["gw"][gw]["points"] >= 0.5 and reference["gw"][gw]["fixtures"]
        ]
        anchor_weights = {
            gw: 1 / (int(gw) - payload["next_gw"] + 1) for gw, _ in calibrating
        }
        denominator = sum(
            anchor_weights[gw] * reference["gw"][gw]["points"] for gw, _ in calibrating
        )
        ratio = (
            min(
                3,
                max(
                    0,
                    sum(anchor_weights[gw] * point for gw, point in calibrating)
                    / denominator,
                ),
            )
            if denominator
            else None
        )
        last = max(map(int, valid)) if valid else 39
        probability_rows = [
            (gw, p)
            for gw, p in probabilities.get(pid, {}).items()
            if gw in valid and len(reference["gw"][gw]["fixtures"]) == 1
        ]
        # Source probability may be for the first fixture only; skip double-GW
        # probability anchoring while still using the source's summed points.
        delta = (
            sum(p - appearance(reference, int(gw)) for gw, p in probability_rows)
            / len(probability_rows)
            if probability_rows
            else None
        )
        for gw, item in player["gw"].items():
            # A user-scheduled duration/availability controls the whole GW.
            # The parallel unscheduled reference may still calibrate anchors.
            if gw in manual_weeks:
                continue
            old = item["points"]
            if gw in valid:
                influence = weight
                target = valid[gw]
                kind = "provider"
                direct += 1
            elif (
                extrapolate
                and int(gw) > last
                and ratio is not None
                and item["fixtures"]
            ):
                influence = weight * 2 ** (-(int(gw) - last) / half_life)
                target = old * ratio
                kind = "extrapolated"
                extended += 1
            else:
                continue
            item = {**item, "components": dict(item["components"])}
            player["gw"][gw] = item
            item["points"] = old * (1 - influence) + target * influence
            component = (
                "provider_adjustment" if name == "FPL Form" else "imported_adjustment"
            )
            item["components"][component] = (
                item["components"].get(component, 0) + item["points"] - old
            )
            item["prediction_source"] = {
                "kind": kind,
                "name": name,
                "weight": influence,
                "base_points": old,
                "source_points": target,
                "anchor_gameweeks": sorted(map(int, valid)),
                "ratio": ratio,
                "source_at": source_at,
            }
            p_old = appearance(original, int(gw))
            p_new = None
            if (
                kind == "provider"
                and gw in probabilities.get(pid, {})
                and len(item["fixtures"]) == 1
            ):
                p_new = (1 - influence) * p_old + influence * probabilities[pid][gw]
            elif kind == "extrapolated" and delta is not None:
                p_new = min(1, max(0, p_old + influence * delta))
            if p_new is not None:
                item["pplay"] = p_new
                if p_old > 0:
                    item["xmins"] *= p_new / p_old
        first = player["gw"][str(payload["next_gw"])]
        player["pplay"] = first.get("pplay", appearance(original, payload["next_gw"]))
        player["xmins"] = first["xmins"]
    output.setdefault("forecast_layers", []).append(
        {
            "name": name,
            "weight": weight,
            "direct_forecasts": direct,
            "extrapolated_forecasts": extended,
            "half_life": half_life,
            "source_at": source_at,
        }
    )
    output["model_version"] += f" · {name} {weight:.0%}" + (
        " + extrapolation" if extrapolate else ""
    )
    output["limitations"] += [
        f"{name} point adjustments are a live ensemble, not the component model in the historical backtest. Extrapolation uses a capped player-level scale, fades with a {half_life:g}-GW half-life, and is unvalidated. Base event components and simulations remain unchanged apart from an explicit adjustment."
    ]
    return output

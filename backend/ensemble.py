"""Transparent short-range provider anchoring, with fading extrapolation.

This is an explicitly declared heuristic, not an evaluated learned model.
It carries a player's relative point level through the base fixture schedule,
without pretending a scalar point forecast identifies xG, xA or injury duration.
"""

from __future__ import annotations

from .scoring import appearance


def _conditional_points(item):
    probability = item.get("pplay")
    if probability is None:
        probability = 1
        for fixture in item["fixtures"]:
            probability *= 1 - fixture.get("pplay", 0)
        probability = 1 - probability
    if probability > 0:
        return item["points"] / probability
    fixtures = item["fixtures"]
    if len(fixtures) == 1:
        return fixtures[0].get("appearance_basis", {}).get("points")
    return None


def _set_probability(item, probability):
    """Single-fixture state change, including restoration from a zero base."""
    old = item["fixtures"][0]
    previous = old.get("pplay", 0)
    basis = old if previous > 0 else old.get("appearance_basis")
    if basis is None:
        # Compatibility with old/imported payloads without a restoration basis.
        return
    scale = probability / previous if previous > 0 else probability
    fixture = dict(old)
    if previous > 0 and probability == 0:
        fixture["appearance_basis"] = {
            **{k: old[k] / previous for k in ("xmins", "p60", "xg", "xa", "points") if k in old},
            "pplay": 1,
            **({"components": {k: v / previous for k, v in old["components"].items()}}
               if "components" in old else {}),
        }
    for field in ("xmins", "p60", "xg", "xa", "points"):
        if field in basis:
            fixture[field] = basis[field] * scale
    fixture["pplay"] = probability
    if "p60" in fixture:
        fixture["p60"] = min(probability, max(0, fixture["p60"]))
    if "xmins" not in basis:
        fixture["xmins"] = item["xmins"] * scale
    if "components" in basis:
        fixture["components"] = {k: v * scale for k, v in basis["components"].items()}
        # Provider points remain an explicit residual after event states change.
        for key, value in fixture["components"].items():
            item["components"][key] = value
    item["fixtures"] = [fixture]
    item["pplay"] = probability
    item["xmins"] = fixture.get("xmins", item["xmins"])
    if "p60" in fixture:
        item["p60"] = fixture["p60"]


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
        last = max(map(int, valid)) if valid else 39
        probability_map = probabilities.get(pid, {})
        conditional = bool(probability_map)
        # Separate rate/selection calibration from availability. An injury-zero
        # anchor supplies no conditional scoring rate, and cannot veto a return.
        calibrating = [
            (gw, point)
            for gw, point in valid.items()
            if (not conditional and reference["gw"][gw]["points"] >= 0.5)
            or (conditional and len(reference["gw"][gw]["fixtures"]) == 1
                and probability_map.get(gw, 0) >= 0.1
                and (_conditional_points(reference["gw"][gw]) or 0) >= 0.5)
        ]
        anchor_weights = {
            gw: 2 ** (-(last - int(gw)) / 2) for gw, _ in calibrating
        }
        denominator = sum(
            anchor_weights[gw] * (
                _conditional_points(reference["gw"][gw]) if conditional
                else reference["gw"][gw]["points"]
            ) for gw, _ in calibrating
        )
        ratio = (
            min(
                3,
                max(
                    0,
                    sum(anchor_weights[gw] * point / (
                        probability_map[gw] if conditional else 1
                    ) for gw, point in calibrating)
                    / denominator,
                ),
            )
            if denominator
            else None
        )
        probability_rows = [
            (gw, p)
            for gw, p in probabilities.get(pid, {}).items()
            if gw in valid and len(reference["gw"][gw]["fixtures"]) == 1
            and p >= 0.1
            and reference["gw"][gw]["fixtures"][0].get(
                "availability_assumption", {"value": 1}
            )["value"] >= 0.95
        ]
        # Source probability may be for the first fixture only; skip double-GW
        # probability anchoring while still using the source's summed points.
        delta = (
            sum(2 ** (-(last - int(gw)) / 2) * (p - appearance(reference, int(gw)))
                for gw, p in probability_rows)
            / sum(2 ** (-(last - int(gw)) / 2) for gw, _ in probability_rows)
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
                if conditional and len(item["fixtures"]) == 1:
                    conditional_points = _conditional_points(item)
                    if conditional_points is not None:
                        target = conditional_points * min(1, max(0,
                            appearance(original, int(gw)) + (delta or 0))) * ratio
                kind = "extrapolated"
                extended += 1
            else:
                continue
            item = {**item, "components": dict(item["components"])}
            player["gw"][gw] = item
            item["points"] = old * (1 - influence) + target * influence
            component = (
                "provider_adjustment" if name == "FPL Form" else
                "solio_extrapolation" if name == "Solio window projection" else "imported_adjustment"
            )
            item["prediction_source"] = {
                "kind": kind,
                "name": name,
                "weight": influence,
                "base_points": old,
                "source_points": target,
                "anchor_gameweeks": sorted(map(int, valid)),
                "ratio": ratio,
                "calibration": "conditional on appearance" if conditional else "point scale",
                "anchor_weight_half_life": 2,
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
            elif kind == "extrapolated" and delta is not None and len(item["fixtures"]) == 1:
                p_new = min(1, max(0, p_old + influence * delta))
            if p_new is not None:
                _set_probability(item, p_new)
            item["components"][component] = item["components"].get(component, 0) + (
                item["points"] - sum(item["components"].values())
            )
        first = player["gw"][str(payload["next_gw"])]
        player["pplay"] = first.get("pplay", appearance(original, payload["next_gw"]))
        player["xmins"] = first["xmins"]
        player["p60"] = first.get("p60", player.get("p60", 0))
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
        f"{name} is a live ensemble. Extrapolation favours later anchors, separates scoring conditional on appearance when probabilities are supplied, and fades with a {half_life:g}-GW half-life. Probability changes update fixture states; point differences remain explicit residuals. This policy is unvalidated prospectively."
    ]
    return output

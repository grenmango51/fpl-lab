"""Exact TC/BB placement for a fixed plan under the existing EV scorer."""

from __future__ import annotations

from itertools import product

from .scoring import team_points

AUTOMATIC_CHIPS = ("triplecaptain", "benchboost")
CHIPS = {"wildcard", "freehit", *AUTOMATIC_CHIPS}


def recommend_chips(weeks, players, used_chips=()):
    """Keep all decisions except unscheduled TC/BB unchanged.

    The caller validates the entire plan before and after this function using
    one frozen forecast payload. Independent halves permit two bounded pair
    enumerations instead of a four-chip Cartesian explosion.
    """
    lookup = {p["id"]: p for p in players}
    existing = {
        str(week["gw"]): week["chip"]
        for week in weeks if week.get("chip", "none") != "none"
    }
    used = set()
    for record in [*used_chips, *(
        {"chip": week["chip"], "gw": week["gw"]}
        for week in weeks if week.get("chip", "none") != "none"
    )]:
        chip, gw = record["chip"], record["gw"]
        if chip not in CHIPS or isinstance(gw, bool) or not isinstance(gw, int) or not 1 <= gw <= 38:
            raise ValueError("Invalid chip history or manual chip assignment.")
        key = (chip, 1 if gw <= 19 else 2)
        if key in used:
            raise ValueError("Each chip may be used once per half of the season.")
        used.add(key)
    if len({week["gw"] for week in weeks}) != len(weeks):
        raise ValueError("Recommendation gameweeks must be distinct.")

    def score(week, chip):
        return team_points(
            week["starters"], week["bench"], week["captain"], week["vice"],
            lookup, week["gw"], chip,
        )["points"] - week.get("hits", 0)

    baseline_scores = {week["gw"]: score(week, week.get("chip", "none")) for week in weeks}
    deltas = {}
    windows = []
    candidate_counts = {chip: 0 for chip in AUTOMATIC_CHIPS}
    candidate_counts["joint_combinations"] = 0
    recommendations = []
    for half in (1, 2):
        half_weeks = sorted(
            (week for week in weeks if (1 if week["gw"] <= 19 else 2) == half
             and week.get("chip", "none") == "none"),
            key=lambda week: week["gw"],
        )
        eligible = {}
        for chip in AUTOMATIC_CHIPS:
            eligible[chip] = [] if (chip, half) in used else [week["gw"] for week in half_weeks]
            windows.append({
                "chip": chip, "half": half, "gameweeks": eligible[chip],
                "already_used": (chip, half) in used,
                "available": bool(eligible[chip]),
            })
            candidate_counts[chip] += len(eligible[chip])
            for week in half_weeks:
                if week["gw"] in eligible[chip]:
                    deltas[chip, week["gw"]] = score(week, chip) - baseline_scores[week["gw"]]
        best_gain, chosen = 0.0, (None, None)
        for tc, bb in product([None, *eligible["triplecaptain"]], [None, *eligible["benchboost"]]):
            if tc is not None and tc == bb:
                continue
            candidate_counts["joint_combinations"] += 1
            gain = sum(deltas[chip, gw] for chip, gw in zip(AUTOMATIC_CHIPS, (tc, bb)) if gw is not None)
            # Not using a chip is legal and wins against a zero/negative gain.
            # Iteration over sorted GWs provides deterministic tie handling.
            if gain > best_gain + 1e-9:
                best_gain, chosen = gain, (tc, bb)
        for chip, gw in zip(AUTOMATIC_CHIPS, chosen):
            if gw is not None:
                recommendations.append({"chip": chip, "gw": gw, "half": half, "marginal_points": deltas[chip, gw]})
    recommendations.sort(key=lambda item: (item["gw"], item["chip"]))
    schedule = {**existing, **{str(item["gw"]): item["chip"] for item in recommendations}}
    proposed = [{**week, "chip": schedule.get(str(week["gw"]), "none")} for week in weeks]
    baseline = sum(baseline_scores.values())
    recommended = sum(score(week, week["chip"]) for week in proposed)
    return {
        "chips": dict(sorted(schedule.items(), key=lambda pair: int(pair[0]))),
        "recommendations": recommendations,
        "weeks": proposed,
        "baseline_net_points": baseline,
        "recommended_net_points": recommended,
        "improvement": recommended - baseline,
        "available_windows": windows,
        "candidate_counts": candidate_counts,
        "status": "recommended" if recommendations else "no-change",
        "method": "Enumerated legal TC/BB placements over the same supplied GWs using undiscounted full squad expected net points, including autosubs and vice fallback. Existing squads, transfers, XI, captain, vice, bench order and manual chips are fixed.",
        "limitations": [
            "Fixed-plan placement; this does not jointly optimise transfers, lineups or WC/FH timing.",
            "Appearance events are independent and uncalibrated, as in the normal squad scorer.",
            "Recommendations cover only supplied weeks and can change after forecast edits or a new transfer solve.",
        ],
    }

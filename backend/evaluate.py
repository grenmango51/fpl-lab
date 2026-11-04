"""Out-of-sample walk-forward evaluation of the deployed component model.

Sub-model parameters are refitted on 2023/24–2024/25 origins (priors from
2022/23–2024/25; minutes on 2024/25 flag weeks) and every 2025/26 forecast uses
only rows from gameweeks before its origin plus the flag snapshot before its
deadline. Both models receive the same availability inputs as in live use. The
previous v0.2 heuristic model and two naive baselines are scored on identical
player-fixtures.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import timedelta

import numpy as np

from . import forecast_model as F
from .availability import fixture_availability, parsed_time, selection_rows
from .data import ROOT, utcnow
from .fit import case_flag, fit, origins, training_flags, training_rows
from .model import (
    DEFAULT_SCORING,
    PARAMETERS,
    POSITIONS,
    VERSION,
    appearance_profile,
    components,
    fitted_fixture_availability,
    player_profile,
    positional_priors,
)

REPORT = ROOT / "data" / "evaluation.json"
TEST_SEASON = "2025-26"
TRAIN_ORIGINS = ("2023-24", "2024-25")
PRIOR_SEASONS = ("2022-23", "2023-24", "2024-25")
HORIZONS = (1, 2, 4, 8, 12)
MODELS = (
    ("Component model", "component"),
    ("Previous v0.2", "previous"),
    ("Recent 5-match form", "form"),
    ("Appearance-adjusted PPG", "ppg"),
)
SQUAD_SLOTS = {1: 2, 2: 5, 3: 5, 4: 3}
XI_LIMITS = {1: (1, 1), 2: (3, 5), 3: (2, 5), 4: (1, 3)}
SQUAD_BUDGET = 100.0
BENCH_WEIGHT = 0.1
# Log loss needs a floor: v0.2 states some appearance probabilities as exactly 0.
PROBABILITY_FLOOR = 1e-3


def metrics(pred, actual):
    pred, actual = np.asarray(pred, float), np.asarray(actual, float)
    if not len(actual):
        return None
    return {
        "mae": float(np.mean(np.abs(pred - actual))),
        "rmse": float(np.sqrt(np.mean((pred - actual) ** 2))),
        "bias": float(np.mean(pred - actual)),
        "count": int(len(actual)),
    }


def forecast_records(rows, params, flags, log=print):
    legacy_priors = positional_priors(rows, TEST_SEASON)
    records, last = [], None
    for case in origins(rows, [TEST_SEASON], HORIZONS, flags):
        if (TEST_SEASON, case["gw"] - 1) not in flags:
            continue  # Without a validated pre-deadline flag week, live inputs cannot be mimicked.
        prior, pos = case["prior"], case["position"]
        # Players absent from the snapshot joined the pool later; live data lists them as available.
        status, chance, news = case["flag"] or ("a", None, "")
        player = {"status": status, "chance_of_playing_next_round": chance, "news": news}
        _, minutes_rows = case_flag({**case, "flag": (status, chance, news)})
        deadline = parsed_time(case["first_kickoff"]) - timedelta(minutes=90)
        appearance_rows = selection_rows(prior, TEST_SEASON, player)
        context = {"season": TEST_SEASON, "price": case["price"], "team": case["team"],
                   "minutes_rows": minutes_rows}
        fitted = player_profile(prior, pos, legacy_priors[pos], context=context, params=params)
        previous_rates = player_profile(prior, pos, legacy_priors[pos])
        recent_starter = sum(r.get("starts", 0) for r in prior[-3:]) >= 2
        level = F.flag_category(status, chance)
        for h, r, gf, ga in case["targets"]:
            declared = fixture_availability(player, r["date"], deadline, next_week=h == 1)
            assumption = fitted_fixture_availability(declared, player, fitted["minutes_features"], h, params)
            probabilities = F.minutes_probabilities(fitted["minutes_features"], h, params,
                                                    assumption.get("flag", "available"))
            profile = {**fitted, **appearance_profile(appearance_rows, assumption["value"], None, probabilities)}
            previous = {**previous_rates, **appearance_profile(appearance_rows, declared["value"])}
            ours = components(profile, pos, gf, ga, F.clean_sheet_probability(ga, params), DEFAULT_SCORING)
            old = components(previous, pos, gf, ga, scoring=DEFAULT_SCORING)
            records.append({
                "gw": case["gw"] + h - 1, "origin": case["gw"], "h": h, "code": case["code"],
                "position": pos, "team": case["team"], "price": case["price"],
                "actual": r["total_points"], "minutes": r["minutes"],
                "component": ours["points"], "previous": old["points"],
                "pplay": ours["pplay"], "p60": ours["p60"],
                "previous_pplay": old["pplay"], "previous_p60": old["p60"],
                "form": fitted["form"], "ppg": fitted["ppg"] * previous["pplay"],
                "xmins": ours["xmins"], "previous_xmins": old["xmins"],
                "recent_starter": recent_starter, "flagged": level != "available",
                "flag": level or "unregistered",
            })
        if case["gw"] != last:
            last = case["gw"]
            log(f"evaluation {TEST_SEASON} origin GW{last}: {len(records)} forecasts", flush=True)
    return records

def player_weeks(records):
    """Next-GW forecasts and outcomes summed per player and GW (doubles included)."""
    weeks = {}
    for r in records:
        if r["h"] != 1:
            continue
        item = weeks.setdefault((r["gw"], r["code"]), {
            "gw": r["gw"], "code": r["code"], "position": r["position"], "team": r["team"],
            "price": r["price"], **dict.fromkeys(("actual", "xmins", *(key for _, key in MODELS)), 0.0)})
        for key in ("actual", "xmins", *(key for _, key in MODELS)):
            item[key] += r[key]
    by_gw = defaultdict(list)
    for item in weeks.values():
        by_gw[item["gw"]].append(item)
    return dict(sorted(by_gw.items()))


def best_squad(players, key):
    """Legal 15 under budget/club limits maximising forecast XI + captain + bench/10.

    Returns the actual XI points with the captain doubled (no autosubs)."""
    from scipy.optimize import Bounds, LinearConstraint, milp
    from scipy.sparse import lil_matrix

    n = len(players)
    f = np.array([p[key] for p in players])
    pos = np.array([p["position"] for p in players])
    rows, lower, upper = [], [], []

    def row(entries, lo, hi):
        rows.append(entries)
        lower.append(lo)
        upper.append(hi)

    for p, slots in SQUAD_SLOTS.items():
        row({i: 1 for i in np.flatnonzero(pos == p)}, slots, slots)
        row({n + i: 1 for i in np.flatnonzero(pos == p)}, *XI_LIMITS[p])
    row({i: p["price"] for i, p in enumerate(players)}, 0, SQUAD_BUDGET)
    for team in {p["team"] for p in players}:
        row({i: 1 for i, p in enumerate(players) if p["team"] == team}, 0, 3)
    row({n + i: 1 for i in range(n)}, 11, 11)
    row({2 * n + i: 1 for i in range(n)}, 1, 1)
    for i in range(n):
        row({n + i: 1, i: -1}, -np.inf, 0)
        row({2 * n + i: 1, n + i: -1}, -np.inf, 0)
    A = lil_matrix((len(rows), 3 * n))
    for r, entries in enumerate(rows):
        for column, value in entries.items():
            A[r, column] = value
    objective = -np.concatenate([BENCH_WEIGHT * f, (1 - BENCH_WEIGHT) * f, f])
    result = milp(objective, integrality=np.ones(3 * n), bounds=Bounds(0, 1),
                  constraints=LinearConstraint(A.tocsr(), lower, upper),
                  options={"time_limit": 30})
    if result.x is None:
        raise RuntimeError(f"budget squad infeasible for {key}: {result.message}")
    x = np.round(result.x)
    actual = np.array([p["actual"] for p in players])
    return float(actual @ x[n:2 * n] + actual @ x[2 * n:])


def probability_scores(probability, outcome):
    p = np.clip(np.asarray(probability, float), PROBABILITY_FLOOR, 1 - PROBABILITY_FLOOR)
    y = np.asarray(outcome, float)
    if not len(y):
        return None
    return {"log_loss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))),
            "brier": float(np.mean((p - y) ** 2)), "predicted": float(p.mean()),
            "observed": float(y.mean()), "count": int(len(y))}


def appearance_scores(records):
    return {
        event: {name: probability_scores([r[f"{prefix}{event}"] for r in records],
                                          [r["minutes"] >= threshold for r in records])
                for name, prefix in (("Component model", ""), ("Previous v0.2", "previous_"))}
        for event, threshold in (("pplay", 1), ("p60", 60))
    }


def paired_bootstrap(a, b, rng):
    """Mean of per-GW a - b with a GW-resampling 95% interval."""
    delta = np.asarray(a, float) - np.asarray(b, float)
    boot = delta[rng.integers(0, len(delta), size=(5000, len(delta)))].mean(1)
    return {"difference": float(delta.mean()),
            "ci95": [float(v) for v in np.quantile(boot, [0.025, 0.975])]}


def bootstrap_difference(per_gw, a, b, field, rng):
    delta = np.array([g[a][field] - g[b][field] for g in per_gw])
    weights = np.array([g["count"] for g in per_gw], float)
    samples = rng.integers(0, len(per_gw), size=(5000, len(per_gw)))
    boot = np.sum(delta[samples] * weights[samples], 1) / np.sum(weights[samples], 1)
    return {"difference": float(np.average(delta, weights=weights)),
            "ci95": [float(v) for v in np.quantile(boot, [0.025, 0.975])]}


def run_evaluation(log=print):
    rows = training_rows()
    flags = training_flags(rows)
    params = fit(TRAIN_ORIGINS, PRIOR_SEASONS, rows=rows, log=log, flags=flags)
    records = forecast_records(rows, params, flags, log=log)
    origins_used = sorted({r["origin"] for r in records})
    next_gw = [r for r in records if r["h"] == 1]
    starters = [r for r in next_gw if r["recent_starter"]]
    per_gw = []
    for gw in sorted({r["gw"] for r in starters}):
        rs = [r for r in starters if r["gw"] == gw]
        per_gw.append({"gw": gw, "count": len(rs), **{
            key: metrics([r[key] for r in rs], [r["actual"] for r in rs]) for _, key in MODELS}})
    rng = np.random.default_rng(42)
    result = {
        "generated_at": utcnow(),
        "version": VERSION,
        "train_seasons": list(TRAIN_ORIGINS),
        "test_season": TEST_SEASON,
        "method": f"Walk-forward from 2025/26 origins GW{origins_used[0]}–{origins_used[-1]}, each with the archived availability flags from before its deadline. Fitted minutes, rate, bonus, clean-sheet and DC sub-models use 2022/23–2024/25 archives only; player and team states use only earlier gameweeks. Both models apply the same flags and return dates as live forecasts.",
        "cohort": "Recent starters: started at least 2 of their last 3 recorded fixtures before the origin (model-independent).",
        "parameters": PARAMETERS,
        "fit": {key: params[key] for key in ("origin_seasons", "prior_seasons", "diagnostics")},
        "origins": origins_used,
        "models": {name: metrics([r[key] for r in starters], [r["actual"] for r in starters]) for name, key in MODELS},
        "all_players": {name: metrics([r[key] for r in next_gw], [r["actual"] for r in next_gw]) for name, key in MODELS},
        "flagged_players": {name: metrics([r[key] for r in next_gw if r["flagged"]],
                                          [r["actual"] for r in next_gw if r["flagged"]]) for name, key in MODELS[:2]},
        "horizons": [
            {"h": h, **{name: metrics([r[key] for r in records if r["h"] == h], [r["actual"] for r in records if r["h"] == h])
                        for name, key in MODELS[:2]}}
            for h in HORIZONS
        ],
        "minutes": metrics([r["xmins"] for r in starters], [r["minutes"] for r in starters]),
        "previous_minutes": metrics([r["previous_xmins"] for r in starters], [r["minutes"] for r in starters]),
        "positions": [
            {"position": POSITIONS[pos], **metrics([r["component"] for r in starters if r["position"] == pos],
                                                   [r["actual"] for r in starters if r["position"] == pos])}
            for pos in range(1, 5)
        ],
        "gameweeks": [{"gw": g["gw"], "count": g["count"], **{key: g[key]["mae"] for _, key in MODELS},
                       "rmse": {key: g[key]["rmse"] for _, key in MODELS}} for g in per_gw],
        "headline_metric": "rmse",
        "headline_reason": "Expected points are means, and squared error is minimised by the mean. MAE is minimised by the median, so it rewards under-predicting skewed FPL scores.",
        "appearance": {
            "next_gw": appearance_scores(next_gw),
            "by_flag": {level: appearance_scores([r for r in next_gw if r["flag"] == level])
                        for level in ("available", *F.FLAG_LEVELS)},
            "horizons": [{"h": h, **appearance_scores([r for r in records if r["h"] == h])["pplay"]}
                         for h in HORIZONS],
            "method": f"Log loss and Brier score of P(appearance) and P(60+ minutes); probabilities floored at {PROBABILITY_FLOOR}.",
        },
        "calibration": [],
        "limitations": [
            "Evaluation uses historical team estimates, not current market/Elevenify data. Live forecasts therefore differ.",
            "Archived flags are weekly FPL-Core-Insights snapshots taken between deadlines, not exact deadline captures. 2024/25 snapshots have no news text, so no return dates. 2025/26 GW1–10 snapshots fail validation, so those origins are excluded.",
            "Defensive contributions were new in 2025/26, so the holdout fit has no DC prior and learns DC rates in-season.",
            "No paid-provider forecasts at the same deadlines have been supplied. Market competitiveness is unproven.",
            "The 2025/26 holdout informed the v0.3 design. Register future changes against a fresh prospective set.",
        ],
        "deployed_model": "Component model",
    }
    for low in range(10):
        rs = [r for r in next_gw if low <= r["component"] < low + 1]
        if len(rs) >= 20:
            result["calibration"].append({
                "bin": f"{low}–{low + 1}", "predicted": float(np.mean([r["component"] for r in rs])),
                "actual": float(np.mean([r["actual"] for r in rs])), "count": len(rs)})
    captain_rows = defaultdict(lambda: defaultdict(float))
    for r in next_gw:
        aggregate = captain_rows[(r["gw"], r["code"])]
        for key in ("actual", "xmins", "component", "previous", "form", "ppg"):
            aggregate[key] += r[key]
    captains = []
    for gw in sorted({r["gw"] for r in next_gw}):
        rs = [r for (week, _), r in captain_rows.items() if week == gw and r["xmins"] >= 45]
        if rs:
            captains.append({"gw": gw, **{key: max(rs, key=lambda r: r[key])["actual"] for _, key in MODELS}})
    result["captains"] = {key: sum(r[key] for r in captains) for _, key in MODELS}
    result["captain_gameweeks"] = captains
    result["captain_method"] = "Pick the largest aggregate GW forecast among players with projected GW minutes >=45 (v0.3). Sum actual fixture points across doubles."
    squads = [{"gw": gw, **{key: best_squad(players, key) for _, key in MODELS}}
              for gw, players in player_weeks(records).items()]
    result["budget_squads"] = {key: float(np.mean([g[key] for g in squads])) for _, key in MODELS}
    result["budget_squad_gameweeks"] = squads
    result["budget_squad_method"] = (
        f"Per GW, each forecast picks its best legal squad: 2/5/5/3, £{SQUAD_BUDGET:.0f}m at origin prices, "
        f"3 per club, legal XI, captain, bench weight {BENCH_WEIGHT}. Score: actual XI points with the captain "
        "doubled, no autosubs or transfers.")
    result["decision_differences"] = {
        key: {"budget_squad": paired_bootstrap([g["component"] for g in squads], [g[key] for g in squads], rng),
              "captain": paired_bootstrap([g["component"] for g in captains], [g[key] for g in captains], rng)}
        for _, key in MODELS[1:]
    }
    result["decision_method"] = "Mean per-GW points difference, component minus model; 5000 GW-resampling replicates; positive favours the component model."
    result["mae_differences"] = {
        key: {**bootstrap_difference(per_gw, "component", key, "mae", rng),
              "method": "5000 gameweek-cluster bootstrap replicates; seed 42; negative favours the component model."}
        for _, key in MODELS[1:]
    }
    result["rmse_differences"] = {
        key: {**bootstrap_difference(per_gw, "component", key, "rmse", rng),
              "method": "Per-GW RMSE differences, 5000 gameweek-cluster bootstrap replicates; negative favours the component model."}
        for _, key in MODELS[1:]
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps({key: result[key] for key in (
        "models", "all_players", "flagged_players", "budget_squads", "captains", "decision_differences",
        "rmse_differences")} | {"appearance": result["appearance"]["next_gw"]}, indent=2))
    return result


if __name__ == "__main__":
    run_evaluation()

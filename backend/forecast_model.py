"""Fitted minutes and event-rate sub-models (component forecast v0.3).

`model_params.json` is produced by `python -m backend.fit` from archived seasons
only. Live forecasts, fitting and the historical evaluation all build features
with the functions below, so training and serving inputs cannot drift apart.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

PARAMS_PATH = Path(__file__).with_name("model_params.json")
RATE_HALF_LIFE = 32
DC_HALF_LIFE = 16
RATE_WINDOW = 80
HALF_LIVES = (DC_HALF_LIFE, RATE_HALF_LIFE)
WEIGHTED_STATS = (
    "expected_goals",
    "expected_assists",
    "goals_scored",
    "assists",
    "bonus",
    "saves",
    "yellow_cards",
)
PRICE_PRIOR_STATS = WEIGHTED_STATS
DC_THRESHOLDS = {2: 10, 3: 12, 4: 12}
ROLE_FEATURES = [
    "m1", "m3", "m6", "m10", "m20", "m38", "l3", "l10", "p3", "p10", "s3", "s10",
    "cur_n", "cur_m", "prev_m", "has_prev", "zero_streak", "since_start", "n", "new",
    "log_price", "team_changed", "gk", "def", "fwd",
]
# Only the first INTERACTED role features vary with horizon in the logit.
INTERACTED = 20
MINUTES_FEATURES = ROLE_FEATURES + [f"{name}*log_h" for name in ROLE_FEATURES[:INTERACTED]] + ["log_h"]
# Official flag levels below "available"; each has its own fitted availability curve.
FLAG_LEVELS = ("d75", "d50", "d25", "out")
LEAD_TERMS = ("intercept", "log_h", "next_gw")
FLAG_TERMS = (*LEAD_TERMS, "role_logit", "role_logit*next_gw")


def load_params(path=PARAMS_PATH):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None


PARAMS = load_params()


def previous_season(season):
    start = int(str(season)[:4]) - 1
    return f"{start}-{str(start + 1)[-2:]}"


def _mean(values):
    return sum(values) / len(values) if values else 0.0


def player_state(rows, season):
    """Sufficient statistics of a player's chronologically ordered prior rows."""
    mins = [float(r.get("minutes", 0) or 0) for r in rows]
    starts = [float(r.get("starts", 0) or 0) for r in rows]
    state = {"n": len(rows)}
    for k in (1, 3, 6, 10, 20, 38):
        state[f"m{k}"] = _mean(mins[-k:]) / 90
    for k in (3, 10):
        recent = mins[-k:]
        state[f"l{k}"] = _mean([m >= 60 for m in recent])
        state[f"p{k}"] = _mean([m > 0 for m in recent])
        state[f"s{k}"] = _mean(starts[-k:])
    previous = previous_season(season)
    current = [m for r, m in zip(rows, mins) if r.get("season") == season]
    prior = [m for r, m in zip(rows, mins) if r.get("season") == previous]
    state.update(cur_n=len(current), cur_m=_mean(current) / 90,
                 prev_n=len(prior), prev_m=_mean(prior) / 90)
    streak = 0
    for m in reversed(mins):
        if m > 0:
            break
        streak += 1
    since_start = 0
    for s in reversed(starts):
        if s > 0:
            break
        since_start += 1
    state.update(zero_streak=streak, since_start=since_start,
                 last_team=rows[-1].get("team", "") if rows else "",
                 last_price=float(rows[-1].get("price", 0) or 0) if rows else 0.0)
    played = [r for r, m in zip(rows, mins) if m > 0][-RATE_WINDOW:]
    weights = {hl: [0.5 ** ((len(played) - i - 1) / hl) for i in range(len(played))]
               for hl in HALF_LIVES}
    for hl, ws in weights.items():
        sums = dict.fromkeys(("min", "n", "teamxg", "dc", "dcmin", *WEIGHTED_STATS), 0.0)
        for r, w in zip(played, ws):
            minutes = float(r.get("minutes", 0) or 0)
            sums["min"] += w * minutes
            sums["n"] += w
            sums["teamxg"] += w * float(r.get("team_xg", r.get("team_goals", 0)) or 0)
            for key in WEIGHTED_STATS:
                sums[key] += w * float(r.get(key, 0) or 0)
            if str(r.get("season", "")) >= "2025-26":
                sums["dcmin"] += w * minutes
                sums["dc"] += w * float(r.get("defensive_contribution", 0) or 0)
        for key, value in sums.items():
            state[f"w{hl}_{key}"] = value
    return state


def role_vector(state, price, pos, team_changed):
    return [
        state["m1"], state["m3"], state["m6"], state["m10"], state["m20"], state["m38"],
        state["l3"], state["l10"], state["p3"], state["p10"], state["s3"], state["s10"],
        min(state["cur_n"], 10) / 10, state["cur_m"], state["prev_m"], float(state["prev_n"] > 0),
        math.log1p(min(state["zero_streak"], 15)), math.log1p(min(state["since_start"], 20)),
        math.log1p(min(state["n"], 60)), float(state["n"] == 0),
        math.log(max(price, 3.5)), float(bool(team_changed)),
        float(pos == 1), float(pos == 2), float(pos == 4),
    ]


def flag_category(status, chance):
    """Official status/percentage -> fitted flag level; None outside the player pool."""
    if status in ("u", "n"):
        return None
    if chance is None:
        chance = {"a": 100, "d": 50}.get(status, 0)
    if chance >= 88:
        return "available"
    for level, lower in zip(FLAG_LEVELS, (63, 38, 13)):
        if chance >= lower:
            return level
    return "out"


def minutes_design(base, horizon, cap):
    log_h = math.log(min(max(horizon, 1), cap))
    return [*base, *(value * log_h for value in base[:INTERACTED]), log_h]


def lead_terms(horizon, cap):
    return (1.0, math.log(min(max(horizon, 1), cap)), float(horizon <= 1))


def flag_terms(horizon, cap, selection):
    """Availability-curve inputs; regulars return from a flag faster than fringe players."""
    selection = min(max(selection, 1e-6), 1 - 1e-6)
    role = math.log(selection / (1 - selection))
    terms = lead_terms(horizon, cap)
    return (*terms, role, role * terms[2])


def _sigmoid(z):
    return 1 / (1 + math.exp(-z)) if z >= 0 else math.exp(z) / (1 + math.exp(z))


def minutes_probabilities(base, horizon, params=None, flag="available"):
    """(P(no appearance), P(1-59), P(60+)) for a player available on the day.

    Fitted on players flagged available at the origin. For a flagged player
    `base` must exclude the current absence spell, as in fitting; `flag` then
    shifts the long/short split of an appearance (returning players are more
    often used as substitutes). Multiply by `availability_factor` for the
    unconditional probabilities.
    """
    params = params or PARAMS
    m = params["minutes"]
    x = minutes_design(base, horizon, m["horizon_cap"])
    if len(m["mean"]) != len(x):
        raise ValueError("model_params.json does not match MINUTES_FEATURES; rerun python -m backend.fit")
    scaled = [(v - mu) / sd for v, mu, sd in zip(x, m["mean"], m["scale"])]
    logits = [b + sum(c * v for c, v in zip(coef, scaled))
              for coef, b in zip(m["coef"], m["intercept"])]
    top = max(logits)
    exp = [math.exp(z - top) for z in logits]
    total = sum(exp)
    p0, short, long = (e / total for e in exp)
    if flag in FLAG_LEVELS and params.get("availability"):
        play = short + long
        share = min(max(long / play, 1e-9), 1 - 1e-9) if play > 0 else 0.5
        shift = sum(c * t for c, t in zip(params["availability"][flag]["long_shift"],
                                          lead_terms(horizon, m["horizon_cap"])))
        long = play * _sigmoid(math.log(share / (1 - share)) + shift)
        short = play - long
    return p0, short, long


def availability_factor(horizon, flag, selection, params=None):
    """Fitted probability that a player with this origin flag is available.

    `selection` is the player's P(appearance | available) at this lead.
    """
    if flag is None:
        return 0.0
    params = params or PARAMS
    if flag == "available" or not params or not params.get("availability"):
        return 1.0
    coef = params["availability"][flag]["play"]
    terms = flag_terms(horizon, params["minutes"]["horizon_cap"], selection)
    if len(coef) != len(terms):
        raise ValueError("model_params.json does not match FLAG_TERMS; rerun python -m backend.fit")
    return _sigmoid(sum(c * t for c, t in zip(coef, terms)))


def prior_rate(params, stat, pos, price):
    a, b, scale = params["rate_priors"][stat][str(pos)]
    return max((math.exp(a + b * math.log(max(price, 3.5))) - 0.01) * scale, 1e-4)


def team_xg(state):
    n = state[f"w{RATE_HALF_LIFE}_n"]
    return max(state[f"w{RATE_HALF_LIFE}_teamxg"] / n, 0.25) if n > 0.5 else 1.35


def fitted_rates(state, pos, price, params=None):
    """Calibrated per-90 rates at the player's historical team attack."""
    params = params or PARAMS
    tau = params["rate_prior_minutes"]
    hl = RATE_HALF_LIFE

    def shrunk(stat):
        prior = prior_rate(params, stat, pos, price)
        return 90 * (state[f"w{hl}_{stat}"] + prior * tau / 90) / (state[f"w{hl}_min"] + tau)

    raw = {stat: shrunk(stat) for stat in PRICE_PRIOR_STATS}
    cg, ca = params["goals"][str(pos)], params["assists"][str(pos)]
    dc = params["defensive"]
    dc_prior = dc["prior_rate"].get(str(pos), 0.0)
    dc_tau = dc["prior_minutes"]
    return {
        "expected_goals": cg[0] * raw["expected_goals"] + cg[1] * raw["goals_scored"],
        "expected_assists": ca[0] * raw["expected_assists"] + ca[1] * raw["expected_goals"]
        + ca[2] * raw["assists"],
        "bonus": raw["bonus"],
        "saves": raw["saves"],
        "yellow_cards": raw["yellow_cards"],
        "raw_xg90": raw["expected_goals"],
        "raw_xa90": raw["expected_assists"],
        "team_xg": team_xg(state),
        "bonus_model": list(params["bonus"][str(pos)]),
        "dc_rate": 90 * (state[f"w{DC_HALF_LIFE}_dc"] + dc_prior * dc_tau / 90)
        / (state[f"w{DC_HALF_LIFE}_dcmin"] + dc_tau) if pos in DC_THRESHOLDS else 0.0,
        "dc_dispersion": dc["dispersion"],
    }


def negative_binomial_tail(threshold, mean, dispersion):
    """P(X >= threshold) for X ~ NegBin(mean, dispersion k)."""
    if mean <= 0 or threshold <= 0:
        return 0.0 if mean <= 0 else 1.0
    p = dispersion / (dispersion + mean)
    pmf = p ** dispersion
    cdf = pmf
    for x in range(threshold - 1):
        pmf *= (x + dispersion) / (x + 1) * (1 - p)
        cdf += pmf
    return min(1.0, max(0.0, 1 - cdf))


def dc_hit_probability(rate90, minutes, pos, dispersion):
    threshold = DC_THRESHOLDS.get(pos)
    if threshold is None:
        return 0.0
    return negative_binomial_tail(threshold, rate90 * minutes / 90, dispersion)


def clean_sheet_probability(conceded, params=None):
    a, b = (params or PARAMS)["clean_sheet"]
    z = a + b * math.log(max(conceded, 0.1))
    return 1 / (1 + math.exp(-z))

"""Fit the v0.3 component sub-models from archived seasons.

`python -m backend.fit` rewrites `backend/model_params.json`. Each training
example is built from rows of gameweeks before its origin (the first forecast
GW), and its targets are fixtures `h - 1` gameweeks later.
"""

from __future__ import annotations

import json
import math
import time
from array import array
from collections import defaultdict

import numpy as np

from . import forecast_model as F
from .availability import absence_censored_rows
from .data import load_archive, load_flag_archive, utcnow
from .model import PARAMETERS, attach_team_xg, team_ratings

ARCHIVE_SEASONS = ("2022-23", "2023-24", "2024-25", "2025-26")
DEPLOY_ORIGIN_SEASONS = ("2023-24", "2024-25", "2025-26")
FLAG_SEASONS = ("2024-25", "2025-26")
# A flag week is unusable when players flagged out after it often play next.
FLAG_MAX_RETURN_RATE = 0.1
FLAG_CODES = {"available": 0, **{level: i + 1 for i, level in enumerate(F.FLAG_LEVELS)}}
HORIZONS = (1, 2, 3, 4, 6, 8, 12, 16, 20)
HORIZON_CAP = 20
RATE_FIT_MAX_HORIZON = 3
RATE_PRIOR_MINUTES = 450
DC_PRIOR_MINUTES = 180
DC_DISPERSION = 20
PRIOR_MIN_MINUTES = 900
TARGET_FIELDS = ("minutes", "goals_scored", "assists", "bonus", "clean_sheets", "saves",
                 "yellow_cards", "defensive_contribution", "total_points")
STATE_FIELDS = tuple(f"w{hl}_{k}" for hl in F.HALF_LIVES
                     for k in ("min", "n", "teamxg", "dc", "dcmin", *F.WEIGHTED_STATS))


def training_rows(seasons=ARCHIVE_SEASONS):
    rows = []
    for season in seasons:
        rows.extend(load_archive(season))
    # The 2022-23 archive has no xG before GW16; dropping those rows keeps
    # every rate numerator and its minutes denominator on the same footing.
    rows = [r for r in rows if not (r["season"] == "2022-23" and r["gw"] < 16)]
    return sorted(attach_team_xg(rows), key=lambda r: (r["date"], r["code"]))


def training_flags(rows, seasons=FLAG_SEASONS):
    """Validated archived flags: {(season, gw): {code: (status, chance, news)}}.

    Flags after GW g describe the deadline of GW g + 1. The download's 2025/26
    GW1-10 snapshots fail validation (30-41% of flagged-out players played next).
    """
    played = defaultdict(float)
    for r in rows:
        played[(r["season"], r["code"], r["gw"])] += r["minutes"]
    result = {}
    for season in seasons:
        by_gw = defaultdict(dict)
        for code, weeks in load_flag_archive(season).items():
            for gw, flag in weeks.items():
                by_gw[gw][code] = flag
        for gw, flags in by_gw.items():
            out = [code for code, (status, chance, _) in flags.items()
                   if status in ("i", "s", "u", "n") or chance == 0]
            if len(out) >= 20 and sum(
                played[(season, code, gw + 1)] > 0 for code in out
            ) <= FLAG_MAX_RETURN_RATE * len(out):
                result[(season, gw)] = flags
    return result


def case_flag(case):
    """(flag level, minutes rows) at the origin: "unknown" without a valid snapshot,
    None outside the pool or suspended (fixed-length bans follow declared rules);
    a flagged player's current absence spell is censored."""
    if not case.get("flag"):
        return "unknown", case["prior"]
    status, chance, news = case["flag"]
    player = {"status": status, "chance_of_playing_next_round": chance, "news": news}
    level = None if status == "s" else F.flag_category(status, chance)
    return level, absence_censored_rows(case["prior"], player)


def fixture_context(ratings, average, row):
    own = ratings.get(row["team"], {"attack": average, "defence": average})
    opp = ratings.get(row.get("opponent"), {"attack": average, "defence": average})
    venue = PARAMETERS["team_home_multiplier"] if row["home"] else 1 / PARAMETERS["team_home_multiplier"]
    return (own["attack"] * opp["defence"] / average * venue,
            opp["attack"] * own["defence"] / average / venue)


def origins(rows, origin_seasons, horizons=HORIZONS, flags=None):
    """Yield causal (origin, player, targets) cases; targets carry fixture context."""
    by_player, by_sgw, by_season = defaultdict(list), defaultdict(list), defaultdict(list)
    for r in rows:
        by_player[r["code"]].append(r)
        by_sgw[(r["season"], r["gw"])].append(r)
        by_season[r["season"]].append(r)
    for season in origin_seasons:
        previous = F.previous_season(season)
        for gw in range(1, 39):
            if not by_sgw.get((season, gw)):
                continue
            seen = by_season[previous] + [r for r in by_season[season] if r["gw"] < gw]
            ratings, average = team_ratings(seen) if seen else ({}, 1.5)
            origin_price = {r["code"]: r["price"] for r in by_sgw[(season, gw)]}
            flag_week = (flags or {}).get((season, gw - 1))
            first_kickoff = min(r["date"] for r in by_sgw[(season, gw)])
            targets = defaultdict(list)
            for h in horizons:
                for r in by_sgw.get((season, gw + h - 1), []):
                    targets[r["code"]].append((h, r, *fixture_context(ratings, average, r)))
            for code, items in targets.items():
                prior = [r for r in by_player[code] if (r["season"], r["gw"]) < (season, gw)]
                first = items[0][1]
                price = origin_price.get(code) or (prior[-1]["price"] if prior else first["price"])
                yield {
                    "season": season, "gw": gw, "code": code, "position": first["position"],
                    "team": first["team"], "price": price, "prior": prior, "targets": items,
                    "flag": flag_week.get(code) if flag_week is not None else None,
                    "first_kickoff": first_kickoff,
                }


class Columns:
    def __init__(self, names):
        self.data = {name: array("d") for name in names}

    def add(self, values):
        for name, column in self.data.items():
            column.append(float(values[name]))

    def numpy(self):
        return {name: np.frombuffer(column, dtype=float).copy() for name, column in self.data.items()}


def build_examples(rows, origin_seasons, horizons=HORIZONS, flags=None, log=print):
    started = time.time()
    state_names = ("season", "gw", "code", "pos", "price", "flag", *STATE_FIELDS)
    fixture_names = ("state", "h", "gf", "ga", *(f"a_{k}" for k in TARGET_FIELDS))
    states, fixtures, base = Columns(state_names), Columns(fixture_names), array("d")
    last = None
    for case in origins(rows, origin_seasons, horizons, flags):
        state = F.player_state(case["prior"], case["season"])
        level, minutes_rows = case_flag(case)
        minutes_state = (state if minutes_rows is case["prior"]
                         else F.player_state(minutes_rows, case["season"]))
        changed = bool(minutes_state["last_team"]) and minutes_state["last_team"] != case["team"]
        base.extend(F.role_vector(minutes_state, case["price"], case["position"], changed))
        index = len(states.data["gw"])
        states.add({**state, "season": int(case["season"][:4]), "gw": case["gw"],
                    "code": case["code"], "pos": case["position"], "price": case["price"],
                    "flag": FLAG_CODES.get(level, -1 if level == "unknown" else -2)})
        for h, r, gf, ga in case["targets"]:
            fixtures.add({"state": index, "h": h, "gf": gf, "ga": ga,
                          **{f"a_{k}": r.get(k, 0) or 0 for k in TARGET_FIELDS}})
        if (case["season"], case["gw"]) != last:
            last = (case["season"], case["gw"])
            if case["gw"] % 10 == 1:
                log(f"examples {last[0]} GW{last[1]}: {index + 1} states, {time.time() - started:.0f}s")
    result = {"states": states.numpy(), "fixtures": fixtures.numpy()}
    result["base"] = np.frombuffer(base, dtype=float).reshape(-1, len(F.ROLE_FEATURES)).copy()
    result["fixtures"]["state"] = result["fixtures"]["state"].astype(int)
    return result


def minutes_matrix(base, h):
    log_h = np.log(np.clip(h, 1, HORIZON_CAP))
    return np.column_stack([base, base[:, :F.INTERACTED] * log_h[:, None], log_h])


def fit_minutes(examples, mask):
    """Selection of players flagged available at the origin (validated flag weeks only)."""
    from sklearn.linear_model import LogisticRegression

    fx = examples["fixtures"]
    flags = examples["states"]["flag"][fx["state"]]
    mask = mask & (flags == FLAG_CODES["available"])
    X = minutes_matrix(examples["base"][fx["state"][mask]], fx["h"][mask])
    minutes = fx["a_minutes"][mask]
    y = np.where(minutes >= 60, 2, np.where(minutes > 0, 1, 0))
    mean, scale = X.mean(0), X.std(0)
    scale[scale < 1e-9] = 1.0
    X = (X - mean) / scale
    model = LogisticRegression(C=1.0, max_iter=500).fit(X, y)
    p = np.clip(model.predict_proba(X)[np.arange(len(y)), y], 1e-9, 1)
    return {
        "features": F.MINUTES_FEATURES, "horizon_cap": HORIZON_CAP,
        "mean": mean.tolist(), "scale": scale.tolist(),
        "coef": model.coef_.tolist(), "intercept": model.intercept_.tolist(),
        "classes": ["0", "1-59", "60+"], "training_rows": int(len(y)),
        "origin_seasons": sorted({f"{int(s)}-{str(int(s) + 1)[-2:]}"
                                  for s in examples["states"]["season"][fx["state"][mask]]}),
        "training_log_loss": float(-np.mean(np.log(p))),
    }


def minutes_matrix_probabilities(examples, rows, minutes):
    fx = examples["fixtures"]
    X = minutes_matrix(examples["base"][fx["state"][rows]], fx["h"][rows])
    Z = (X - np.array(minutes["mean"])) / np.array(minutes["scale"])
    L = Z @ np.array(minutes["coef"]).T + np.array(minutes["intercept"])
    L -= L.max(1, keepdims=True)
    P = np.exp(L)
    return P / P.sum(1, keepdims=True)


def fit_availability(examples, mask, minutes):
    """Per flag level: P(available | flag, lead) and the long-appearance logit shift.

    P(appearance) = availability * P(appearance | available role), by maximum
    likelihood with the fitted selection model as a fixed offset.
    """
    from scipy.optimize import minimize

    fx = examples["fixtures"]
    flags = examples["states"]["flag"][fx["state"]]
    result = {}
    for level in F.FLAG_LEVELS:
        rows = np.flatnonzero(mask & (flags == FLAG_CODES[level]))
        P = minutes_matrix_probabilities(examples, rows, minutes)
        h = fx["h"][rows]
        T = np.column_stack([np.ones(len(rows)), np.log(np.clip(h, 1, HORIZON_CAP)), (h <= 1).astype(float)])
        minutes_played = fx["a_minutes"][rows]
        play, selected = minutes_played > 0, np.clip(1 - P[:, 0], 1e-6, 1 - 1e-6)
        role = np.log(selected / (1 - selected))
        A = np.column_stack([T, role, role * T[:, 2]])

        def play_loss(c):
            q = np.clip(selected / (1 + np.exp(-(A @ c))), 1e-9, 1 - 1e-9)
            return -np.sum(play * np.log(q) + (~play) * np.log(1 - q))

        share = np.clip(P[play, 2] / selected[play], 1e-9, 1 - 1e-9)
        offset, long = np.log(share / (1 - share)), minutes_played[play] >= 60

        def long_loss(c):
            q = np.clip(1 / (1 + np.exp(-(offset + T[play] @ c))), 1e-9, 1 - 1e-9)
            return -np.sum(long * np.log(q) + (~long) * np.log(1 - q))

        result[level] = {
            "play": minimize(play_loss, np.zeros(A.shape[1]), method="L-BFGS-B").x.tolist(),
            "long_shift": minimize(long_loss, np.zeros(T.shape[1]), method="L-BFGS-B").x.tolist(),
            "rows": int(len(rows)),
        }
    return {"play_terms": list(F.FLAG_TERMS), "long_shift_terms": list(F.LEAD_TERMS), **result}

def fit_rate_priors(rows, seasons):
    totals = defaultdict(lambda: defaultdict(float))
    first_price = {}
    for r in rows:
        if r["season"] not in seasons:
            continue
        key = (r["season"], r["code"], r["position"])
        first_price.setdefault(key, r["price"])
        totals[key]["minutes"] += r["minutes"]
        for stat in F.PRICE_PRIOR_STATS:
            totals[key][stat] += r.get(stat, 0) or 0
    result = {}
    for stat in F.PRICE_PRIOR_STATS:
        result[stat] = {}
        for pos in (1, 2, 3, 4):
            sample = [(math.log(max(first_price[k], 3.5)), t[stat] / t["minutes"] * 90, t["minutes"])
                      for k, t in totals.items() if k[2] == pos and t["minutes"] >= PRIOR_MIN_MINUTES]
            x, y, w = (np.array(v) for v in zip(*sample))
            A = np.column_stack([np.ones_like(x), x])
            # Weighted log-linear fit, rescaled so the minute-weighted mean is exact.
            coef = np.linalg.lstsq(A * np.sqrt(w)[:, None], np.log(y + 0.01) * np.sqrt(w), rcond=None)[0]
            pred = np.maximum(np.exp(A @ coef) - 0.01, 1e-4)
            result[stat][str(pos)] = [float(coef[0]), float(coef[1]), float(np.sum(w * y) / np.sum(w * pred))]
    return result


def rate_regressors(examples, mask, params):
    st, fx = examples["states"], examples["fixtures"]
    s = fx["state"][mask]
    pos, price = st["pos"][s], st["price"][s]
    tau, hl = params["rate_prior_minutes"], F.RATE_HALF_LIFE
    out = {}
    for stat in F.PRICE_PRIOR_STATS:
        prior = np.array([F.prior_rate(params, stat, int(p), float(c)) for p, c in zip(pos, price)])
        out[stat] = 90 * (st[f"w{hl}_{stat}"][s] + prior * tau / 90) / (st[f"w{hl}_min"][s] + tau)
    n = st[f"w{hl}_n"][s]
    txg = np.where(n > 0.5, np.maximum(st[f"w{hl}_teamxg"][s] / np.maximum(n, 1e-9), 0.25), 1.35)
    out["attack"] = np.clip(fx["gf"][mask] / txg, 0.5, 2.0)
    out["pos"] = pos
    return out


def fit_params(examples, rows, origin_seasons, prior_seasons, log=print):
    from scipy.optimize import nnls
    from sklearn.linear_model import LogisticRegression

    st, fx = examples["states"], examples["fixtures"]
    origin_years = [int(s[:4]) for s in origin_seasons]
    in_train = np.isin(st["season"][fx["state"]], origin_years)
    started = time.time()
    params = {
        "version": "open-fpl-components-0.3",
        "fitted_at": utcnow(),
        "source": "vaastav/Fantasy-Premier-League archives (players_raw.csv, gws/merged_gw.csv)",
        "origin_seasons": list(origin_seasons),
        "prior_seasons": list(prior_seasons),
        "horizons": list(HORIZONS),
        "rate_half_life": F.RATE_HALF_LIFE,
        "rate_prior_minutes": RATE_PRIOR_MINUTES,
    }
    params["minutes"] = fit_minutes(examples, in_train)
    log(f"minutes logit fitted on {params['minutes']['training_rows']} fixtures, {time.time() - started:.0f}s")
    params["availability"] = fit_availability(examples, in_train, params["minutes"])
    params["rate_priors"] = fit_rate_priors(rows, set(prior_seasons))
    played = in_train & (fx["a_minutes"] > 0) & (fx["h"] <= RATE_FIT_MAX_HORIZON)
    R = rate_regressors(examples, played, params)
    minutes = fx["a_minutes"][played]
    exposure = minutes / 90 * R["attack"]
    params["goals"], params["assists"], params["bonus"] = {}, {}, {}
    long_play = (minutes >= 60).astype(float)
    cs_rows = in_train & (fx["a_minutes"] >= 60) & (fx["h"] <= RATE_FIT_MAX_HORIZON) & (st["pos"][fx["state"]] != 4)
    cs_model = LogisticRegression(C=10).fit(np.log(np.maximum(fx["ga"][cs_rows], 0.1))[:, None],
                                            fx["a_clean_sheets"][cs_rows] > 0)
    params["clean_sheet"] = [float(cs_model.intercept_[0]), float(cs_model.coef_[0, 0])]
    cs = 1 / (1 + np.exp(-(params["clean_sheet"][0] + params["clean_sheet"][1]
                           * np.log(np.maximum(fx["ga"][played], 0.1)))))
    for pos in (1, 2, 3, 4):
        m = R["pos"] == pos
        Xg = np.column_stack([R["expected_goals"], R["goals_scored"]])[m] * exposure[m, None]
        cg = nnls(Xg, fx["a_goals_scored"][played][m])[0]
        Xa = np.column_stack([R["expected_assists"], R["expected_goals"], R["assists"]])[m] * exposure[m, None]
        ca = nnls(Xa, fx["a_assists"][played][m])[0]
        goals, assists = Xg @ cg, Xa @ ca
        if pos == 1:
            goals, assists = goals * 0, assists * 0  # Keeper bonus: no attacking terms.
        Xb = np.column_stack([R["bonus"][m] * minutes[m] / 90, goals, assists,
                              cs[m] * long_play[m], long_play[m]])
        cb = nnls(Xb, fx["a_bonus"][played][m])[0]
        params["goals"][str(pos)] = cg.tolist()
        params["assists"][str(pos)] = ca.tolist()
        params["bonus"][str(pos)] = cb.tolist()
    dc_rows = in_train & (fx["a_minutes"] > 0) & (fx["h"] <= RATE_FIT_MAX_HORIZON) & (st["season"][fx["state"]] >= 2025)
    prior_rate = {}
    for pos in (2, 3, 4):
        m = dc_rows & (st["pos"][fx["state"]] == pos)
        if m.any():
            prior_rate[str(pos)] = float(fx["a_defensive_contribution"][m].sum() / fx["a_minutes"][m].sum() * 90)
    params["defensive"] = {
        "half_life": F.DC_HALF_LIFE, "prior_minutes": DC_PRIOR_MINUTES, "dispersion": DC_DISPERSION,
        "thresholds": {str(k): v for k, v in F.DC_THRESHOLDS.items()}, "prior_rate": prior_rate,
        "prior_source": "2025-26+ training rows" if prior_rate else "none: no DC-scoring season in training",
    }
    params["diagnostics"] = {
        "rate_rows": int(played.sum()), "clean_sheet_rows": int(cs_rows.sum()),
        "dc_rows": int(dc_rows.sum()), "fit_seconds": round(time.time() - started, 1),
    }
    return params


def fit(origin_seasons=DEPLOY_ORIGIN_SEASONS, prior_seasons=ARCHIVE_SEASONS, rows=None, log=print,
        flags=None):
    rows = rows if rows is not None else training_rows()
    flags = flags if flags is not None else training_flags(rows)
    log(f"validated flag weeks: {sorted(flags)}")
    examples = build_examples(rows, origin_seasons, flags=flags, log=log)
    params = fit_params(examples, rows, origin_seasons, prior_seasons, log=log)
    params["flag_source"] = {
        "url": "https://github.com/olbauday/FPL-Core-Insights (playerstats.csv per season)",
        "weeks": [f"{season} GW{gw}" for season, gw in sorted(flags)],
        "validation": f"flagged-out players appearing next GW <= {FLAG_MAX_RETURN_RATE:.0%}",
    }
    return params


def main():
    params = fit()
    F.PARAMS_PATH.write_text(json.dumps(params, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {F.PARAMS_PATH}: minutes rows {params['minutes']['training_rows']}, "
          f"log loss {params['minutes']['training_log_loss']:.4f}")


if __name__ == "__main__":
    main()

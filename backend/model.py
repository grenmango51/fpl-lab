"""Causal, component-based FPL forecasts. All probabilities are model estimates."""

from __future__ import annotations

import hashlib
import math
import threading
from collections import defaultdict

import numpy as np

from . import forecast_model
from .data import get_data, number
from .availability import (absence_censored_rows, fixture_availability, next_availability,
                           parsed_time, selection_rows)

VERSION = "open-fpl-components-0.3"
POSITIONS = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}
DEFAULT_SCORING = {
    "long_play": 2,
    "short_play": 1,
    "goals_scored": {"GKP": 10, "DEF": 6, "MID": 5, "FWD": 4},
    "assists": 3,
    "clean_sheets": {"GKP": 4, "DEF": 4, "MID": 1, "FWD": 0},
    "defensive_contribution": {"GKP": 0, "DEF": 2, "MID": 2, "FWD": 2},
}
# These are declared regularisation choices, not observed data or calibrated facts.
PARAMETERS = {
    "rate_prior_minutes": 450,
    "minutes_half_life_matches": 3,
    "rate_half_life_matches": 15,
    "appearance_prior_matches": 0.25,
    "long_minutes_prior": 80,
    "short_minutes_prior": 20,
    "team_prior_matches": 8,
    "team_home_multiplier": 1.10,
}
_projections = None
_projection_key = None
_projection_lock = threading.RLock()


def fitted_fixture_availability(assumption, player, features, lead, params=None):
    """Swap declared flag percentages and recovery decay for the fitted flag curve.

    Dated returns (0 before, 1 after), suspensions and unregistered players keep
    their declared rules. The fitted value is the probability of being available;
    selection given availability stays in the minutes model.
    """
    params = params or forecast_model.PARAMS
    level = forecast_model.flag_category(
        player["status"], player.get("chance_of_playing_next_round")
    )
    if (features is None or not params or not params.get("availability")
            or level in (None, "available")
            or player["status"] not in ("a", "d", "i")
            or (assumption["source"] == "official news return-date assumption"
                and assumption["value"] in (0, 1))):
        return assumption
    return {
        **assumption,
        "value": forecast_model.availability_factor(
            lead, level, 1 - forecast_model.minutes_probabilities(features, lead, params)[0], params
        ),
        "source": "fitted flag availability model",
        "flag": level,
        "lead_gameweeks": lead,
    }


def weighted(rows, half_life):
    return [(r, 0.5 ** ((len(rows) - i - 1) / half_life)) for i, r in enumerate(rows)]


def positional_priors(history, before_season):
    sums = defaultdict(lambda: defaultdict(float))
    for r in history:
        if r["season"] >= before_season or r["minutes"] <= 0:
            continue
        s = sums[r["position"]]
        for k in [
            "minutes",
            "expected_goals",
            "expected_assists",
            "bonus",
            "saves",
            "yellow_cards",
            "red_cards",
            "own_goals",
            "penalties_missed",
            "penalties_saved",
        ]:
            s[k] += r.get(k, 0)
        if "defensive_contribution" in r and r["season"] >= "2025-26":
            threshold = 10 if r["position"] == 2 else 12
            s["dc_hits"] += r["defensive_contribution"] >= threshold
            s["dc_matches"] += 1
    result = {}
    for pos in range(1, 5):
        s = sums[pos]
        result[pos] = {
            k: s[k] / max(s["minutes"], 1) * 90
            for k in [
                "expected_goals",
                "expected_assists",
                "bonus",
                "saves",
                "yellow_cards",
                "red_cards",
                "own_goals",
                "penalties_missed",
                "penalties_saved",
            ]
        }
        result[pos]["dc_prob"] = s["dc_hits"] / max(s["dc_matches"], 1)
    return result


def appearance_profile(rows, availability=1.0, minutes_override=None, probabilities=None):
    """Appearance states only, allowing scenario profiles to reuse event rates.

    `probabilities` = (P0, P1-59, P60+) from the fitted minutes model; without it
    the declared recency-weighted heuristic of version 0.2 applies.
    """
    recent = rows[-10:]
    wr = weighted(recent, PARAMETERS["minutes_half_life_matches"])
    total = sum(w for _, w in wr)
    if probabilities is not None:
        pshort, p60 = probabilities[1], probabilities[2]
    else:
        # A declared zero-appearance pseudocount prevents certainty from a few starts.
        denominator = total + PARAMETERS["appearance_prior_matches"]
        p60 = sum(w for r, w in wr if r["minutes"] >= 60) / denominator if wr else 0
        pshort = sum(w for r, w in wr if 0 < r["minutes"] < 60) / denominator if wr else 0
    long_rows = [(r, w) for r, w in wr if r["minutes"] >= 60]
    short_rows = [(r, w) for r, w in wr if 0 < r["minutes"] < 60]
    long_mean = (
        sum(r["minutes"] * w for r, w in long_rows) + PARAMETERS["long_minutes_prior"]
    ) / (sum(w for _, w in long_rows) + 1)
    short_mean = (
        sum(r["minutes"] * w for r, w in short_rows) + PARAMETERS["short_minutes_prior"]
    ) / (sum(w for _, w in short_rows) + 1)
    p60 *= availability
    pshort *= availability
    if minutes_override is not None:
        override = min(90, max(0, minutes_override))
        # Explicit scenario: selected duration is conditional on availability.
        p60 = availability if override >= 60 else 0
        pshort = availability if 0 < override < 60 else 0
        long_mean = override if override >= 60 else long_mean
        short_mean = override if override < 60 else short_mean
    xmins = p60 * long_mean + pshort * short_mean
    return {
        "p60": p60,
        "pshort": pshort,
        "pplay": p60 + pshort,
        "xmins": xmins,
        "long_mean": long_mean,
        "short_mean": short_mean,
    }


def player_profile(rows, pos, prior, availability=1.0, minutes_override=None, *,
                   context=None, params=None):
    """Event rates and a default appearance profile.

    With `context` (season, price, team; optional minutes_rows) and fitted
    parameters, attacking/bonus/save/card/DC rates and the minutes-model inputs
    come from the fitted v0.3 sub-models. Without it the declared v0.2 rates apply.
    """
    params = params or forecast_model.PARAMS
    fitted = None
    if context is not None and params:
        season, price = context["season"], context["price"]
        minutes_rows = context.get("minutes_rows", rows)
        minutes_state = forecast_model.player_state(minutes_rows, season)
        changed = bool(minutes_state["last_team"]) and minutes_state["last_team"] != context["team"]
        fitted = {
            **forecast_model.fitted_rates(forecast_model.player_state(rows, season), pos, price, params),
            "minutes_features": forecast_model.role_vector(minutes_state, price, pos, changed),
        }
    appearance = appearance_profile(
        rows, availability, minutes_override,
        forecast_model.minutes_probabilities(fitted["minutes_features"], 1, params) if fitted else None,
    )
    rate_rows = weighted(rows[-45:], PARAMETERS["rate_half_life_matches"])
    minutes = sum(r["minutes"] * w for r, w in rate_rows)
    rates = {}
    for k in [
        "expected_goals",
        "expected_assists",
        "bonus",
        "saves",
        "yellow_cards",
        "red_cards",
        "own_goals",
        "penalties_missed",
        "penalties_saved",
    ]:
        numerator = sum(r.get(k, 0) * w for r, w in rate_rows)
        rates[k] = (
            (numerator + prior.get(k, 0) * PARAMETERS["rate_prior_minutes"] / 90)
            / (minutes + PARAMETERS["rate_prior_minutes"])
            * 90
        )
    dc_rows = [
        (r, w) for r, w in rate_rows if r["minutes"] > 0 and r["season"] >= "2025-26"
    ]
    threshold = 10 if pos == 2 else 12
    dc_prob = (
        (
            sum(
                w for r, w in dc_rows if r.get("defensive_contribution", 0) >= threshold
            )
            + prior.get("dc_prob", 0) * 3
        )
        / (sum(w for _, w in dc_rows) + 3)
        if pos != 1
        else 0
    )
    team_rows = [(r, w) for r, w in rate_rows if r["minutes"] > 0]
    team_xg = sum(
        r.get("team_xg", r.get("team_goals", 0)) * w for r, w in team_rows
    ) / max(sum(w for _, w in team_rows), 1)
    avg_points = sum(r.get("total_points", 0) for r in rows[-5:]) / max(len(rows[-5:]), 1)
    played = [r for r in rows if r["minutes"] > 0]
    ppg = sum(r.get("total_points", 0) for r in played) / max(len(played), 1)
    profile = {
        **appearance,
        "rates": rates,
        "dc_prob": dc_prob,
        "team_xg": max(team_xg, 0.25),
        "samples": len(rows),
        "form": avg_points,
        "ppg": ppg,
    }
    if fitted:
        for key in ("expected_goals", "expected_assists", "bonus", "saves", "yellow_cards"):
            rates[key] = fitted[key]
        profile.update(
            team_xg=fitted["team_xg"], bonus_model=fitted["bonus_model"],
            dc_rate=fitted["dc_rate"], dc_dispersion=fitted["dc_dispersion"],
            minutes_features=fitted["minutes_features"],
            raw_xg90=fitted["raw_xg90"], raw_xa90=fitted["raw_xa90"],
        )
        profile["dc_prob"] = forecast_model.dc_hit_probability(
            fitted["dc_rate"], appearance["long_mean"], pos, fitted["dc_dispersion"])
    return profile


def components(profile, pos, team_goals, conceded, cs_probability=None, scoring=None):
    scoring = scoring or DEFAULT_SCORING
    label = POSITIONS[pos]
    p60, ps, minutes = profile["p60"], profile["pshort"], profile["xmins"]
    # Limit extreme adjustments for players switching teams / small samples.
    attack_adjustment = min(2.0, max(0.5, team_goals / profile["team_xg"]))
    xg = profile["rates"]["expected_goals"] * minutes / 90 * attack_adjustment
    xa = profile["rates"]["expected_assists"] * minutes / 90 * attack_adjustment
    cs = (
        math.exp(-conceded)
        if cs_probability is None
        else min(1, max(0, cs_probability))
    )

    # Expected floor(N / 2) for N ~ Poisson(lambda): sum P(N >= 2k).
    def expected_pairs(lam):
        return lam / 2 - (1 - math.exp(-2 * lam)) / 4

    gc_loss = (
        (
            expected_pairs(conceded * profile["long_mean"] / 90) * p60
            + expected_pairs(conceded * profile["short_mean"] / 90) * ps
        )
        if pos in (1, 2)
        else 0
    )

    def save_expectation(lam):
        prob, value = math.exp(-lam), 0.0
        for count in range(1, 45):
            prob *= lam / count
            value += (count // 3) * prob
        return value

    save_points = (
        (
            p60
            * save_expectation(profile["rates"]["saves"] * profile["long_mean"] / 90)
            + ps
            * save_expectation(profile["rates"]["saves"] * profile["short_mean"] / 90)
        )
        if pos == 1
        else 0
    )
    rates = profile["rates"]
    if "dc_rate" in profile:
        # Fitted count model: hit probability depends on the minutes state.
        dc_expectation = sum(
            probability * forecast_model.dc_hit_probability(
                profile["dc_rate"], duration, pos, profile["dc_dispersion"])
            for probability, duration in ((p60, profile["long_mean"]), (ps, profile["short_mean"]))
            if probability
        )
    else:
        dc_expectation = profile["dc_prob"] * profile["pplay"]
    if "bonus_model" in profile:
        own, goal, assist, clean, long_play = profile["bonus_model"]
        bonus = (own * rates["bonus"] * minutes / 90 + goal * xg + assist * xa
                 + clean * cs * p60 + long_play * p60)
    else:
        bonus = rates["bonus"] * minutes / 90
    output = {
        "appearance": scoring.get("long_play", 2) * p60
        + scoring.get("short_play", 1) * ps,
        "goals": xg * scoring["goals_scored"][label],
        "assists": xa * scoring.get("assists", 3),
        "clean_sheet": cs * p60 * scoring["clean_sheets"][label],
        "defensive": dc_expectation
        * scoring.get("defensive_contribution", {}).get(label, 0),
        "bonus": bonus,
        "saves": save_points,
        "penalty_saves": rates["penalties_saved"] * minutes / 90 * 5,
        "deductions": -(
            rates["yellow_cards"]
            + 3 * rates["red_cards"]
            + 2 * rates["own_goals"]
            + 2 * rates["penalties_missed"]
        )
        * minutes
        / 90
        - gc_loss,
    }
    return {
        "points": max(0, sum(output.values())),
        "components": output,
        "xg": xg,
        "xa": xa,
        "cs": cs,
        "xmins": minutes,
        "pplay": profile["pplay"],
        "p60": p60,
        "team_goals": team_goals,
        "conceded": conceded,
    }


def attach_team_xg(history):
    totals = defaultdict(float)
    for r in history:
        totals[(r["fixture"], r["team"])] += r.get("expected_goals", 0)
    return [{**r, "team_xg": totals[(r["fixture"], r["team"])]} for r in history]


def team_ratings(history):
    matches = {}
    for row in history:
        key = (row["fixture"], row["team"])
        if key not in matches:
            matches[key] = {
                "date": row["date"],
                "gf": row["team_xg"],
                "ga": row.get("expected_goals_conceded", 0),
                "actual_ga": row.get("opponent_goals", 0),
                "team": row["team"],
                "home": row["home"],
            }
    # Sum opposition xG, rather than use the first player's conceded-xG statistic.
    for row in history:
        key = (row["fixture"], row["team"])
        opponent = matches.get((row["fixture"], row.get("opponent")))
        if opponent:
            matches[key]["ga"] = opponent["gf"]
    by_team = defaultdict(list)
    for match in sorted(matches.values(), key=lambda r: r["date"]):
        by_team[match["team"]].append(match)
    average = sum(m["gf"] for m in matches.values()) / max(len(matches), 1)
    result = {}
    for team, rows in by_team.items():
        values = weighted(rows[-30:], 10)
        denominator = sum(w for _, w in values) + PARAMETERS["team_prior_matches"]
        result[team] = {
            "attack": (
                sum(r["gf"] * w for r, w in values)
                + average * PARAMETERS["team_prior_matches"]
            )
            / denominator,
            "defence": (
                sum(r["ga"] * w for r, w in values)
                + average * PARAMETERS["team_prior_matches"]
            )
            / denominator,
        }
    return result, max(average, 0.5)


def fixture_projection(
    data, fixture, team_id, ratings, league_average, use_market=True
):
    teams = data["teams"]
    home = fixture["team_h"] == team_id
    own = teams[team_id]["short_name"]
    opp = teams[fixture["team_a"] if home else fixture["team_h"]]["short_name"]
    gw = fixture["event"]
    if use_market:
        period = (
            data["joe"]
            .get("projectionsByPeriod", {})
            .get(str(gw), {})
        )
        for row in period.get("fixtures", []):
            if (
                row.get("homeTeamCode") == teams[fixture["team_h"]]["short_name"]
                and row.get("awayTeamCode") == teams[fixture["team_a"]]["short_name"]
            ):
                gf = row.get("lambdaHome" if home else "lambdaAway")
                ga = row.get("lambdaAway" if home else "lambdaHome")
                cs = row.get("pHomeCs" if home else "pAwayCs")
                if gf is not None and ga is not None:
                    return {
                        "gf": gf,
                        "ga": ga,
                        "cs": cs,
                        "source": "FPL Joe · market",
                        "source_at": row.get("snapshotTsUtc") or period.get("latestSnapshotTs"),
                        "source_at_scope": "fixture" if row.get("snapshotTsUtc") else "gameweek latest snapshot",
                        "source_extracted_at": data.get("sources", {}).get("fpljoe", {}).get("fetched_at"),
                    }
        direct = data.get("elevenify", {})
        # Season sheets are GW aggregates. Do not duplicate them across doubles.
        game_count = sum(
            1
            for f in data["fixtures"]
            if f["event"] == gw and team_id in (f["team_h"], f["team_a"])
        )
        if (
            game_count == 1
            and gw in direct.get("goals", {}).get(own, {})
            and gw in direct.get("goals", {}).get(opp, {})
        ):
            return {
                "gf": direct["goals"][own][gw],
                "ga": direct["goals"][opp][gw],
                "cs": direct["clean_sheets"][own][gw],
                "source": "Elevenify · public sheet",
                "source_at": direct["source_at"],
            }
        supplemental = data["joe"].get("supplementalProjections", {})
        own_row = next(
            (t for t in supplemental.get("teams", []) if t.get("abbreviation") == own),
            None,
        )
        opp_row = next(
            (t for t in supplemental.get("teams", []) if t.get("abbreviation") == opp),
            None,
        )
        periods = supplemental.get("periods", [])
        if game_count == 1 and own_row and opp_row and gw in periods:
            index = periods.index(gw)
            if index < len(own_row.get("goals", [])) and index < len(
                opp_row.get("goals", [])
            ):
                return {
                    "gf": own_row["goals"][index],
                    "ga": opp_row["goals"][index],
                    "cs": own_row["cleanSheets"][index],
                    "source": "Elevenify · via FPL Joe",
                    "source_at": supplemental.get("source", {}).get("fetchedAt"),
                }
    a = ratings.get(own, {"attack": league_average, "defence": league_average})
    b = ratings.get(opp, {"attack": league_average, "defence": league_average})
    venue = (
        PARAMETERS["team_home_multiplier"]
        if home
        else 1 / PARAMETERS["team_home_multiplier"]
    )
    gf = a["attack"] * b["defence"] / league_average * venue
    ga = b["attack"] * a["defence"] / league_average / venue
    return {
        "gf": gf,
        "ga": ga,
        # Historical team estimates are shrunk; the fitted logistic restores spread.
        "cs": forecast_model.clean_sheet_probability(ga) if forecast_model.PARAMS else math.exp(-ga),
        "source": "Open FPL · historical fallback",
        "source_at": data["loaded_at"],
    }


def canonical_minutes_schedule(minutes_schedule, player_ids, gameweeks):
    """Validate direct callers too; the HTTP layer supplies additional messages."""
    if minutes_schedule is None:
        return {}
    if not isinstance(minutes_schedule, dict):
        raise ValueError("Minutes schedule must map player IDs to gameweek scenarios")
    result = {}
    for raw_pid, weeks in minutes_schedule.items():
        try:
            pid = str(int(raw_pid))
        except (TypeError, ValueError, OverflowError):
            raise ValueError("Invalid minutes-schedule player ID") from None
        if (
            isinstance(raw_pid, bool)
            or str(raw_pid) != pid
            or int(pid) not in player_ids
        ):
            raise ValueError("Unknown or invalid minutes-schedule player ID")
        if pid in result or not isinstance(weeks, dict) or not weeks:
            raise ValueError("Each scheduled player must have gameweek scenarios")
        result[pid] = {}
        for raw_gw, values in weeks.items():
            try:
                gw = str(int(raw_gw))
            except (TypeError, ValueError, OverflowError):
                raise ValueError("Invalid minutes-schedule gameweek") from None
            if (
                isinstance(raw_gw, bool)
                or str(raw_gw) != gw
                or int(gw) not in gameweeks
            ):
                raise ValueError(
                    "Minutes-schedule gameweek must be in the forecast horizon"
                )
            if gw in result[pid] or not isinstance(values, dict):
                raise ValueError("Invalid minutes-schedule scenario")
            if set(values) - {"conditional_minutes", "availability"}:
                raise ValueError("Unknown minutes-schedule scenario field")
            scenario = {}
            for field, limit in (("conditional_minutes", 90), ("availability", 1)):
                value = values.get(field)
                if value is None:
                    continue
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise ValueError(f"{field} must be a finite number")
                if not math.isfinite(value) or not 0 <= value <= limit:
                    raise ValueError(f"{field} must be between 0 and {limit}")
                scenario[field] = float(value)
            if not scenario:
                raise ValueError(
                    "A minutes scenario needs conditional_minutes or availability"
                )
            result[pid][gw] = scenario
    return result


def projections(
    overrides=None, use_market=True, minutes_schedule=None, *, dataset=None, cache=True
):
    with _projection_lock:
        return _build_projections(
            overrides, use_market, minutes_schedule, dataset=dataset, cache=cache
        )


def _build_projections(
    overrides=None, use_market=True, minutes_schedule=None, *, dataset=None, cache=True
):
    global _projections, _projection_key
    data = dataset if dataset is not None else get_data()
    overrides = overrides or {}
    start = data["next_gw"]
    horizon = list(range(start, 39))
    minutes_schedule = canonical_minutes_schedule(
        minutes_schedule, data["players"], horizon
    )
    schedule_key = tuple(
        (
            pid,
            tuple(
                (gw, tuple(sorted(values.items())))
                for gw, values in sorted(weeks.items())
            ),
        )
        for pid, weeks in sorted(minutes_schedule.items())
    )
    key = (
        data["loaded_at"],
        id(data),
        str(sorted(overrides.items())),
        use_market,
        schedule_key,
    )
    if cache and _projections is not None and _projection_key == key:
        return _projections
    history = attach_team_xg(data["history"])
    by_player = defaultdict(list)
    for r in sorted(history, key=lambda r: r["date"]):
        by_player[r["code"]].append(r)
    priors = positional_priors(history, data["season"])
    # Minutes-model lead time counts from the last gameweek in the history, as in
    # fitting. A skipped provisional or missing week therefore widens the lead.
    last_gw = max(
        (r["gw"] for r in history if r["season"] == data["season"] and "gw" in r),
        default=start - 1,
    )
    ratings, average = team_ratings(history)
    scoring = data["bootstrap"].get("game_config", {}).get("scoring", DEFAULT_SCORING)
    fixtures_by_team = defaultdict(list)
    for f in data["fixtures"]:
        if f["event"] in horizon and not f["finished"]:
            for tid in (f["team_h"], f["team_a"]):
                fixtures_by_team[tid].append(f)
    result = []
    for p in data["players"].values():
        pos = p["element_type"]
        if pos not in POSITIONS:
            continue
        chance = p.get("chance_of_playing_next_round")
        availability = next_availability(p)
        # Restrict minutes profile to current season if at least 3 games are observed.
        rows = by_player[p["code"]]
        current_rows = [r for r in rows if r["season"] == data["season"]]
        pid = str(p["id"])
        duration = overrides.get(pid)
        context = {
            "season": data["season"],
            "price": p["now_cost"] / 10,
            "team": data["teams"][p["team"]]["short_name"],
            # Selection conditional on return: a flagged player's current
            # absence spell is handled by fixture availability instead.
            "minutes_rows": absence_censored_rows(rows, p),
        }
        rate_profile = player_profile(
            rows, pos, priors[pos], availability, duration, context=context
        )
        appearance_rows = selection_rows(rows, data["season"], p)
        profiles, minutes_states = {}, {}

        def minutes_state(lead, flag):
            if "minutes_features" not in rate_profile:
                return None
            if (lead, flag) not in minutes_states:
                minutes_states[(lead, flag)] = forecast_model.minutes_probabilities(
                    rate_profile["minutes_features"], lead, flag=flag
                )
            return minutes_states[(lead, flag)]

        def resolved_profile(assumed_availability, conditional_minutes, lead=1, flag="available"):
            probabilities = minutes_state(lead, flag)
            profile_key = (assumed_availability, conditional_minutes, probabilities)
            if profile_key not in profiles:
                profiles[profile_key] = {
                    **rate_profile,
                    **appearance_profile(
                        appearance_rows, assumed_availability, conditional_minutes,
                        probabilities,
                    ),
                }
            return profiles[profile_key]

        profile = resolved_profile(availability, duration)
        origin = parsed_time(data["loaded_at"])
        week_scenarios = minutes_schedule.get(pid, {})
        per_gw = {
            str(gw): {
                "points": 0,
                "xmins": 0,
                "pplay": 0,
                "p60": 0,
                "fixtures": [],
                "components": {},
            }
            for gw in horizon
        }
        for gw, item in per_gw.items():
            scenario = week_scenarios.get(gw, {})
            assumed_availability = scenario.get("availability", availability)
            conditional_minutes = scenario.get("conditional_minutes", duration)
            if scenario or duration is not None:
                item["minutes_scenario"] = {
                    "conditional_minutes": conditional_minutes,
                    "availability": assumed_availability,
                    "label": "User-assumed minutes/availability scenario",
                    "conditional_minutes_source": "user-assumed"
                    if conditional_minutes is not None
                    else "automatic historical appearance profile",
                    "availability_source": "user-assumed"
                    if "availability" in scenario
                    else "automatic per-fixture availability",
                }
        for f in fixtures_by_team[p["team"]]:
            lead = max(1, f["event"] - last_gw)
            assumption = fitted_fixture_availability(
                fixture_availability(p, f["kickoff_time"], origin, next_week=f["event"] == start),
                p, rate_profile.get("minutes_features"), lead,
            )
            scenario = week_scenarios.get(str(f["event"]), {})
            fixture_profile = resolved_profile(
                scenario.get("availability", assumption["value"]),
                scenario.get("conditional_minutes", duration),
                lead,
                # An explicit availability assumption replaces the flag entirely.
                "available" if "availability" in scenario else assumption.get("flag", "available"),
            )
            context = fixture_projection(
                data.get("_fixture_source_data", data),
                data.get("_fixture_source_by_id", {}).get(f["id"], f),
                p["team"], ratings, average, use_market
            )
            forecast = components(
                fixture_profile,
                pos,
                context["gf"],
                context["ga"],
                context["cs"],
                scoring,
            )
            home = f["team_h"] == p["team"]
            opponent = data["teams"][f["team_a"] if home else f["team_h"]]
            fixture_row = {
                **forecast,
                "id": f["id"],
                "opponent": opponent["short_name"],
                "opponent_id": opponent["id"],
                "home": home,
                "difficulty": f["team_h_difficulty"]
                if home
                else f["team_a_difficulty"],
                "kickoff": f["kickoff_time"],
                "source": context["source"],
                "source_at": context["source_at"],
                "source_at_scope": context.get("source_at_scope"),
                "source_extracted_at": context.get("source_extracted_at"),
                "availability_assumption": assumption if "availability" not in scenario
                else {"value": scenario["availability"], "source": "user-assumed"},
            }
            if forecast["pplay"] == 0 and duration != 0:
                # A supplied positive appearance probability can restore an
                # unavailable/previously unseen player. Keep its conditional
                # event/long-short basis; do not divide by a zero forecast.
                basis_profile = dict(resolved_profile(1, duration, lead))
                probability = basis_profile["pplay"]
                if probability > 0:
                    for field in ("p60", "pshort", "xmins", "pplay"):
                        basis_profile[field] /= probability
                else:
                    basis_profile.update(p60=1, pshort=0, pplay=1,
                                         xmins=PARAMETERS["long_minutes_prior"])
                    basis_profile["long_mean"] = PARAMETERS["long_minutes_prior"]
                fixture_row["appearance_basis"] = components(
                    basis_profile, pos, context["gf"], context["ga"], context["cs"], scoring
                )
            item = per_gw[str(f["event"])]
            if "minutes_scenario" in item and "availability" not in scenario:
                values = item["minutes_scenario"].setdefault("fixture_availability", [])
                if not values:
                    item["minutes_scenario"]["availability"] = assumption["value"]
                values.append({"fixture_id": f["id"], **assumption})
            item["points"] += forecast["points"]
            item["xmins"] += forecast["xmins"]
            item["pplay"] = 1 - (1 - item["pplay"]) * (1 - forecast["pplay"])
            item["p60"] = 1 - (1 - item["p60"]) * (1 - forecast["p60"])
            item["fixtures"].append(fixture_row)
            for k, v in forecast["components"].items():
                item["components"][k] = item["components"].get(k, 0) + v
        team = data["teams"][p["team"]]
        name = p["web_name"]
        if "\ufffd" in name:
            import re

            match = re.search(re.escape(name).replace("\ufffd", "."), p["second_name"])
            if match:
                name = match.group(0)
        result.append(
            {
                "id": p["id"],
                "code": p["code"],
                "name": name,
                "full_name": f"{p['first_name']} {p['second_name']}",
                "position": POSITIONS[pos],
                "position_id": pos,
                "team": p["team"],
                "team_name": team["name"],
                "team_short": team["short_name"],
                "team_code": team["code"],
                "price": p["now_cost"] / 10,
                "ownership": number(p["selected_by_percent"]),
                "status": p["status"],
                "news": p.get("news", ""),
                "chance": chance,
                "form": number(p["form"]),
                "total_points": p["total_points"],
                "minutes": p["minutes"],
                "xg90": profile["rates"]["expected_goals"],
                "xa90": profile["rates"]["expected_assists"],
                "xmins": per_gw[str(start)]["xmins"],
                "pplay": per_gw[str(start)]["pplay"],
                "p60": per_gw[str(start)]["p60"],
                "dc_probability": profile["dc_prob"],
                "sample_matches": profile["samples"],
                "has_prior": len(rows) > len(current_rows),
                "overridden": pid in overrides or pid in minutes_schedule,
                "price_change": p.get("cost_change_event", 0) / 10,
                "transfers_in": p.get("transfers_in_event", 0),
                "transfers_out": p.get("transfers_out_event", 0),
                "price_change_percent": p.get("price_change_percent"),
                "price_change_projections": p.get("price_change_projections", []),
                "price_change_locked_until": p.get("price_change_locked_until"),
                "penalties_order": p.get("penalties_order"),
                "gw": per_gw,
            }
        )
    payload = {
        "players": result,
        "gameweeks": horizon,
        "events": data["bootstrap"]["events"],
        "teams": list(data["teams"].values()),
        "next_gw": start,
        "season": data["season"],
        "loaded_at": data["loaded_at"],
        "model_version": VERSION,
        "sources": data["sources"],
        "history_rows": len(history),
        "parameters": PARAMETERS,
        "model_fit": {
            key: forecast_model.PARAMS.get(key)
            for key in ("version", "fitted_at", "origin_seasons", "prior_seasons", "source")
        } if forecast_model.PARAMS else None,
        "limitations": [
            "Minutes probabilities come from a logit fitted on archived seasons and archived weekly availability flags; they are not yet validated prospectively.",
            "Bonus is a fitted linear approximation; 2026/27 BPS changes are not reconstructed.",
            "No automatic press-conference or confirmed-lineup feed is connected.",
            "Flagged players use captured return dates where given, otherwise fitted flag-conditional recovery by lead time. Suspensions and unregistered players keep declared rules. Manual availability takes precedence.",
            "No head-to-head paid-provider accuracy claim is established.",
        ],
    }
    if cache:
        _projections = payload
        _projection_key = key
    return payload


def player_history(player_id):
    d = get_data()
    if player_id not in d["players"]:
        return []
    code = d["players"][player_id]["code"]
    return sorted(
        [r for r in d["history"] if r["code"] == code], key=lambda r: r["date"]
    )[-40:]


def simulate_player(player, gw, trials=10000):
    """Independent-event sensitivity simulation, not calibrated prediction intervals."""
    seed = int(
        hashlib.sha256(f"{player['id']}:{gw}:{VERSION}".encode()).hexdigest()[:8], 16
    )
    rng = np.random.default_rng(seed)
    scores = np.zeros(trials)
    pos = player["position_id"]
    for f in player["gw"].get(str(gw), {}).get("fixtures", []):
        u = rng.random(trials)
        long = u < f["p60"]
        short = (u >= f["p60"]) & (u < f["pplay"])
        plays = long | short
        scores += 2 * long + short
        if f["pplay"] > 0:
            goals = rng.poisson(f["xg"] / f["pplay"], trials) * plays
            assists = rng.poisson(f["xa"] / f["pplay"], trials) * plays
            scores += (
                goals * DEFAULT_SCORING["goals_scored"][POSITIONS[pos]] + 3 * assists
            )
        scores += (
            (rng.random(trials) < f["cs"])
            * long
            * DEFAULT_SCORING["clean_sheets"][POSITIONS[pos]]
        )
        dc_points = DEFAULT_SCORING["defensive_contribution"][POSITIONS[pos]]
        dc_hit = (
            min(1, f["components"].get("defensive", 0) / (dc_points * f["pplay"]))
            if dc_points and f["pplay"] > 0
            else 0
        )
        scores += (rng.random(trials) < dc_hit) * plays * dc_points
        if f["pplay"] > 0:
            for key in ["bonus", "saves", "penalty_saves"]:
                scores += (
                    rng.poisson(max(0, f["components"][key] / f["pplay"]), trials)
                    * plays
                )
            scores += f["components"]["deductions"] / f["pplay"] * plays
            if player["gw"][str(gw)].get("stat_scenario"):
                residual = sum(
                    f["components"].get(key, 0)
                    for key in ("provider_adjustment", "imported_adjustment", "solio_adjustment", "solio_extrapolation", "user_points_adjustment")
                )
                scores += residual / f["pplay"] * plays
    histogram = [
        {"points": int(v), "probability": float(np.mean(np.rint(scores) == v))}
        for v in range(-3, 26)
    ]
    histogram = [v for v in histogram if v["probability"] > 0.001]
    return {
        "histogram": histogram,
        "mean": float(np.mean(scores)),
        "p10": float(np.percentile(scores, 10)),
        "p90": float(np.percentile(scores, 90)),
        "blank_probability": float(np.mean(scores <= 2)),
        "haul_probability": float(np.mean(scores >= 10)),
        "trials": trials,
        "label": "User-scenario independent-event simulation; uncalibrated"
        if player["gw"].get(str(gw), {}).get("stat_scenario")
        else "Independent-event model simulation; uncalibrated",
        "tail_probability": float(
            np.mean(np.rint(scores) > 25) + np.mean(np.rint(scores) < -3)
        ),
    }

"""Fixed holdout and GW-grouped walk-forward evaluation without future features."""

from __future__ import annotations

import json
from collections import defaultdict

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

from .data import ROOT, get_data, utcnow
from .model import (
    VERSION,
    PARAMETERS,
    POSITIONS,
    attach_team_xg,
    positional_priors,
    player_profile,
    components,
    team_ratings,
)

REPORT = ROOT / "data" / "evaluation.json"
FEATURE_NAMES = [
    "position",
    "price",
    "home",
    "xmins",
    "p60",
    "pplay",
    "xg90",
    "xa90",
    "bonus90",
    "dc_probability",
    "saves90",
    "team_goals",
    "conceded",
    "form",
    "ppg",
    "samples",
    "component_points",
]


def metrics(pred, actual):
    pred, actual = np.array(pred), np.array(actual)
    return (
        {
            "mae": float(np.mean(np.abs(pred - actual))),
            "rmse": float(np.sqrt(np.mean((pred - actual) ** 2))),
            "bias": float(np.mean(pred - actual)),
            "count": len(actual),
        }
        if len(actual)
        else None
    )


def run_evaluation():
    data = get_data()
    history = attach_team_xg(data["history"])
    # Frozen priors learned only from the earliest archive. No held-out aggregates.
    priors = positional_priors(history, "2024-25")
    empty_priors = positional_priors([], "2023-24")
    groups = defaultdict(list)
    for r in history:
        groups[(r["season"], r["gw"])].append(r)
    by_player, seen, records = defaultdict(list), [], []
    for (season, gw), rows in sorted(groups.items()):
        ratings, average = team_ratings(seen) if seen else ({}, 1.5)
        gw_records = []
        for r in rows:
            prior_rows = by_player[r["code"]]
            profile = player_profile(
                prior_rows,
                r["position"],
                (empty_priors if season == "2023-24" else priors)[r["position"]],
            )
            own = ratings.get(r["team"], {"attack": average, "defence": average})
            opp = ratings.get(
                r.get("opponent"), {"attack": average, "defence": average}
            )
            venue = (
                PARAMETERS["team_home_multiplier"]
                if r["home"]
                else 1 / PARAMETERS["team_home_multiplier"]
            )
            gf, ga = (
                own["attack"] * opp["defence"] / average * venue,
                opp["attack"] * own["defence"] / average / venue,
            )
            scoring = None
            if season < "2025-26":
                from .model import DEFAULT_SCORING

                scoring = {
                    **DEFAULT_SCORING,
                    "defensive_contribution": {k: 0 for k in POSITIONS.values()},
                }
            forecast = components(profile, r["position"], gf, ga, scoring=scoring)
            price_before = prior_rows[-1]["price"] if prior_rows else 0
            features = [
                r["position"],
                price_before,
                int(r["home"]),
                profile["xmins"],
                profile["p60"],
                profile["pplay"],
                profile["rates"]["expected_goals"],
                profile["rates"]["expected_assists"],
                profile["rates"]["bonus"],
                profile["dc_prob"],
                profile["rates"]["saves"],
                gf,
                ga,
                profile["form"],
                profile["ppg"],
                min(profile["samples"], 100),
                forecast["points"],
            ]
            gw_records.append(
                {
                    "season": season,
                    "gw": gw,
                    "code": r["code"],
                    "position": r["position"],
                    "features": features,
                    "actual": r["total_points"],
                    "minutes": r["minutes"],
                    "predicted_minutes": profile["xmins"],
                    "component": forecast["points"],
                    "form": profile["form"],
                    "ppg": profile["ppg"] * profile["pplay"],
                }
            )
        records.extend(gw_records)
        # Append an entire GW only after every prediction has been generated.
        # This is stricter than per-fixture chronology for doubles and early games.
        for r in sorted(rows, key=lambda x: x["date"]):
            by_player[r["code"]].append(r)
        seen.extend(rows)
        print(f"features {season} GW{gw}: {len(rows)} rows", flush=True)
    train = [
        r
        for r in records
        if r["season"] in ("2023-24", "2024-25") and r["features"][15] >= 3
    ]
    test = [r for r in records if r["season"] == "2025-26"]
    X, y = (
        np.array([r["features"] for r in train]),
        np.array([r["actual"] for r in train]),
    )
    challenger = HistGradientBoostingRegressor(
        loss="squared_error",
        learning_rate=0.05,
        max_iter=150,
        max_leaf_nodes=15,
        l2_regularization=10,
        min_samples_leaf=60,
        random_state=42,
    )
    challenger.fit(X, y)
    learned = np.maximum(0, challenger.predict(np.array([r["features"] for r in test])))
    for r, pred in zip(test, learned):
        r["ml"] = float(pred)
    starters = [r for r in test if r["predicted_minutes"] >= 45]
    result = {
        "generated_at": utcnow(),
        "version": VERSION,
        "train_seasons": ["2023-24", "2024-25"],
        "test_season": "2025-26",
        "method": "GW-grouped walk-forward: player and team states update only after all predictions for a GW. ML parameters fitted on 2023/24–2024/25 only; 2025/26 held out.",
        "feature_names": FEATURE_NAMES,
        "parameters": PARAMETERS,
        "models": {
            name: metrics([r[key] for r in starters], [r["actual"] for r in starters])
            for name, key in [
                ("Component model", "component"),
                ("ML challenger", "ml"),
                ("Recent 5-match form", "form"),
                ("Appearance-adjusted PPG", "ppg"),
            ]
        },
        "all_players": {
            name: metrics([r[key] for r in test], [r["actual"] for r in test])
            for name, key in [
                ("Component model", "component"),
                ("ML challenger", "ml"),
                ("Recent 5-match form", "form"),
                ("Appearance-adjusted PPG", "ppg"),
            ]
        },
        "minutes": metrics(
            [r["predicted_minutes"] for r in starters], [r["minutes"] for r in starters]
        ),
        "positions": [
            {
                "position": POSITIONS[pos],
                **metrics(
                    [r["component"] for r in starters if r["position"] == pos],
                    [r["actual"] for r in starters if r["position"] == pos],
                ),
            }
            for pos in range(1, 5)
        ],
        "gameweeks": [
            {
                "gw": gw,
                **{
                    name: metrics(
                        [r[key] for r in starters if r["gw"] == gw],
                        [r["actual"] for r in starters if r["gw"] == gw],
                    )["mae"]
                    for name, key in [
                        ("component", "component"),
                        ("ml", "ml"),
                        ("form", "form"),
                        ("ppg", "ppg"),
                    ]
                },
                "count": len([r for r in starters if r["gw"] == gw]),
            }
            for gw in sorted({r["gw"] for r in starters})
        ],
        "calibration": [
            {
                "bin": f"{low}–{low + 1}",
                "predicted": float(
                    np.mean(
                        [
                            r["component"]
                            for r in starters
                            if low <= r["component"] < low + 1
                        ]
                    )
                ),
                "actual": float(
                    np.mean(
                        [
                            r["actual"]
                            for r in starters
                            if low <= r["component"] < low + 1
                        ]
                    )
                ),
                "count": len([r for r in starters if low <= r["component"] < low + 1]),
            }
            for low in range(10)
            if len([r for r in starters if low <= r["component"] < low + 1]) >= 20
        ],
        "limitations": [
            "Evaluation uses historical team estimates, not current market/Elevenify data. Live forecasts therefore differ.",
            "Archived rows do not contain historical injury/news snapshots. Minutes estimates use prior appearances only.",
            "2025/26 introduced defensive contribution scoring; earlier ML training data cannot teach that change completely.",
            "No paid-provider forecasts at the same deadlines have been supplied. Market competitiveness is unproven.",
            "The 2025/26 holdout must not become a repeated tuning set. Register future changes against a fresh prospective set.",
        ],
        "deployed_model": "Component model",
        "ml_status": "Research challenger; not silently blended into live forecasts.",
    }
    captain_rows = defaultdict(lambda: defaultdict(float))
    for r in test:
        aggregate = captain_rows[(r["gw"], r["code"])]
        for key in ["actual", "predicted_minutes", "component", "ml", "form", "ppg"]:
            aggregate[key] += r[key]
    captains = []
    for gw in sorted({r["gw"] for r in test}):
        rs = [
            r
            for (week, _), r in captain_rows.items()
            if week == gw and r["predicted_minutes"] >= 45
        ]
        if not rs:
            continue
        selections = {
            key: max(rs, key=lambda r: r[key])
            for key in ("component", "ml", "form", "ppg")
        }
        captains.append({"gw": gw, **{k: v["actual"] for k, v in selections.items()}})
    result["captains"] = {
        key: sum(r[key] for r in captains) for key in ("component", "ml", "form", "ppg")
    }
    result["captain_gameweeks"] = captains
    result["captain_method"] = (
        "Pick the largest aggregate GW forecast among players with total projected GW minutes >=45. Sum actual fixture points across doubles. Totals are undoubled base player points, not a simulated full squad."
    )
    # GW-cluster bootstrap keeps within-GW player errors together.
    rng = np.random.default_rng(42)
    gws = result["gameweeks"]
    samples = rng.integers(0, len(gws), size=(5000, len(gws)))
    weights = np.array([r["count"] for r in gws])
    result["mae_differences"] = {}
    for comparator in ["form", "ppg", "ml"]:
        delta = np.array([r["component"] - r[comparator] for r in gws])
        boot = np.sum(delta[samples] * weights[samples], axis=1) / np.sum(
            weights[samples], axis=1
        )
        result["mae_differences"][comparator] = {
            "difference": float(np.average(delta, weights=weights)),
            "ci95": [float(v) for v in np.quantile(boot, [0.025, 0.975])],
            "method": "5000 gameweek-cluster bootstrap replicates; seed 42; negative favours the component model.",
        }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps(result["models"], indent=2))
    return result


if __name__ == "__main__":
    run_evaluation()

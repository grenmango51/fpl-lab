"""Expected squad points under independent player appearance probabilities.

Bench selection respects priority and nominal formation, including vacancies
that cannot be filled. A cameo in any fixture prevents an automatic substitute.
"""

from __future__ import annotations

from functools import lru_cache
from itertools import product

FORMATIONS = [
    (d, m, 10 - d - m) for d in range(3, 6) for m in range(2, 6) if 1 <= 10 - d - m <= 3
]


def appearance(player, gw):
    forecast = player.get("gw", {}).get(str(gw), {})
    if "pplay" in forecast:
        return min(1.0, max(0.0, float(forecast["pplay"])))
    fixtures = forecast.get("fixtures")
    if fixtures is None:
        return min(1.0, max(0.0, float(player.get("pplay", 1))))
    absent = 1.0
    for fixture in fixtures:
        absent *= 1 - min(1.0, max(0.0, float(fixture.get("pplay", 0))))
    return 1 - absent


def missing_distribution(probabilities):
    distribution = [1.0]
    for p in probabilities:
        nxt = [0.0] * (len(distribution) + 1)
        for n, weight in enumerate(distribution):
            nxt[n] += weight * p
            nxt[n + 1] += weight * (1 - p)
        distribution = nxt
    return distribution


@lru_cache(maxsize=20000)
def selected_bench(formation, missing, bench_positions, present):
    # The largest binary mask prioritises the first, then second, then third
    # bench player. Feasibility allows replacing any absent nominal slot.
    for mask in range(7, -1, -1):
        if mask & present != mask or mask.bit_count() > sum(missing):
            continue
        added = tuple(
            sum(
                bool(mask & (4 >> j)) and p == pos
                for j, p in enumerate(bench_positions)
            )
            for pos in (2, 3, 4)
        )
        for removed in product(*(range(n + 1) for n in missing)):
            if (
                sum(removed) == mask.bit_count()
                and tuple(n - r + a for n, r, a in zip(formation, removed, added))
                in FORMATIONS
            ):
                return mask
    return 0


def team_points(starters, bench, captain, vice, lookup, gw, chip="none"):
    xp = lambda i: float(lookup[i]["gw"].get(str(gw), {}).get("points", 0))
    probabilities = {i: appearance(lookup[i], gw) for i in starters + bench}
    copies = 2 if chip == "triplecaptain" else 1
    vice_points = (1 - probabilities[captain]) * xp(vice) * copies
    autosub = 0.0
    if chip != "benchboost":
        keeper = next(i for i in starters if lookup[i]["position_id"] == 1)
        reserve = next(i for i in bench if lookup[i]["position_id"] == 1)
        autosub += (1 - probabilities[keeper]) * xp(reserve)
        outfield = [i for i in bench if lookup[i]["position_id"] != 1]
        bench_positions = tuple(lookup[i]["position_id"] for i in outfield)
        groups = [
            [i for i in starters if lookup[i]["position_id"] == pos]
            for pos in (2, 3, 4)
        ]
        formation = tuple(map(len, groups))
        missing = [
            missing_distribution([probabilities[i] for i in group]) for group in groups
        ]
        selected_probability = [0.0] * 3
        for counts in product(*(range(len(d)) for d in missing)):
            weight = (
                missing[0][counts[0]] * missing[1][counts[1]] * missing[2][counts[2]]
            )
            if weight == 0 or sum(counts) == 0:
                continue
            for present in range(8):
                scenario = weight
                for j, i in enumerate(outfield):
                    scenario *= (
                        probabilities[i] if present & (4 >> j) else 1 - probabilities[i]
                    )
                if scenario == 0:
                    continue
                chosen = selected_bench(formation, counts, bench_positions, present)
                for j in range(3):
                    if chosen & (4 >> j):
                        selected_probability[j] += scenario
        autosub += sum(
            selected_probability[j] * xp(i) / probabilities[i]
            for j, i in enumerate(outfield)
            if probabilities[i] > 0
        )
    scoring = starters + bench if chip == "benchboost" else starters
    total = sum(xp(i) for i in scoring) + copies * xp(captain) + vice_points + autosub
    return {"points": total, "autosub_points": autosub, "vice_points": vice_points}

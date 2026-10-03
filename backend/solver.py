"""FPL rules and a multi-period HiGHS integer optimiser."""

from __future__ import annotations

import itertools
import warnings
from collections import Counter
from threading import Lock

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix
from .scoring import FORMATIONS, appearance, team_points

SQUAD_COUNTS = {1: 2, 2: 5, 3: 5, 4: 3}
CHIPS = {"none", "wildcard", "freehit", "benchboost", "triplecaptain"}
_MILP_LOCK = Lock()


def points(player, gw):
    return float(player["gw"].get(str(gw), {}).get("points", 0))


def sale_price(current, purchase):
    current, purchase = round(current * 10), round(purchase * 10)
    return (
        current if current <= purchase else purchase + (current - purchase) // 2
    ) / 10


def validate_squad(ids, players, budget=None, starters=None, captain=None, vice=None):
    lookup = {p["id"]: p for p in players}
    errors = []
    if len(ids) != 15:
        errors.append("Select exactly 15 players.")
    if len(set(ids)) != len(ids):
        errors.append("A player cannot appear twice.")
    if any(i not in lookup for i in ids):
        errors.append("The squad contains an unknown player.")
        return errors
    counts = Counter(lookup[i]["position_id"] for i in ids)
    if any(counts[k] != v for k, v in SQUAD_COUNTS.items()):
        errors.append("Squad composition must be 2 GKP, 5 DEF, 5 MID and 3 FWD.")
    clubs = Counter(lookup[i]["team"] for i in ids)
    if any(n > 3 for n in clubs.values()):
        errors.append("Select at most three players from one club.")
    if budget is not None and sum(lookup[i]["price"] for i in ids) > budget + 0.001:
        errors.append("The squad exceeds the available budget.")
    if starters is not None:
        if (
            len(starters) != 11
            or len(set(starters)) != 11
            or not set(starters).issubset(ids)
        ):
            errors.append("Select 11 distinct starters from the squad.")
        else:
            sc = Counter(lookup[i]["position_id"] for i in starters)
            if sc[1] != 1 or (sc[2], sc[3], sc[4]) not in FORMATIONS:
                errors.append("The starting formation is not legal in FPL.")
        if captain not in starters or vice not in starters or captain == vice:
            errors.append(
                "Captain and vice-captain must be different starting players."
            )
    return errors


def best_lineup(ids, players, gw, chip="none"):
    lookup = {p["id"]: p for p in players}
    groups = {
        pos: sorted(
            [i for i in ids if lookup[i]["position_id"] == pos],
            key=lambda i: points(lookup[i], gw),
            reverse=True,
        )
        for pos in SQUAD_COUNTS
    }
    if any(len(groups[p]) != n for p, n in SQUAD_COUNTS.items()):
        raise ValueError("A complete legal squad is required.")
    best = None
    for d, m, f in FORMATIONS:
        starting = groups[1][:1] + groups[2][:d] + groups[3][:m] + groups[4][:f]
        candidates = sorted(starting, key=lambda i: points(lookup[i], gw), reverse=True)
        captain, vice = max(
            ((c, v) for c in candidates for v in candidates if c != v),
            key=lambda pair: (
                points(lookup[pair[0]], gw)
                + (1 - appearance(lookup[pair[0]], gw)) * points(lookup[pair[1]], gw)
            ),
        )
        reserve_gk = [i for i in groups[1] if i not in starting]
        reserves = [
            i for i in ids if i not in starting and lookup[i]["position_id"] != 1
        ]
        for order in itertools.permutations(reserves):
            bench = reserve_gk + list(order)
            score = team_points(starting, bench, captain, vice, lookup, gw, chip)
            if best is None or score["points"] > best["points"]:
                best = {
                    "starters": starting,
                    "bench": bench,
                    "captain": captain,
                    "vice": vice,
                    **score,
                    "formation": f"{d}-{m}-{f}",
                }
    return best


class Builder:
    def __init__(self):
        self.cost = []
        self.low = []
        self.high = []
        self.integral = []
        self.rows = []
        self.cols = []
        self.values = []
        self.clow = []
        self.chigh = []

    def var(self, cost=0, low=0, high=1, integer=True):
        i = len(self.cost)
        self.cost.append(cost)
        self.low.append(low)
        self.high.append(high)
        self.integral.append(int(integer))
        return i

    def constraint(self, coeffs, low=-np.inf, high=np.inf):
        row = len(self.clow)
        for col, value in coeffs.items():
            if value:
                self.rows.append(row)
                self.cols.append(col)
                self.values.append(value)
        self.clow.append(low)
        self.chigh.append(high)

    def solve(self, seconds=20):
        matrix = coo_matrix(
            (self.values, (self.rows, self.cols)),
            shape=(len(self.clow), len(self.cost)),
        ).tocsc()
        # Serialise callers and keep HiGHS off its native worker pool on Windows.
        # SciPy forwards this HiGHS option despite not listing it in its API.
        with _MILP_LOCK, warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message=r"Unrecognized options detected: \{'threads'\}.*",
                category=RuntimeWarning,
            )
            return milp(
                c=np.array(self.cost),
                integrality=np.array(self.integral),
                bounds=Bounds(self.low, self.high),
                constraints=LinearConstraint(matrix, self.clow, self.chigh),
                options={"time_limit": seconds, "mip_rel_gap": 0.01, "threads": 1},
            )


def optimise(
    players,
    *,
    squad=None,
    bank=0,
    budget=100,
    start_gw=6,
    horizon=4,
    free_transfers=1,
    max_transfers=2,
    decay=0.90,
    ft_value=1.5,
    bench_weight=0.08,
    risk=0,
    locked=None,
    excluded=None,
    chips=None,
    purchase_prices=None,
    seconds=20,
    used_chips=None,
    extra_candidates=None,
):
    squad = squad or []
    locked, excluded = set(locked or []), set(excluded or [])
    chips = {int(k): v for k, v in (chips or {}).items()}
    purchase_prices = purchase_prices or {}
    lookup = {p["id"]: p for p in players}
    if squad:
        errors = validate_squad(squad, players)
        if errors:
            raise ValueError(" ".join(errors))
    if locked & excluded:
        raise ValueError("A player cannot be both locked and excluded.")
    if not (locked | excluded).issubset(lookup):
        raise ValueError("A constraint refers to an unknown player.")
    extra_candidates = set(extra_candidates or [])
    if not extra_candidates.issubset(lookup):
        raise ValueError("An extra candidate refers to an unknown player.")
    if len(locked) > 15:
        raise ValueError("At most 15 players can be locked.")
    if any(v not in CHIPS for v in chips.values()):
        raise ValueError("Unknown chip.")
    chip_keys = [(v, 1 if gw <= 19 else 2) for gw, v in chips.items() if v != "none"]
    chip_keys += [(c["chip"], 1 if c["gw"] <= 19 else 2) for c in (used_chips or [])]
    if len(set(chip_keys)) != len(chip_keys):
        raise ValueError("Each chip may be used once per half of the season.")
    horizon = min(horizon, 39 - start_gw)
    weeks = list(range(start_gw, start_gw + horizon))
    # Candidate screening is disclosed: top 24 and cheapest 8 per position,
    # plus all existing and locked players. No claim of global pool optimality.
    candidates = set(squad) | locked | extra_candidates
    for pos in SQUAD_COUNTS:
        pool = [
            p
            for p in players
            if p["position_id"] == pos
            and p["id"] not in excluded
            and (any(appearance(p, gw) > 0.05 for gw in weeks) or p["id"] in locked)
        ]
        ranked = sorted(
            pool,
            key=lambda p: sum(points(p, gw) * decay**j for j, gw in enumerate(weeks)),
            reverse=True,
        )
        candidates.update(p["id"] for p in ranked[:24])
        candidates.update(
            p["id"]
            for p in sorted(pool, key=lambda p: (p["price"], -points(p, start_gw)))[:8]
        )
    candidates -= excluded - set(squad)
    ids = sorted(candidates)
    b = Builder()
    x, y, cap, buys, sells, banks, ft, hits = {}, {}, {}, {}, {}, {}, {}, {}
    initial_ft = int(min(5, max(0, free_transfers)))
    ft[0] = b.var(low=initial_ft, high=initial_ft)
    initial_bank = round(bank * 10)
    if not squad:
        initial_bank = round(budget * 10)
    prices = {i: round(lookup[i]["price"] * 10) for i in ids}
    sell_prices = {
        i: round(
            sale_price(
                lookup[i]["price"],
                float(purchase_prices.get(str(i), lookup[i]["price"])),
            )
            * 10
        )
        for i in squad
    }
    last_permanent = -1
    for w, gw in enumerate(weeks):
        chip = chips.get(gw, "none")
        free = chip in ("wildcard", "freehit") or not squad and w == 0
        prev = last_permanent
        weight = decay**w
        banks[w] = b.var(low=0, high=2000, integer=True)
        hits[w] = b.var(cost=weight * (4 - ft_value), low=0, high=15)
        n = b.var(
            cost=weight * ft_value if not free else 0,
            low=0,
            high=0 if free else max_transfers,
        )
        for i in ids:
            p = lookup[i]
            score = points(p, gw)
            own_bonus = risk * score * p["ownership"] / 100
            x[i, w] = b.var(
                cost=-weight
                * (score * (1 if chip == "benchboost" else bench_weight) + own_bonus),
                low=1 if i in locked else 0,
                high=0 if i in excluded else 1,
            )
            y[i, w] = b.var(
                cost=-weight * score * (0 if chip == "benchboost" else 1 - bench_weight)
            )
            cap[i, w] = b.var(
                cost=-weight * score * (2 if chip == "triplecaptain" else 1)
            )
            buys[i, w] = b.var()
            sells[i, w] = b.var()
            b.constraint({y[i, w]: 1, x[i, w]: -1}, high=0)
            b.constraint({cap[i, w]: 1, y[i, w]: -1}, high=0)
            b.constraint({buys[i, w]: 1, sells[i, w]: 1}, high=1)
            coeff = {x[i, w]: 1, buys[i, w]: -1, sells[i, w]: 1}
            if prev >= 0:
                coeff[x[i, prev]] = -1
                b.constraint(coeff, low=0, high=0)
            else:
                value = int(i in squad)
                b.constraint(coeff, low=value, high=value)
        b.constraint({x[i, w]: 1 for i in ids}, low=15, high=15)
        b.constraint({y[i, w]: 1 for i in ids}, low=11, high=11)
        b.constraint({cap[i, w]: 1 for i in ids}, low=1, high=1)
        for pos, count in SQUAD_COUNTS.items():
            relevant = [i for i in ids if lookup[i]["position_id"] == pos]
            b.constraint({x[i, w]: 1 for i in relevant}, low=count, high=count)
            lo, hi = (
                (1, 1)
                if pos == 1
                else (3, 5)
                if pos == 2
                else (2, 5)
                if pos == 3
                else (1, 3)
            )
            b.constraint({y[i, w]: 1 for i in relevant}, low=lo, high=hi)
        for club in {p["team"] for p in players}:
            b.constraint({x[i, w]: 1 for i in ids if lookup[i]["team"] == club}, high=3)
        # Purchases use current prices. Initial holdings use their true sale value.
        cash = {
            banks[w]: 1,
            **{buys[i, w]: prices[i] for i in ids},
            **{
                sells[i, w]: -(sell_prices.get(i, prices[i]) if prev < 0 else prices[i])
                for i in ids
            },
        }
        # For later sale of an original player, use original sale price when
        # currently held. This is conservative if bought back after selling.
        if prev >= 0:
            for i in ids:
                cash[sells[i, w]] = -sell_prices.get(i, prices[i])
            cash[banks[prev]] = -1
            b.constraint(cash, low=0, high=0)
        else:
            b.constraint(cash, low=initial_bank, high=initial_bank)
        if free:
            b.constraint({hits[w]: 1}, low=0, high=0)
        else:
            b.constraint({n: 1, **{buys[i, w]: -1 for i in ids}}, low=0, high=0)
            # Exact h = max(0,n-ft), rather than allowing bought FT credits.
            z = b.var()
            b.constraint({hits[w]: 1, n: -1, ft[w]: 1}, low=0)
            b.constraint({hits[w]: 1, n: -1, ft[w]: 1, z: 15}, high=15)
            b.constraint({hits[w]: 1, z: -15}, high=0)
            b.constraint({n: 1, ft[w]: -1, z: -15}, high=0)
            b.constraint({n: 1, ft[w]: -1, z: -15}, low=-15)
        if chip in ("wildcard", "freehit"):
            # Preserve saved FTs exactly, including a user-supplied zero.
            ft[w + 1] = b.var(low=0, high=5)
            b.constraint({ft[w + 1]: 1, ft[w]: -1}, low=0, high=0)
        else:
            ft[w + 1] = b.var(low=1, high=5)
            burn = b.var()
            equation = {ft[w + 1]: 1, ft[w]: -1, burn: 1}
            if not free:
                equation[n] = 1
                equation[hits[w]] = -1
            b.constraint(equation, low=1, high=1)
            b.constraint({ft[w + 1]: 1, burn: -5}, low=0)
        if chip != "freehit":
            last_permanent = w
    result = b.solve(seconds)
    if result.x is None:
        raise ValueError(
            "No feasible plan found within the time limit. Check budget, locks, exclusions and transfer limit."
        )
    output = []
    base = squad[:]
    for w, gw in enumerate(weeks):
        selected = [i for i in ids if result.x[x[i, w]] > 0.5]
        starters = [i for i in ids if result.x[y[i, w]] > 0.5]
        captain = next(i for i in ids if result.x[cap[i, w]] > 0.5)
        vice = max(
            [i for i in starters if i != captain], key=lambda i: points(lookup[i], gw)
        )
        bench = sorted(
            [i for i in selected if i not in starters],
            key=lambda i: (lookup[i]["position_id"] != 1, -points(lookup[i], gw)),
        )
        chip = chips.get(gw, "none")
        score = team_points(starters, bench, captain, vice, lookup, gw, chip)
        gross = score["points"]
        errors = validate_squad(
            selected, players, starters=starters, captain=captain, vice=vice
        )
        if errors:
            raise RuntimeError(
                "Solver result failed independent validation: " + " ".join(errors)
            )
        output.append(
            {
                "gw": gw,
                "squad": selected,
                "starters": starters,
                "bench": bench,
                "captain": captain,
                "vice": vice,
                "chip": chip,
                "bank": round(result.x[banks[w]]) / 10,
                "free_transfers": round(result.x[ft[w]]),
                "next_free_transfers": round(result.x[ft[w + 1]]),
                "hits": round(result.x[hits[w]]) * 4,
                **score,
                "net_points": gross - round(result.x[hits[w]]) * 4,
                "transfers_in": [i for i in selected if i not in base],
                "transfers_out": [i for i in base if i not in selected],
            }
        )
        if chip != "freehit":
            base = selected
    return {
        "weeks": output,
        "objective": -float(result.fun),
        "status": "optimal within candidate pool"
        if result.status == 0
        else "time limit · best feasible plan",
        "gap": float(getattr(result, "mip_gap", 0) or 0),
        "candidate_count": len(ids),
        "pool_count": len(players),
        "assumptions": [
            "Candidate screening: top 24 and cheapest 8 per position, plus existing and locked players.",
            "Prices held fixed; bank uses initial selling prices. Rebuying an initial player is conservatively valued.",
            "The optimisation objective uses a linear bench weight. Displayed totals separately include formation-aware autosubs and vice fallback under independent appearances.",
            "Chips are user-scheduled. Free Hit restores the previous permanent squad and bank.",
            "Forecast quality is independent of optimiser optimality.",
        ],
    }

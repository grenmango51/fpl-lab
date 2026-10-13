"""FPL rules and a multi-period HiGHS integer optimiser."""

from __future__ import annotations

import itertools
import math
import time
import warnings
from collections import Counter
from threading import Lock
from types import SimpleNamespace

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


def validate_chip_history(records, start_gw):
    """Validate the past allowance ledger independently of a future plan."""
    used, gameweeks = set(), set()
    for record in records:
        chip, gw = record.get("chip"), record.get("gw")
        if (
            chip not in CHIPS - {"none"}
            or isinstance(gw, bool) or not isinstance(gw, int) or not 1 <= gw <= 38
        ):
            raise ValueError("Chip history must contain official chips and gameweeks.")
        key = (chip, 1 if gw <= 19 else 2)
        if key in used:
            raise ValueError("Each chip may be used once per half of the season.")
        if gw in gameweeks:
            raise ValueError("Only one chip can be used in a gameweek.")
        if gw >= start_gw:
            raise ValueError("Used chip history must precede the first planned gameweek.")
        used.add(key)
        gameweeks.add(gw)
    return used


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

    def solve(self, seconds=20, initial_solution=None, native_highs=False):
        matrix = coo_matrix(
            (self.values, (self.rows, self.cols)),
            shape=(len(self.clow), len(self.cost)),
        ).tocsc()
        if native_highs or initial_solution is not None:
            return self._warm_solve(matrix, seconds, initial_solution)
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

    def _warm_solve(self, matrix, seconds, seed):
        """Official HiGHS API accepts the checked full-horizon MIP incumbent."""
        import highspy

        if seed is not None and not self.feasible(seed, matrix):
            raise RuntimeError("The optimisation warm start failed constraint validation.")
        with _MILP_LOCK:
            highs = highspy.Highs()
            highs.setOptionValue("output_flag", False)
            highs.setOptionValue("threads", 1)
            highs.setOptionValue("time_limit", float(seconds))
            highs.setOptionValue("mip_rel_gap", 0.01)
            lp = highspy.HighsLp()
            lp.num_col_, lp.num_row_ = matrix.shape[1], matrix.shape[0]
            lp.col_cost_, lp.col_lower_, lp.col_upper_ = self.cost, self.low, self.high
            lp.row_lower_, lp.row_upper_ = self.clow, self.chigh
            lp.integrality_ = [
                highspy.HighsVarType.kInteger if integer else highspy.HighsVarType.kContinuous
                for integer in self.integral
            ]
            lp.a_matrix_.format_ = highspy.MatrixFormat.kColwise
            lp.a_matrix_.start_, lp.a_matrix_.index_, lp.a_matrix_.value_ = matrix.indptr, matrix.indices, matrix.data
            if highs.passModel(lp) != highspy.HighsStatus.kOk:
                raise RuntimeError("HiGHS could not load the optimisation model.")
            if seed is not None:
                initial = highspy.HighsSolution()
                initial.col_value = np.asarray(seed, dtype=float)
                initial.value_valid = True
                if highs.setSolution(initial) != highspy.HighsStatus.kOk:
                    raise RuntimeError("HiGHS rejected the validated optimisation warm start.")
            highs.run()
            status = highs.getModelStatus()
            info = highs.getInfo()
            candidate = np.asarray(highs.getSolution().col_value, dtype=float)
            valid = self.feasible(candidate, matrix)
            # Preserve the validated incumbent if native presolve consumes the
            # entire budget before returning one. Its objective is explicit.
            values = candidate if valid and (seed is None or np.dot(self.cost, candidate) <= np.dot(self.cost, seed) + 1e-5) else seed
            gap = float(info.mip_gap)
            return SimpleNamespace(
                x=values, fun=float(np.dot(self.cost, values)) if values is not None else None,
                status=0 if status == highspy.HighsModelStatus.kOptimal else 1,
                mip_gap=gap if math.isfinite(gap) else None,
                engine="HiGHS · joint MILP", warm_start=seed is not None,
                native_status=highs.modelStatusToString(status),
            )

    def feasible(self, values, matrix=None):
        values = np.asarray(values, dtype=float)
        if len(values) != len(self.cost) or not np.all(np.isfinite(values)):
            return False
        if np.any(values < np.asarray(self.low) - 1e-5) or np.any(values > np.asarray(self.high) + 1e-5):
            return False
        integer = np.asarray(self.integral, dtype=bool)
        if np.any(np.abs(values[integer] - np.rint(values[integer])) > 1e-5):
            return False
        if matrix is None:
            matrix = coo_matrix((self.values, (self.rows, self.cols)), shape=(len(self.clow), len(self.cost))).tocsr()
        rows = matrix @ values
        return bool(np.all(rows >= np.asarray(self.clow) - 1e-5) and np.all(rows <= np.asarray(self.chigh) + 1e-5))


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
    transfer_limits=None,
    locked_by_gw=None,
    excluded_by_gw=None,
    captain_locks=None,
    _initial_plan=None,
    _warm_held_seed=False,
):
    started = time.monotonic()
    if (
        isinstance(start_gw, bool) or not isinstance(start_gw, int) or not 1 <= start_gw <= 38
        or isinstance(horizon, bool) or not isinstance(horizon, int) or not 1 <= horizon <= 38
    ):
        raise ValueError("Solve start and horizon must be within GW1–38.")
    if not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or not 2 <= seconds <= 45:
        raise ValueError("The native solve time limit must be between 2 and 45 seconds.")
    requested_horizon = horizon
    horizon = min(horizon, 39 - start_gw)
    weeks = list(range(start_gw, start_gw + horizon))
    squad = squad or []
    locked, excluded = set(locked or []), set(excluded or [])
    chips = {int(k): v for k, v in (chips or {}).items()}
    purchase_prices = purchase_prices or {}
    lookup = {p["id"]: p for p in players}
    if any(str(gw) not in p.get("gw", {}) for p in players for gw in weeks):
        raise ValueError("Every player must have a forecast for every requested gameweek.")
    transfer_limits = _weekly_constraints(transfer_limits, weeks, "transfer_limits", lookup)
    locked_by_gw = _weekly_constraints(locked_by_gw, weeks, "locked_by_gw", lookup)
    excluded_by_gw = _weekly_constraints(excluded_by_gw, weeks, "excluded_by_gw", lookup)
    captain_locks = _weekly_constraints(captain_locks, weeks, "captain_locks", lookup)
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
    for gw in weeks:
        required = locked | set(locked_by_gw.get(gw, []))
        prohibited = excluded | set(excluded_by_gw.get(gw, []))
        captain = captain_locks.get(gw)
        if captain is not None:
            required.add(captain)
        if required & prohibited:
            raise ValueError(f"A player is both required and excluded in GW{gw}.")
        if len(required) > 15:
            raise ValueError(f"More than 15 players are required in GW{gw}.")
        required_positions = Counter(lookup[i]["position_id"] for i in required)
        required_clubs = Counter(lookup[i]["team"] for i in required)
        if any(required_positions[pos] > count for pos, count in SQUAD_COUNTS.items()):
            raise ValueError(f"Required players exceed the positional squad limits in GW{gw}.")
        if any(n > 3 for n in required_clubs.values()):
            raise ValueError(f"Required players exceed the three-player club limit in GW{gw}.")
    if any(v not in CHIPS for v in chips.values()):
        raise ValueError("Unknown chip.")
    if any(gw not in weeks for gw in chips):
        raise ValueError("Chip assignments must be within the requested solve window.")
    chip_keys = [(v, 1 if gw <= 19 else 2) for gw, v in chips.items() if v != "none"]
    chip_keys += list(validate_chip_history(used_chips or [], start_gw))
    if len(set(chip_keys)) != len(chip_keys):
        raise ValueError("Each chip may be used once per half of the season.")
    seed_started = time.monotonic()
    # Internal short seed segments can start from their own legal held plan,
    # rather than spending a small budget only searching for feasibility.
    seed_plan = _initial_plan
    if horizon > 14:
        seed_plan = _long_seed_plan(
            players, squad, bank, budget, start_gw, horizon, free_transfers,
            max_transfers, decay, ft_value, bench_weight, risk, locked, excluded,
            chips, purchase_prices, seconds, used_chips, transfer_limits,
            locked_by_gw, excluded_by_gw, captain_locks,
        )
    elif _warm_held_seed and seed_plan is None:
        seed_plan = _held_seed_plan(
            players, squad, bank, weeks, free_transfers, chips, locked, excluded,
            locked_by_gw, excluded_by_gw, captain_locks,
        )
    seed_seconds = time.monotonic() - seed_started
    # Candidate screening is disclosed: top 24 and cheapest 8 per position,
    # plus all existing and locked players. No claim of global pool optimality.
    scheduled_required = set(captain_locks.values()) | {
        i for weekly_ids in locked_by_gw.values() for i in weekly_ids
    }
    candidates = set(squad) | locked | extra_candidates | scheduled_required
    if seed_plan:
        candidates.update(i for week in seed_plan for i in week["squad"])
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
    if len(ids) * horizon > 25000:
        raise ValueError("This request exceeds the local solver size limit; shorten the horizon or reduce weekly locks.")
    b = Builder()
    x, y, cap, buys, sells, banks, ft, hits = {}, {}, {}, {}, {}, {}, {}, {}
    moves, hit_states, burns = {}, {}, {}
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
            high=0 if free else transfer_limits.get(gw, max_transfers),
        )
        moves[w] = n
        required = locked | set(locked_by_gw.get(gw, []))
        prohibited = excluded | set(excluded_by_gw.get(gw, []))
        captain_lock = captain_locks.get(gw)
        for i in ids:
            p = lookup[i]
            score = points(p, gw)
            own_bonus = risk * score * p["ownership"] / 100
            x[i, w] = b.var(
                cost=-weight
                * (score * (1 if chip == "benchboost" else bench_weight) + own_bonus),
                low=1 if i in required else 0,
                high=0 if i in prohibited else 1,
            )
            y[i, w] = b.var(
                cost=-weight * score * (0 if chip == "benchboost" else 1 - bench_weight)
            )
            cap[i, w] = b.var(
                cost=-weight * score * (2 if chip == "triplecaptain" else 1),
                low=1 if i == captain_lock else 0,
                high=0 if captain_lock is not None and i != captain_lock else 1,
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
            if gw in transfer_limits:
                b.constraint({buys[i, w]: 1 for i in ids}, high=transfer_limits[gw])
        else:
            b.constraint({n: 1, **{buys[i, w]: -1 for i in ids}}, low=0, high=0)
            # Exact h = max(0,n-ft), rather than allowing bought FT credits.
            z = b.var()
            hit_states[w] = z
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
            burns[w] = burn
            equation = {ft[w + 1]: 1, ft[w]: -1, burn: 1}
            if not free:
                equation[n] = 1
                equation[hits[w]] = -1
            b.constraint(equation, low=1, high=1)
            b.constraint({ft[w + 1]: 1, burn: -5}, low=0)
        if chip != "freehit":
            last_permanent = w
    initial_solution = None
    if seed_plan:
        initial_solution = np.array(b.low, dtype=float)
        for w, week in enumerate(seed_plan):
            chip = chips.get(week["gw"], "none")
            free = chip in ("wildcard", "freehit") or not squad and w == 0
            selected, starting = set(week["squad"]), set(week["starters"])
            initial_solution[banks[w]] = round(week["bank"] * 10)
            initial_solution[ft[w]] = week["free_transfers"]
            initial_solution[ft[w + 1]] = week["next_free_transfers"]
            initial_solution[hits[w]] = week["hits"] / 4
            initial_solution[moves[w]] = 0 if free else len(week["transfers_in"])
            if w in hit_states:
                initial_solution[hit_states[w]] = int(len(week["transfers_in"]) > week["free_transfers"])
            if w in burns:
                initial_solution[burns[w]] = (
                    week["free_transfers"] + 1 - week["next_free_transfers"]
                    - (len(week["transfers_in"]) if not free else 0) + week["hits"] / 4
                )
            for i in ids:
                initial_solution[x[i, w]] = int(i in selected)
                initial_solution[y[i, w]] = int(i in starting)
                initial_solution[cap[i, w]] = int(i == week["captain"])
                initial_solution[buys[i, w]] = int(i in week["transfers_in"])
                initial_solution[sells[i, w]] = int(i in week["transfers_out"])
        if not b.feasible(initial_solution):
            initial_solution = None
    joint_started = time.monotonic()
    result = b.solve(seconds, initial_solution=initial_solution, native_highs=horizon > 14 or _warm_held_seed)
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
        if not (locked | set(locked_by_gw.get(gw, []))).issubset(selected):
            raise RuntimeError("Solver result violated a required-player constraint.")
        if (excluded | set(excluded_by_gw.get(gw, []))) & set(selected):
            raise RuntimeError("Solver result violated a player exclusion.")
        if captain_locks.get(gw, captain) != captain:
            raise RuntimeError("Solver result violated a captain lock.")
        limit = transfer_limits.get(gw, max_transfers if chip not in ("wildcard", "freehit") and (squad or w > 0) else 15)
        if sum(i not in base for i in selected) > limit:
            raise RuntimeError("Solver result violated a transfer limit.")
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
        "gap": float(result.mip_gap) if getattr(result, "mip_gap", None) is not None and math.isfinite(result.mip_gap) else None,
        "candidate_count": len(ids),
        "pool_count": len(players),
        "requested_horizon": requested_horizon,
        "actual_horizon": horizon,
        "start_gw": start_gw,
        "end_gw": weeks[-1],
        "solve_seconds": round(time.monotonic() - started, 3),
        "time_limit_seconds": seconds,
        "variable_count": len(b.cost),
        "constraint_count": len(b.clow),
        "status_code": int(result.status),
        "feasible": True,
        "engine": getattr(result, "engine", "SciPy/HiGHS · joint MILP"),
        "warm_start": bool(getattr(result, "warm_start", False)),
        "warm_start_seconds": round(seed_seconds, 3),
        "joint_solve_seconds": round(time.monotonic() - joint_started, 3),
        "native_status": getattr(result, "native_status", str(result.status)),
        "assumptions": [
            "Candidate screening: top 24 and cheapest 8 per position, plus existing, locked, scheduled-captain and warm-start players.",
            "Prices held fixed; bank uses initial selling prices. Rebuying an initial player is conservatively valued.",
            "The optimisation objective uses a linear bench weight. Displayed totals separately include formation-aware autosubs and vice fallback under independent appearances.",
            "Chips are user-scheduled. Free Hit restores the previous permanent squad and bank.",
            "Forecast quality is independent of optimiser optimality.",
        ],
    }


def _weekly_constraints(values, weeks, name, lookup):
    """Canonical IDs/weeks and bounds for HTTP and direct solver callers."""
    if values is None:
        return {}
    if not isinstance(values, dict) or len(values) > 38:
        raise ValueError(f"{name} must map solve gameweeks to constraints.")
    result = {}
    for raw_gw, value in values.items():
        try:
            gw = int(raw_gw)
        except (TypeError, ValueError, OverflowError):
            raise ValueError(f"Invalid {name} gameweek.") from None
        if isinstance(raw_gw, bool) or str(raw_gw) != str(gw) or gw not in weeks:
            raise ValueError(f"{name} gameweeks must be in the requested solve horizon.")
        if name == "transfer_limits":
            if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 15:
                raise ValueError("Weekly transfer limits must be integers from 0 to 15.")
        elif name == "captain_locks":
            if isinstance(value, bool) or not isinstance(value, int) or value not in lookup:
                raise ValueError("Captain locks must refer to current player IDs.")
        else:
            limit = 15 if name == "locked_by_gw" else 700
            if (
                not isinstance(value, list) or len(value) > limit
                or any(isinstance(i, bool) or not isinstance(i, int) or i not in lookup for i in value)
                or len(value) != len(set(value))
            ):
                raise ValueError(f"{name} requires distinct current player IDs within squad limits.")
        result[gw] = value
    return result


def _held_week(
    players, lookup, gw, owned, cash, transfers, chips,
    locked, excluded, locked_by_gw, excluded_by_gw, captain_locks,
):
    """A legal unchanged squad, including captain requirements and chip FTs."""
    required = locked | set(locked_by_gw.get(gw, []))
    prohibited = excluded | set(excluded_by_gw.get(gw, []))
    captain = captain_locks.get(gw)
    if captain is not None:
        required.add(captain)
    if not required.issubset(owned) or prohibited & set(owned):
        return None
    chip = chips.get(gw, "none")
    lineup = best_lineup(owned, players, gw, chip)
    if captain is not None and captain not in lineup["starters"]:
        same_position = [i for i in lineup["starters"] if lookup[i]["position_id"] == lookup[captain]["position_id"]]
        replaced = min(same_position, key=lambda i: points(lookup[i], gw))
        lineup["starters"] = [captain if i == replaced else i for i in lineup["starters"]]
        lineup["bench"] = [replaced if i == captain else i for i in lineup["bench"]]
    if captain is not None:
        lineup["captain"] = captain
        lineup["vice"] = max((i for i in lineup["starters"] if i != captain), key=lambda i: points(lookup[i], gw))
    return {
        "gw": gw, "squad": list(owned), "starters": lineup["starters"], "bench": lineup["bench"],
        "captain": lineup["captain"], "vice": lineup["vice"], "chip": chip,
        "bank": cash, "free_transfers": transfers,
        "next_free_transfers": transfers if chip in ("wildcard", "freehit") else min(5, transfers + 1),
        "hits": 0, "transfers_in": [], "transfers_out": [],
    }


def _held_seed_plan(
    players, squad, bank, weeks, free_transfers, chips, locked, excluded,
    locked_by_gw, excluded_by_gw, captain_locks,
):
    if not squad:
        return None
    lookup, transfers, result = {p["id"]: p for p in players}, free_transfers, []
    for gw in weeks:
        week = _held_week(
            players, lookup, gw, squad, bank, transfers, chips,
            locked, excluded, locked_by_gw, excluded_by_gw, captain_locks,
        )
        if week is None:
            return None
        result.append(week)
        transfers = week["next_free_transfers"]
    return result


def _long_seed_plan(
    players, squad, bank, budget, start_gw, horizon, free_transfers,
    max_transfers, decay, ft_value, bench_weight, risk, locked, excluded,
    chips, purchase_prices, seconds, used_chips, transfer_limits,
    locked_by_gw, excluded_by_gw, captain_locks,
):
    """Bounded short-prefix solves supply an incumbent, never the final search.

    Prefer a four-week optimised prefix and legal held continuation. If later
    locks/exclusions require changes, solve further four-week segments. The
    assembled complete strategy is checked against the original full MILP
    before HiGHS receives it, then all horizon decisions remain free to change.
    """
    lookup = {p["id"]: p for p in players}
    end = start_gw + horizon
    permanent, cash, ft = list(squad), bank, free_transfers
    output = []
    seed_limit = min(4, max(2, seconds / 4))

    def hold(gw, owned, available_cash, transfers):
        return _held_week(
            players, lookup, gw, owned, available_cash, transfers, chips,
            locked, excluded, locked_by_gw, excluded_by_gw, captain_locks,
        )

    cursor = start_gw
    while cursor < end:
        stop = min(end, cursor + 4)
        selected_weeks = set(range(cursor, stop))
        held_prefix = []
        held_ft = ft
        if permanent:
            for gw in range(cursor, stop):
                week = hold(gw, permanent, cash, held_ft)
                if week is None:
                    held_prefix = []
                    break
                held_prefix.append(week)
                held_ft = week["next_free_transfers"]
        try:
            prefix = optimise(
                players, squad=permanent, bank=cash, budget=budget,
                start_gw=cursor, horizon=stop - cursor, free_transfers=ft,
                max_transfers=max_transfers, decay=decay, ft_value=ft_value,
                bench_weight=bench_weight, risk=risk, locked=list(locked), excluded=list(excluded),
                chips={gw: chip for gw, chip in chips.items() if gw in selected_weeks},
                purchase_prices=purchase_prices, seconds=seed_limit, used_chips=used_chips,
                transfer_limits={gw: n for gw, n in transfer_limits.items() if gw in selected_weeks},
                locked_by_gw={gw: ids for gw, ids in locked_by_gw.items() if gw in selected_weeks},
                excluded_by_gw={gw: ids for gw, ids in excluded_by_gw.items() if gw in selected_weeks},
                captain_locks={gw: pid for gw, pid in captain_locks.items() if gw in selected_weeks},
                _initial_plan=held_prefix or None,
            )["weeks"]
        except ValueError:
            # A legal held segment still gives the joint solver a useful
            # starting point when a tiny prefix budget found no incumbent.
            if not permanent:
                return None
            prefix = []
            prefix_ft = ft
            for gw in range(cursor, stop):
                week = hold(gw, permanent, cash, prefix_ft)
                if week is None:
                    return None
                prefix.append(week)
                prefix_ft = week["next_free_transfers"]
        output.extend(prefix)
        for week in prefix:
            ft = week["next_free_transfers"]
            if week["chip"] != "freehit":
                permanent, cash = week["squad"], week["bank"]
        cursor = stop
        tail = []
        tail_ft = ft
        for gw in range(cursor, end):
            week = hold(gw, permanent, cash, tail_ft)
            if week is None:
                break
            tail.append(week)
            tail_ft = week["next_free_transfers"]
        else:
            return output + tail
    return output

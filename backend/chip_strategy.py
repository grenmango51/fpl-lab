"""Bounded, frozen-input WC/FH schedule search around the existing solver."""

from __future__ import annotations

import copy
import hashlib
import json
import logging
import math
import time
import uuid
from collections import Counter
from datetime import datetime, timezone
from threading import Event, RLock, Thread

from .solver import (
    CHIPS, SQUAD_COUNTS, _weekly_constraints, optimise, validate_chip_history,
    validate_squad,
)

log = logging.getLogger(__name__)
ACTIVE = {"queued", "running"}
AUTO_CHIPS = ("wildcard", "freehit")


class ChipStrategyConflict(ValueError):
    pass


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(
        value, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode()).hexdigest()


def half(gw):
    return 1 if gw <= 19 else 2


def evenly_spaced(values, count):
    if len(values) <= count:
        return list(values)
    if count == 1:
        return [values[(len(values) - 1) // 2]]
    return [values[round(i * (len(values) - 1) / (count - 1))] for i in range(count)]


def validate_state(state, weeks, payload):
    # Lazy import keeps app request models/validator authoritative without a
    # module import cycle. No provider calls occur during this replay.
    from .app import PlanRequest, validate_plan_payload
    return validate_plan_payload(PlanRequest(**state, weeks=weeks), payload)["weeks"]


def error_message(exc):
    detail = getattr(exc, "detail", None)
    if detail is not None:
        return detail if isinstance(detail, str) else json.dumps(detail, allow_nan=False)
    return str(exc) or type(exc).__name__


def check_constraints(weeks, args):
    """Independently check constraints not covered by ordinary plan replay."""
    expected = list(range(args["start_gw"], args["start_gw"] + args["horizon"]))
    if [w["gw"] for w in weeks] != expected:
        raise ValueError("The solver did not return exactly the requested gameweeks.")
    chips = {int(gw): chip for gw, chip in args.get("chips", {}).items()}
    for week in weeks:
        gw = week["gw"]
        if week.get("chip", "none") != chips.get(gw, "none"):
            raise ValueError(f"The solver changed the assigned chip in GW{gw}.")
        owned = set(week["squad"])
        required = set(args.get("locked", [])) | set(args.get("locked_by_gw", {}).get(str(gw), []))
        prohibited = set(args.get("excluded", [])) | set(args.get("excluded_by_gw", {}).get(str(gw), []))
        captain = args.get("captain_locks", {}).get(str(gw))
        if not required <= owned or prohibited & owned:
            raise ValueError(f"The solver violated ownership constraints in GW{gw}.")
        if captain is not None and week["captain"] != captain:
            raise ValueError(f"The solver violated the captain lock in GW{gw}.")
        ceiling = args.get("transfer_limits", {}).get(str(gw))
        if ceiling is None and week["chip"] not in AUTO_CHIPS:
            ceiling = args["max_transfers"]
        if ceiling is not None and len(week["transfers_in"]) > ceiling:
            raise ValueError(f"The solver violated the transfer ceiling in GW{gw}.")


def prepare(payload, args, settings, source=None):
    """Validate/freeze entering resources, prefix, constraints and screened dates."""
    args, source = copy.deepcopy(args), copy.deepcopy(source)
    args["horizon"] = min(args["horizon"], 39 - args["start_gw"])
    gameweeks = list(range(args["start_gw"], args["start_gw"] + args["horizon"]))
    players = payload["players"]
    lookup = {p["id"]: p for p in players}
    if not players or len(lookup) != len(players):
        raise ValueError("The frozen player pool must be nonempty and have distinct IDs.")
    if not set(gameweeks) <= set(payload["gameweeks"]):
        raise ValueError("The requested horizon exceeds the available forecast window.")
    for player in players:
        for gw in gameweeks:
            row = player.get("gw", {}).get(str(gw), {})
            if not isinstance(row.get("points"), (int, float)) or not math.isfinite(row["points"]):
                raise ValueError("Every player must have a finite forecast for every requested gameweek.")
    prefix = []
    manual = {}
    for key, chip in args.get("chips", {}).items():
        if not key.isdigit() or key != str(int(key)) or int(key) not in gameweeks or chip not in CHIPS:
            raise ValueError("Manual chips must use canonical IDs inside the solve window.")
        if chip != "none":
            manual[key] = chip
    if source is not None:
        source_weeks = sorted(source.pop("weeks"), key=lambda w: w["gw"])
        state = source
        if source_weeks:
            source_gws = [week["gw"] for week in source_weeks]
            if source_gws != list(range(source_gws[0], source_gws[-1] + 1)):
                raise ValueError("Source weeks must be consecutive and distinct.")
            if source_gws[0] > args["start_gw"]:
                raise ValueError("The source plan starts after the requested solve start.")
            prefix = [w for w in source_weeks if w["gw"] < args["start_gw"]]
            if prefix and prefix[-1]["gw"] != args["start_gw"] - 1:
                raise ValueError("The source prefix must reach the week before the solve start.")
            ledger = [*state["used_chips"], *(
                {"chip": w.get("chip", "none"), "gw": w["gw"]}
                for w in source_weeks if w.get("chip", "none") != "none"
            )]
            # Validate quotas/collisions independently, even in the unsolved suffix.
            validate_chip_history(ledger, 39)
            validate_chip_history(state["used_chips"], source_gws[0])
            for week in source_weeks:
                chip, key = week.get("chip", "none"), str(week["gw"])
                if chip == "none" or week["gw"] < args["start_gw"]:
                    continue
                if week["gw"] not in gameweeks:
                    raise ValueError("Extend the horizon to preserve a later manual chip.")
                if key in manual and manual[key] != chip:
                    raise ValueError("A requested chip conflicts with a mandatory source chip.")
                manual[key] = chip
            if prefix:
                prefix = validate_state(state, prefix, payload)
    else:
        state = {
            "base_squad": args["squad"], "bank": args["bank"],
            "free_transfers": args["free_transfers"],
            "purchase_prices": args["purchase_prices"], "used_chips": args["used_chips"],
        }
    errors = validate_squad(state["base_squad"], players)
    if errors:
        raise ValueError(" ".join(errors))
    if prefix:
        receipt = prefix[-1]
        args.update(
            squad=receipt["permanent_squad"], bank=receipt["permanent_bank"],
            free_transfers=receipt["next_free_transfers"], purchase_prices=receipt["purchase_prices"],
        )
    else:
        args.update(
            squad=state["base_squad"], bank=state["bank"],
            free_transfers=state["free_transfers"], purchase_prices=state["purchase_prices"],
        )
    args["used_chips"] = [*state["used_chips"], *(
        {"chip": w["chip"], "gw": w["gw"]} for w in prefix if w["chip"] != "none"
    )]
    used = validate_chip_history(args["used_chips"], args["start_gw"])
    for key, chip in manual.items():
        allowance = (chip, half(int(key)))
        if allowance in used:
            raise ValueError("Each chip may be used once per half of the season.")
        used.add(allowance)
    args["chips"] = manual
    validate_chip_history(state["used_chips"], prefix[0]["gw"] if prefix else args["start_gw"])
    locked, excluded = set(args["locked"]), set(args["excluded"])
    if not (locked | excluded) <= lookup.keys():
        raise ValueError("A constraint refers to an unknown player.")
    for name in ("transfer_limits", "locked_by_gw", "excluded_by_gw", "captain_locks"):
        parsed = _weekly_constraints(args[name], gameweeks, name, lookup)
        args[name] = {str(gw): value for gw, value in parsed.items()}
    for gw in gameweeks:
        required = locked | set(args["locked_by_gw"].get(str(gw), []))
        captain = args["captain_locks"].get(str(gw))
        if captain is not None:
            required.add(captain)
        prohibited = excluded | set(args["excluded_by_gw"].get(str(gw), []))
        if required & prohibited:
            raise ValueError(f"A player is both required and excluded in GW{gw}.")
        positions = Counter(lookup[i]["position_id"] for i in required)
        clubs = Counter(lookup[i]["team"] for i in required)
        if len(required) > 15 or any(positions[p] > n for p, n in SQUAD_COUNTS.items()) or any(n > 3 for n in clubs.values()):
            raise ValueError(f"Required players exceed squad composition/club limits in GW{gw}.")
    chip, season_half = settings["auto_chip"], settings["chip_half"]
    if (chip, season_half) in used:
        raise ValueError("This chip allowance is already used or manually scheduled in that half.")
    filter_gws = settings["candidate_gws"]
    if len(filter_gws) != len(set(filter_gws)) or any(
        gw not in gameweeks or half(gw) != season_half or str(gw) in manual
        for gw in filter_gws
    ):
        raise ValueError("Candidate dates must be distinct chip-free solve weeks in the selected half.")
    eligible = [gw for gw in gameweeks if half(gw) == season_half and str(gw) not in manual
                and (not filter_gws or gw in filter_gws)]
    if not eligible:
        raise ValueError("No legal placement gameweeks are available in this window and half.")
    selected = evenly_spaced(eligible, settings["max_candidates"])
    schedules = [[{"chip": chip, "half": season_half, "gw": gw}] for gw in selected]
    return args, state, prefix, schedules, {
        "gameweeks": gameweeks, "eligible_gameweeks": eligible,
        "selected_gameweeks": selected, "all_eligible_selected": len(selected) == len(eligible),
    }


class ChipStrategyJobs:
    """Observable process-local jobs; cancellation never discards valid results."""

    def __init__(self, solve=optimise, clock=time.monotonic):
        self.solve, self.clock = solve, clock
        self.lock = RLock()
        self.jobs = {}

    def start(self, payload, args, settings, source=None, configuration=None):
        frozen = copy.deepcopy(payload)
        settings = copy.deepcopy(settings)
        args, state, prefix, schedules, scope = prepare(frozen, args, settings, source)
        forecast_hash = digest(frozen["players"])
        configuration_hash = digest(configuration or {})
        input_hash = digest({"forecast": forecast_hash, "configuration": configuration_hash,
                             "solve": args, "source": state, "prefix": prefix, "settings": settings})
        candidates = []
        for index, placements in enumerate([[], *schedules]):
            candidates.append({
                "id": "baseline" if index == 0 else f"strategy-{index}",
                "chip": placements[0]["chip"] if len(placements) == 1 else ("mixed" if placements else "none"),
                "gw": placements[0]["gw"] if len(placements) == 1 else None,
                "placements": placements, "status": "pending", "error": None,
            })
        with self.lock:
            for job in self.jobs.values():
                self._check_thread(job)
            if any(job["public"]["status"] in ACTIVE for job in self.jobs.values()):
                raise ChipStrategyConflict("A chip strategy search is already running; cancel it or wait.")
            while len(self.jobs) >= 6:
                self.jobs.pop(next(iter(self.jobs)))
            job_id = uuid.uuid4().hex
            public = {
                "id": job_id, "status": "queued", "phase": "Baseline",
                "created_at": timestamp(), "started_at": None, "finished_at": None,
                "elapsed_seconds": 0, "attempted": 0, "completed": 0,
                "total": len(candidates), "current_candidate_id": None,
                "cancel_requested": False, "error": None, "failures": [],
                "settings": {**settings, "solve": args},
                "forecast": {
                    "sha256": forecast_hash, "configuration_hash": configuration_hash,
                    "input_hash": input_hash, "model_version": frozen.get("model_version"),
                    "loaded_at": frozen.get("loaded_at"), "frozen_at": timestamp(),
                    "layers": frozen.get("forecast_layers", []), "sources": frozen.get("sources", {}),
                    "coverage": {"players": len(frozen["players"]), "gameweeks": scope["gameweeks"],
                                 "player_gameweeks": len(frozen["players"]) * len(scope["gameweeks"])},
                },
                "scope": scope, "candidates": candidates, "baseline": None, "best": None,
                "recommendation": None,
                "method": "Evenly spaced legal dates for one WC/FH allowance; fresh joint transfer/lineup solve per placement, independent server replay, matched-GW discounted full squad EV minus hits.",
                "limitations": [
                    "One chip in one half; other manual chips and earlier decisions stay fixed. Screened dates and solver pools do not establish global chip timing optimality.",
                    "Solver objective includes linear bench, saved-FT and ownership utilities; comparison uses full squad EV minus hits with decay.",
                    "Native limits, warm starts and MIP gaps can affect rankings; unknown gaps remain unknown.",
                    "Future prices stay fixed; initial-player rebuys use the existing conservative solver sale-value convention.",
                    "Independent appearances and forecast uncertainty are uncalibrated; this is not Solio's proprietary stochastic algorithm.",
                    "Cancellation and wall budget take effect between bounded solves, including seed work; completed valid plans remain available.",
                    "Reports are local to this process; download before restarting. No FPL transfers are submitted.",
                ],
            }
            job = {"public": public, "cancel": Event(), "started": None}
            self.jobs[job_id] = job
            thread = Thread(target=self._run, args=(job, frozen, args, state, prefix), daemon=True)
            job["thread"] = thread
            thread.start()
            return copy.deepcopy(public)

    def _check_thread(self, job):
        thread = job.get("thread")
        if job["public"]["status"] in ACTIVE and thread is not None and not thread.is_alive():
            self._finish(job, "failed", "Background strategy worker stopped unexpectedly.")

    def _finish(self, job, status, error=None):
        public = job["public"]
        public.update(status=status, phase="Finished", finished_at=timestamp(), error=error, current_candidate_id=None)
        if job["started"] is not None:
            public["elapsed_seconds"] = max(0, self.clock() - job["started"])
        reason = {"cancelled": "skipped-cancel", "budget-exhausted": "skipped-budget"}.get(status, "skipped-failure")
        for row in public["candidates"]:
            if row["status"] in {"pending", "running"}:
                row["status"] = reason

    def get(self, job_id):
        with self.lock:
            job = self.jobs[job_id]
            self._check_thread(job)
            result = copy.deepcopy(job["public"])
            if result["status"] in ACTIVE and job["started"] is not None:
                result["elapsed_seconds"] = max(0, self.clock() - job["started"])
            return result

    def cancel(self, job_id):
        with self.lock:
            job = self.jobs[job_id]
            self._check_thread(job)
            if job["public"]["status"] in ACTIVE:
                job["cancel"].set()
                job["public"]["cancel_requested"] = True
            return self.get(job_id)

    def _run(self, job, payload, args, state, prefix):
        try:
            with self.lock:
                job["started"] = self.clock()
                job["public"].update(status="running", started_at=timestamp())
            retained = set()
            for row in job["public"]["candidates"]:
                with self.lock:
                    if job["cancel"].is_set():
                        self._finish(job, "cancelled")
                        return
                    if self.clock() - job["started"] >= job["public"]["settings"]["budget_seconds"]:
                        self._finish(job, "budget-exhausted")
                        return
                    row["status"] = "running"
                    job["public"].update(phase="Baseline" if row["id"] == "baseline" else "Testing schedule", current_candidate_id=row["id"])
                    job["public"]["attempted"] += 1
                candidate_args = copy.deepcopy(args)
                candidate_args["chips"].update({str(p["gw"]): p["chip"] for p in row["placements"]})
                candidate_args["extra_candidates"] = sorted(retained)
                # Even a short two-second solve starts from a checked legal
                # hold when its constraints allow one. No feasibility search
                # is needed merely to keep the user's existing squad.
                candidate_args["_warm_held_seed"] = True
                try:
                    # A separate copy prevents a solver mutation from changing later inputs.
                    result = self.solve(copy.deepcopy(payload["players"]), **candidate_args)
                    if result.get("feasible") is False:
                        raise ValueError("The solver returned no feasible incumbent.")
                    combined = validate_state(state, [*prefix, *result["weeks"]], payload)
                    solved = combined[len(prefix):]
                    check_constraints(solved, candidate_args)
                    net = sum(w["net_points"] for w in solved)
                    discounted = sum(w["net_points"] * args["decay"] ** index for index, w in enumerate(solved))
                    if not math.isfinite(net) or not math.isfinite(discounted):
                        raise ValueError("Validated strategy points must be finite.")
                    with self.lock:
                        baseline = job["public"]["baseline"]
                        row.update(
                            status="complete", weeks=combined, solve_weeks=solved,
                            chips={str(w["gw"]): w["chip"] for w in combined if w["chip"] != "none"},
                            net_points=net, discounted_net_points=discounted,
                            improvement=discounted - baseline["discounted_net_points"] if baseline else None,
                            undiscounted_improvement=net - baseline["net_points"] if baseline else None,
                            solve={**result, "weeks": solved},
                        )
                        if row["id"] == "baseline":
                            row.update(improvement=0.0, undiscounted_improvement=0.0)
                            job["public"]["baseline"] = copy.deepcopy(row)
                            retained = {pid for w in solved for pid in w["squad"]}
                        best = job["public"]["best"]
                        if best is None or discounted > best["discounted_net_points"] + 1e-9:
                            job["public"]["best"] = copy.deepcopy(row)
                            job["public"]["recommendation"] = None if row["id"] == "baseline" else {
                                "chip": row["chip"], "gw": row["gw"], "improvement": row["improvement"],
                            }
                        job["public"]["completed"] += 1
                except Exception as exc:
                    log.exception("Chip strategy candidate failed: %s", row["id"])
                    message = error_message(exc)
                    with self.lock:
                        row.update(status="failed", error=message)
                        job["public"]["failures"].append({"candidate_id": row["id"], "message": message})
                        if row["id"] == "baseline":
                            self._finish(job, "failed", f"The no-added-chip baseline failed: {message}")
                            return
            with self.lock:
                status = "cancelled" if job["cancel"].is_set() else ("complete" if job["public"]["completed"] else "failed")
                self._finish(job, status, "No schedule returned a valid plan." if status == "failed" else None)
        except Exception as exc:
            log.exception("Chip strategy worker failed")
            with self.lock:
                for row in job["public"]["candidates"]:
                    if row["status"] == "running":
                        row.update(status="failed", error=error_message(exc))
                self._finish(job, "failed", error_message(exc))


jobs = ChipStrategyJobs()

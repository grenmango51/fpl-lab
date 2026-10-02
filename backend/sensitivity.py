"""Reoptimise explicit forecast stresses; these are not calibrated outcomes."""

from __future__ import annotations

import copy
import hashlib
import json
import logging
import math
import uuid
from collections import Counter
from datetime import datetime, timezone
from threading import Event, RLock, Thread

import numpy as np

from .scoring import team_points
from .solver import optimise

log = logging.getLogger(__name__)
ACTIVE = {"queued", "running"}


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def stress_players(players, weeks, variation, seed, index):
    """Mean-one lognormal factor per player, held constant over the horizon."""
    rng = np.random.default_rng(np.random.SeedSequence([seed, index]))
    sigma = math.sqrt(math.log1p(variation**2))
    factors = dict(
        zip(
            sorted(p["id"] for p in players),
            np.exp(sigma * rng.standard_normal(len(players)) - sigma**2 / 2),
        )
    )
    output = []
    for player in players:
        forecasts = dict(player["gw"])
        for gw in weeks:
            key = str(gw)
            if key not in forecasts:
                continue
            original = forecasts[key]
            points = float(original["points"]) * float(factors[player["id"]])
            parts = dict(original.get("components", {}))
            parts["stress_adjustment"] = points - float(original["points"])
            forecasts[key] = {**original, "points": points, "components": parts}
        output.append({**player, "gw": forecasts})
    return output


def plan_value(weeks, players, decay):
    """Full squad EV minus hits, discounted; excludes saved-FT utility."""
    lookup = {p["id"]: p for p in players}
    values = []
    for index, week in enumerate(weeks):
        score = team_points(
            week["starters"],
            week["bench"],
            week["captain"],
            week["vice"],
            lookup,
            week["gw"],
            week["chip"],
        )["points"]
        values.append((score - week["hits"]) * decay**index)
    return sum(values)


def summarise(rows):
    counts = {key: Counter() for key in ("purchases", "sales", "captains")}
    variants = {}
    for row in rows:
        first = row["weeks"][0]
        counts["purchases"].update(first["transfers_in"])
        counts["sales"].update(first["transfers_out"])
        counts["captains"].update([first["captain"]])
        key = (
            tuple(sorted(first["transfers_in"])),
            tuple(sorted(first["transfers_out"])),
            first["captain"],
        )
        if key not in variants:
            variants[key] = {
                "count": 0,
                "scenario": row["scenario"],
                "weeks": row["weeks"],
                "base_value": row["base_value"],
                "gap": row["gap"],
            }
        variants[key]["count"] += 1
    differences = [row["difference"] for row in rows]
    return {
        "denominator": len(rows),
        "frequencies": {
            key: [
                {"id": pid, "count": count, "fraction": count / len(rows)}
                for pid, count in counter.most_common()
            ]
            for key, counter in counts.items()
        },
        "roll_count": sum(not row["weeks"][0]["transfers_in"] for row in rows),
        "differences": {
            "mean": float(np.mean(differences)),
            "p10": float(np.percentile(differences, 10)),
            "p90": float(np.percentile(differences, 90)),
        }
        if differences
        else None,
        "variants": sorted(variants.values(), key=lambda row: -row["count"]),
    }


class SensitivityJobs:
    """One bounded local job at a time, with observable progress and cancellation."""

    def __init__(self, solve=optimise):
        self.solve = solve
        self.lock = RLock()
        self.jobs = {}

    def start(self, payload, args, scenarios, variation, seed, name):
        # Freeze forecasts and settings. A later minutes edit cannot change a run.
        players = copy.deepcopy(payload["players"])
        args = copy.deepcopy(args)
        weeks = list(range(args["start_gw"], args["start_gw"] + args["horizon"]))
        digest = hashlib.sha256(
            json.dumps(
                players,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode()
        ).hexdigest()
        with self.lock:
            for job in self.jobs.values():
                self._check_thread(job)
            if any(j["public"]["status"] in ACTIVE for j in self.jobs.values()):
                raise ValueError(
                    "A forecast stress test is already running. Cancel it or wait for it to finish."
                )
            while len(self.jobs) >= 6:
                self.jobs.pop(next(iter(self.jobs)))
            job_id = uuid.uuid4().hex
            job = {
                "cancel": Event(),
                "public": {
                    "id": job_id,
                    "status": "queued",
                    "phase": "Reference solve",
                    "created_at": timestamp(),
                    "finished_at": None,
                    "attempted": 0,
                    "completed": 0,
                    "total": scenarios,
                    "cancel_requested": False,
                    "error": None,
                    "failures": [],
                    "settings": {
                        "variation": variation,
                        "seed": seed,
                        "name": name,
                        "solve": args,
                    },
                    "forecast": {
                        "model_version": payload.get("model_version"),
                        "loaded_at": payload.get("loaded_at"),
                        "sha256": digest,
                        "layers": payload.get("forecast_layers", []),
                    },
                    "baseline": None,
                    "baseline_value": None,
                    "summary": summarise([]),
                    "method": "Mean-one lognormal point factors, independent between players and constant across weeks. Appearance probabilities, fixtures and prices stay fixed. Variation is a user assumption, not estimated forecast error.",
                    "limitations": [
                        "Frequencies describe successful assumed scenarios, not probabilities that a transfer is correct.",
                        "The MILP uses a linear bench objective and saved-FT/ownership preferences. Differences are rescored using full squad EV minus hits and decay; they can be negative.",
                        "Candidate pools change with each stress; reference players are retained. Solve time limits and pool screening can affect frequencies.",
                        "Variants group first-week transfers and captaincy; later moves and bench order may differ. A representative full plan is shown.",
                        "No correlated team shocks, injury scenarios, price movements or match-outcome simulation are included.",
                        "Jobs are local to this server process. Download a completed report to keep it after restarting.",
                    ],
                },
            }
            thread = Thread(
                target=self._run,
                args=(job_id, players, weeks),
                daemon=True,
                name="fpl-stress",
            )
            job["thread"] = thread
            self.jobs[job_id] = job
            thread.start()
            return copy.deepcopy(job["public"])

    def _check_thread(self, job):
        public = job["public"]
        if public["status"] in ACTIVE and not job["thread"].is_alive():
            public.update(
                status="failed",
                phase="Stopped",
                finished_at=timestamp(),
                error="The stress worker stopped before reporting completion. Start a new test.",
            )

    def get(self, job_id):
        with self.lock:
            job = self.jobs[job_id]
            self._check_thread(job)
            return copy.deepcopy(job["public"])

    def cancel(self, job_id):
        with self.lock:
            job = self.jobs[job_id]
            self._check_thread(job)
            if job["public"]["status"] in ACTIVE:
                job["cancel"].set()
                job["public"]["cancel_requested"] = True
            return copy.deepcopy(job["public"])

    def _run(self, job_id, players, weeks):
        job = self.jobs[job_id]
        public, cancel = job["public"], job["cancel"]
        settings, rows = public["settings"], []
        args = settings["solve"]
        try:
            with self.lock:
                public["status"] = "running"
            baseline = self.solve(players, **args)
            baseline_value = plan_value(baseline["weeks"], players, args["decay"])
            extras = sorted(
                {pid for week in baseline["weeks"] for pid in week["squad"]}
            )
            with self.lock:
                public.update(baseline=baseline, baseline_value=baseline_value)
            for index in range(public["total"]):
                if cancel.is_set():
                    break
                with self.lock:
                    public["phase"] = f"Scenario {index + 1} of {public['total']}"
                stressed = stress_players(
                    players, weeks, settings["variation"], settings["seed"], index
                )
                try:
                    result = self.solve(stressed, **args, extra_candidates=extras)
                    value = plan_value(result["weeks"], stressed, args["decay"])
                    reference = plan_value(baseline["weeks"], stressed, args["decay"])
                    rows.append(
                        {
                            "scenario": index + 1,
                            "weeks": result["weeks"],
                            "base_value": plan_value(
                                result["weeks"], players, args["decay"]
                            ),
                            "difference": value - reference,
                            "gap": result["gap"],
                        }
                    )
                except ValueError as exc:
                    with self.lock:
                        public["failures"].append(
                            {"scenario": index + 1, "message": str(exc)}
                        )
                with self.lock:
                    public.update(
                        attempted=index + 1,
                        completed=len(rows),
                        summary=summarise(rows),
                    )
            with self.lock:
                status = (
                    "cancelled" if cancel.is_set() else "complete" if rows else "failed"
                )
                public.update(status=status, phase="Finished", finished_at=timestamp())
                if not rows and not cancel.is_set():
                    public["error"] = (
                        "No stress scenario returned a feasible plan within its time limit. Increase the time per solve or relax constraints."
                    )
        except Exception as exc:
            log.exception("Forecast stress job failed")
            with self.lock:
                public.update(
                    status="failed",
                    phase="Stopped",
                    error=str(exc),
                    finished_at=timestamp(),
                )


jobs = SensitivityJobs()

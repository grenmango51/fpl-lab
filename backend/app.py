from __future__ import annotations

import csv
import io
import json
import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

from .data import ROOT, FPL, fetch, get_data
from .model import projections, player_history, simulate_player
from .solver import optimise, best_lineup, validate_squad, sale_price
from .scoring import team_points
from .ensemble import blend_forecasts
from .sensitivity import jobs as sensitivity_jobs

app = FastAPI(title="Open FPL", version="0.1.0")
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=3)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
log = logging.getLogger(__name__)


class MinutesScenario(BaseModel):
    conditional_minutes: float | None = Field(default=None, ge=0, le=90)
    availability: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def nonempty(self):
        if self.conditional_minutes is None and self.availability is None:
            raise ValueError("A minutes scenario needs duration or availability.")
        return self


class ForecastRequest(BaseModel):
    overrides: dict[str, float] = Field(default_factory=dict)
    minutes_schedule: dict[str, dict[str, MinutesScenario]] = Field(
        default_factory=dict
    )
    use_market: bool = True
    custom_points: dict[str, dict[str, float]] = Field(default_factory=dict)
    blend_weight: float = Field(default=0, ge=0, le=1)
    use_provider: bool = True
    provider_weight: float = Field(default=0.5, ge=0, le=1)
    extrapolate: bool = True
    anchor_half_life: float = Field(default=6, ge=1, le=20)
    custom_name: str = Field(default="Imported CSV", max_length=120)

    def validated_overrides(self):
        if len(self.overrides) > 700 or any(
            not k.isdigit() or not 0 <= v <= 90 for k, v in self.overrides.items()
        ):
            raise HTTPException(
                422, "Minutes overrides must map player IDs to values between 0 and 90."
            )
        return self.overrides

    def validated_schedule(self):
        if not self.minutes_schedule:
            return {}
        data = get_data()
        if len(self.minutes_schedule) > 700 or any(
            not pid.isdigit()
            or pid != str(int(pid))
            or int(pid) not in data["players"]
            or len(weeks) > 38
            or not weeks
            or any(
                not gw.isdigit()
                or gw != str(int(gw))
                or not data["next_gw"] <= int(gw) <= 38
                for gw in weeks
            )
            for pid, weeks in self.minutes_schedule.items()
        ):
            raise HTTPException(
                422,
                "Minutes schedules must use current player IDs and remaining gameweeks.",
            )
        return self.model_dump(exclude_none=True)["minutes_schedule"]


def forecast_for(request: ForecastRequest):
    schedule = request.validated_schedule()
    overrides = request.validated_overrides()
    payload = projections(overrides, request.use_market, schedule)
    calibration = projections(overrides, request.use_market) if schedule else None
    payload["reference_data"] = get_data().get("elevenify_reference", {})

    def apply_layer(points, weight, name, probabilities=None, source_at=None):
        nonlocal payload, calibration
        previous = calibration
        args = (
            points,
            weight,
            name,
            request.extrapolate,
            request.anchor_half_life,
            probabilities,
            source_at,
        )
        if calibration is not None:
            calibration = blend_forecasts(calibration, *args)
        payload = blend_forecasts(
            payload,
            *args,
            minutes_schedule=schedule,
            calibration_payload=previous,
        )

    if request.use_provider and request.provider_weight > 0:
        source = get_data().get("fplform", {})
        supplied = {
            pid: v["points"]
            for pid, v in source.get("players", {}).items()
            if pid not in request.overrides
        }
        probabilities = {
            pid: v["probabilities"] for pid, v in source.get("players", {}).items()
        }
        apply_layer(
            supplied,
            request.provider_weight,
            "FPL Form",
            probabilities,
            source.get("source_at"),
        )
    if not request.custom_points or request.blend_weight == 0:
        return payload
    if len(request.custom_points) > 700:
        raise HTTPException(422, "Custom forecasts exceed the current player pool.")
    lookup = {str(p["id"]): p for p in payload["players"]}
    for pid, values in request.custom_points.items():
        if (
            pid not in lookup
            or len(values) > 38
            or any(
                not gw.isdigit()
                or int(gw) not in payload["gameweeks"]
                or not -5 <= point <= 60
                for gw, point in values.items()
            )
        ):
            raise HTTPException(
                422,
                "Custom forecasts must use current player IDs, available gameweeks and finite points between -5 and 60.",
            )
    apply_layer(
        request.custom_points,
        request.blend_weight,
        request.custom_name or "Imported CSV",
    )
    return payload


class ChipUsage(BaseModel):
    chip: Literal["wildcard", "freehit", "benchboost", "triplecaptain"]
    gw: int = Field(ge=1, le=38)


class SolveRequest(ForecastRequest):
    squad: list[int] = Field(default_factory=list, max_length=15)
    bank: float = Field(default=0, ge=0, le=200)
    budget: float = Field(default=100, ge=60, le=200)
    start_gw: int = Field(default=6, ge=1, le=38)
    horizon: int = Field(default=4, ge=1, le=14)
    free_transfers: int = Field(default=1, ge=0, le=5)
    max_transfers: int = Field(default=2, ge=0, le=15)
    decay: float = Field(default=0.9, ge=0.5, le=1)
    ft_value: float = Field(default=1.5, ge=0, le=3.9)
    bench_weight: float = Field(default=0.08, ge=0, le=1)
    risk: float = Field(default=0, ge=-0.5, le=0.5)
    locked: list[int] = Field(default_factory=list, max_length=15)
    excluded: list[int] = Field(default_factory=list, max_length=700)
    chips: dict[str, str] = Field(default_factory=dict)
    purchase_prices: dict[str, float] = Field(default_factory=dict)
    seconds: int = Field(default=15, ge=2, le=45)
    used_chips: list[ChipUsage] = Field(default_factory=list, max_length=8)


class Week(BaseModel):
    gw: int = Field(ge=1, le=38)
    squad: list[int] = Field(min_length=15, max_length=15)
    starters: list[int] = Field(min_length=11, max_length=11)
    bench: list[int] = Field(min_length=4, max_length=4)
    captain: int
    vice: int
    chip: Literal["none", "wildcard", "freehit", "benchboost", "triplecaptain"] = "none"


class SensitivityRequest(SolveRequest):
    squad: list[int] = Field(min_length=15, max_length=15)
    horizon: int = Field(default=3, ge=1, le=6)
    seconds: int = Field(default=4, ge=2, le=8)
    scenarios: int = Field(default=8, ge=3, le=20)
    variation: float = Field(default=0.25, ge=0, le=0.75)
    seed: int = Field(default=2026, ge=0, le=2147483647)
    name: str = Field(default="Forecast stress test", max_length=120)


class PlanRequest(ForecastRequest):
    base_squad: list[int] = Field(min_length=15, max_length=15)
    bank: float = Field(default=0, ge=0, le=200)
    free_transfers: int = Field(default=1, ge=0, le=5)
    purchase_prices: dict[str, float] = Field(default_factory=dict)
    weeks: list[Week] = Field(min_length=1, max_length=38)
    used_chips: list[ChipUsage] = Field(default_factory=list, max_length=8)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Open FPL", "version": "0.1.0"}


def forecast_response(payload):
    # The payload is already JSON-safe; avoid FastAPI's recursive conversion
    # over tens of thousands of full-season fixture/component dictionaries.
    return Response(
        json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")),
        media_type="application/json",
    )


@app.get("/api/bootstrap")
def bootstrap():
    try:
        return forecast_response(forecast_for(ForecastRequest()))
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


@app.post("/api/projections")
def custom_projections(request: ForecastRequest):
    return forecast_response(forecast_for(request))


@app.post("/api/refresh")
def refresh():
    get_data(force=True)
    return forecast_response(forecast_for(ForecastRequest()))


@app.get("/api/players/{player_id}")
def detail(player_id: int, gw: int | None = None):
    payload = forecast_for(ForecastRequest())
    player = next((p for p in payload["players"] if p["id"] == player_id), None)
    if player is None:
        raise HTTPException(404, "Player not found.")
    return {
        "player": player,
        "history": player_history(player_id),
        "simulation": simulate_player(player, gw or payload["next_gw"]),
    }


@app.post("/api/optimise")
def solve(request: SolveRequest):
    payload = forecast_for(request)
    if (
        request.start_gw not in payload["gameweeks"]
        or request.start_gw + request.horizon - 1 > payload["gameweeks"][-1]
    ):
        raise HTTPException(
            422, "The requested horizon exceeds the available forecast window."
        )
    args = request.model_dump(exclude=set(ForecastRequest.model_fields))
    try:
        return optimise(payload["players"], **args)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/lineup")
def lineup(request: SolveRequest):
    payload = forecast_for(request)
    errors = validate_squad(request.squad, payload["players"])
    if errors:
        raise HTTPException(422, " ".join(errors))
    return best_lineup(
        request.squad,
        payload["players"],
        request.start_gw,
        request.chips.get(str(request.start_gw), "none"),
    )


@app.post("/api/sensitivity")
def start_sensitivity(request: SensitivityRequest):
    payload = forecast_for(request)
    if (
        request.start_gw not in payload["gameweeks"]
        or request.start_gw + request.horizon - 1 > payload["gameweeks"][-1]
    ):
        raise HTTPException(
            422, "The requested horizon exceeds the available forecast window."
        )
    extra_fields = set(ForecastRequest.model_fields) | {
        "scenarios",
        "variation",
        "seed",
        "name",
    }
    args = request.model_dump(exclude=extra_fields)
    try:
        return sensitivity_jobs.start(
            payload,
            args,
            request.scenarios,
            request.variation,
            request.seed,
            request.name,
        )
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.get("/api/sensitivity/{job_id}")
def get_sensitivity(job_id: str):
    try:
        return sensitivity_jobs.get(job_id)
    except KeyError as exc:
        raise HTTPException(
            404,
            "This stress test is no longer on the server. It may have restarted; start a new test.",
        ) from exc


@app.post("/api/sensitivity/{job_id}/cancel")
def cancel_sensitivity(job_id: str):
    try:
        return sensitivity_jobs.cancel(job_id)
    except KeyError as exc:
        raise HTTPException(
            404, "This stress test is no longer on the server."
        ) from exc


@app.post("/api/plan/validate")
def validate_plan(request: PlanRequest):
    payload = forecast_for(request)
    players = payload["players"]
    lookup = {p["id"]: p for p in players}
    errors = validate_squad(request.base_squad, players)
    if errors:
        raise HTTPException(422, " ".join(errors))
    squad = request.base_squad[:]
    bank = round(request.bank * 10)
    ft = request.free_transfers
    purchases = {
        i: round(request.purchase_prices.get(str(i), lookup[i]["price"]) * 10)
        for i in squad
    }
    used = {(c.chip, 1 if c.gw <= 19 else 2) for c in request.used_chips}
    output = []
    previous_gw = None
    for week in sorted(request.weeks, key=lambda w: w.gw):
        if previous_gw is not None and week.gw != previous_gw + 1:
            raise HTTPException(422, "Planning weeks must be consecutive and distinct.")
        previous_gw = week.gw
        if week.gw not in payload["gameweeks"]:
            raise HTTPException(
                422, "A planned gameweek is outside the forecast window."
            )
        errors = validate_squad(
            week.squad,
            players,
            starters=week.starters,
            captain=week.captain,
            vice=week.vice,
        )
        if (
            set(week.bench) != set(week.squad) - set(week.starters)
            or len(set(week.bench)) != 4
        ):
            errors.append("Bench must contain the four remaining squad players.")
        elif lookup[week.bench[0]]["position_id"] != 1:
            errors.append("The reserve goalkeeper must occupy the first bench slot.")
        if week.chip != "none":
            # FPL grants chips in each half; allow one of each per half.
            key = (week.chip, 1 if week.gw <= 19 else 2)
            if key in used:
                errors.append(
                    "The same chip cannot be used twice in one half of the season."
                )
            used.add(key)
        ins = [i for i in week.squad if i not in squad]
        outs = [i for i in squad if i not in week.squad]
        if len(ins) != len(outs):
            errors.append("Transfers in and out must balance.")
        nextbank = (
            bank
            + sum(
                round(
                    sale_price(
                        lookup[i]["price"],
                        purchases.get(i, round(lookup[i]["price"] * 10)) / 10,
                    )
                    * 10
                )
                for i in outs
            )
            - sum(round(lookup[i]["price"] * 10) for i in ins)
        )
        if nextbank < 0:
            errors.append(
                f"Transfers exceed the available bank by £{-nextbank / 10:.1f}m."
            )
        if errors:
            raise HTTPException(422, {"gw": week.gw, "errors": errors})
        free = week.chip in ("wildcard", "freehit")
        hit = max(0, len(ins) - ft) * 4 if not free else 0
        nextft = min(5, ft + 1 if free else max(0, ft - len(ins)) + 1)
        score = team_points(
            week.starters,
            week.bench,
            week.captain,
            week.vice,
            lookup,
            week.gw,
            week.chip,
        )
        output.append(
            {
                **week.model_dump(),
                "bank": nextbank / 10,
                "free_transfers": ft,
                "next_free_transfers": nextft,
                "hits": hit,
                "transfers_in": ins,
                "transfers_out": outs,
                **score,
                "net_points": score["points"] - hit,
            }
        )
        if week.chip != "freehit":
            for i in outs:
                purchases.pop(i, None)
            for i in ins:
                purchases[i] = round(lookup[i]["price"] * 10)
            squad = week.squad[:]
            bank = nextbank
        ft = nextft
    return {
        "valid": True,
        "weeks": output,
        "assumptions": [
            "Current prices are held fixed for future planning.",
            "Public squad imports reconstruct purchase prices when available; otherwise current price is used and disclosed.",
            "Expected autosubs respect bench order and formation; vice fallback is included. Player and fixture appearance events are assumed independent, and these probabilities are uncalibrated.",
        ],
    }


@app.get("/api/teams/{entry_id}")
def import_team(entry_id: int):
    if not 1 <= entry_id <= 100000000:
        raise HTTPException(422, "Enter a valid numeric FPL team ID.")
    d = get_data()
    try:
        entry = json.loads(fetch(f"{FPL}/entry/{entry_id}/", f"entry_{entry_id}", 300))
        gw = int(entry.get("current_event") or d["next_gw"] - 1)
        picks = json.loads(
            fetch(
                f"{FPL}/entry/{entry_id}/event/{gw}/picks/",
                f"picks_{entry_id}_{gw}",
                300,
            )
        )
        if not picks.get("picks"):
            raise ValueError("No public squad is available for this entry.")
        transfers_raw = fetch(
            f"{FPL}/entry/{entry_id}/transfers/",
            f"transfers_{entry_id}",
            300,
            optional=True,
        )
        transfers = json.loads(transfers_raw) if transfers_raw else []
        entry_history_raw = fetch(
            f"{FPL}/entry/{entry_id}/history/",
            f"entry_history_{entry_id}",
            300,
            optional=True,
        )
        entry_season_history = (
            json.loads(entry_history_raw) if entry_history_raw else {}
        )
        restored_freehit = picks.get("active_chip") == "freehit"
        if restored_freehit:
            picks = json.loads(
                fetch(
                    f"{FPL}/entry/{entry_id}/event/{gw - 1}/picks/",
                    f"picks_{entry_id}_{gw - 1}",
                    300,
                )
            )
            if not picks.get("picks"):
                raise ValueError("Permanent pre-Free-Hit squad is unavailable.")
    except Exception as exc:
        raise HTTPException(
            404,
            "Could not import the public FPL team. Check its ID and whether it has played a gameweek.",
        ) from exc
    rows = sorted(picks["picks"], key=lambda p: p["position"])
    squad = [p["element"] for p in rows]
    unknown = [i for i in squad if i not in d["players"]]
    if unknown:
        raise HTTPException(
            422, "This entry contains player IDs absent from the current official feed."
        )
    purchase = {}
    estimated = []
    chips_used = entry_season_history.get("chips", [])
    temporary_events = {c["event"] for c in chips_used if c.get("name") == "freehit"}
    if restored_freehit:
        temporary_events.add(gw)
    for i in squad:
        transaction = next(
            (
                t
                for t in sorted(
                    transfers, key=lambda t: t.get("time", ""), reverse=True
                )
                if t["element_in"] == i and t.get("event") not in temporary_events
            ),
            None,
        )
        if transaction:
            purchase[str(i)] = transaction["element_in_cost"] / 10
        else:
            hist = [r for r in player_history(i) if r["season"] == d["season"]]
            purchase[str(i)] = (
                hist[0]["price"] if hist else d["players"][i]["now_cost"] / 10
            )
            estimated.append(i)
    history = picks.get("entry_history", {})
    # Reconstruct saved transfers from public events. FH/WC preserve saved FTs.
    ft = 1
    event_transfers = {
        event: sum(1 for t in transfers if t.get("event") == event)
        for event in range(2, gw + 1)
    }
    for event in range(2, gw + 1):
        chip = next(
            (c.get("name") for c in chips_used if c.get("event") == event), None
        )
        ft = (
            min(5, ft + 1)
            if chip in ("wildcard", "freehit")
            else min(5, max(0, ft - event_transfers[event]) + 1)
        )
    return {
        "entry_id": entry_id,
        "name": entry.get("name", "FPL team"),
        "manager": f"{entry.get('player_first_name', '')} {entry.get('player_last_name', '')}",
        "overall_rank": entry.get("summary_overall_rank"),
        "total_points": entry.get("summary_overall_points"),
        "squad": squad,
        "starters": squad[:11],
        "bench": squad[11:],
        "captain": next(p["element"] for p in rows if p["is_captain"]),
        "vice": next(p["element"] for p in rows if p["is_vice_captain"]),
        "bank": history.get("bank", 0) / 10,
        "free_transfers": ft,
        "purchase_prices": purchase,
        "gw": gw,
        "used_chips": [
            {
                "chip": {"bboost": "benchboost", "3xc": "triplecaptain"}.get(
                    c["name"], c["name"]
                ),
                "gw": c["event"],
            }
            for c in chips_used
            if c.get("name") in ("wildcard", "freehit", "bboost", "3xc")
        ],
        "warnings": [
            "Latest public gameweek squad imported; unpublished transfers are unavailable.",
            "Starting purchase prices for original players are estimates from the first available historical price.",
            "Saved transfers are reconstructed from public transfers; verify the displayed value against your FPL account.",
        ]
        + (
            [
                "Latest gameweek used Free Hit; the preceding permanent squad and bank have been restored."
            ]
            if restored_freehit
            else []
        ),
    }


@app.get("/api/evaluation")
def evaluation():
    path = ROOT / "data" / "evaluation.json"
    if not path.exists():
        return {
            "available": False,
            "message": "Historical evaluation has not finished. Run python -m backend.evaluate.",
        }
    return {"available": True, **json.loads(path.read_text(encoding="utf-8"))}


@app.get("/api/prospective")
def prospective_report():
    path = ROOT / "data" / "prospective.json"
    return (
        json.loads(path.read_text(encoding="utf-8"))
        if path.exists()
        else {
            "gameweeks": [],
            "method": "No completed prospective scores yet. Capture before deadlines, then run the scoring command.",
        }
    )


@app.post("/api/prospective/score")
def score_completed_gameweeks():
    from .prospective import score

    return score()


@app.get("/api/export/projections.csv")
def export_projections():
    payload = forecast_for(ForecastRequest())
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "player_id",
            "name",
            "team",
            "position",
            "price",
            "ownership",
            "gameweek",
            "expected_points",
            "expected_minutes",
            "xg",
            "xa",
            "source",
            "model_version",
            "generated_at",
        ]
    )
    for p in payload["players"]:
        for gw, v in p["gw"].items():
            writer.writerow(
                [
                    p["id"],
                    p["name"],
                    p["team_short"],
                    p["position"],
                    p["price"],
                    p["ownership"],
                    gw,
                    round(v["points"], 4),
                    round(v["xmins"], 2),
                    round(sum(f["xg"] for f in v["fixtures"]), 4),
                    round(sum(f["xa"] for f in v["fixtures"]), 4),
                    "; ".join(sorted({f["source"] for f in v["fixtures"]})),
                    payload["model_version"],
                    payload["loaded_at"],
                ]
            )
    return Response(
        "\ufeff" + buf.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=open-fpl-projections.csv"
        },
    )


@app.post("/api/snapshot")
def save_snapshot(request: ForecastRequest):
    payload = forecast_for(request)
    event = next(e for e in payload["events"] if e["id"] == payload["next_gw"])
    deadline = datetime.fromisoformat(event["deadline_time"].replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    if now >= deadline:
        raise HTTPException(
            422,
            "The upcoming deadline has passed; a pre-deadline snapshot cannot be recorded.",
        )
    path = (
        ROOT
        / "data"
        / "snapshots"
        / f"{payload['season']}_gw{payload['next_gw']}_{now.strftime('%Y%m%dT%H%M%S%fZ')}.json"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    base = {
        p["id"]: p
        for p in projections(
            request.overrides, request.use_market, request.validated_schedule()
        )["players"]
    }
    vendor = get_data().get("fplform", {}).get("players", {})
    snapshot = {
        "recorded_at": now.isoformat(),
        "deadline": event["deadline_time"],
        "model_version": payload["model_version"],
        "configuration": request.model_dump(),
        "sources": payload["sources"],
        "players": [
            {
                "id": p["id"],
                "code": p["code"],
                "forecast": p["gw"][str(payload["next_gw"])],
            }
            for p in payload["players"]
        ],
    }
    for row in snapshot["players"]:
        row["models"] = {
            "Live ensemble": row["forecast"]["points"],
            "Component model": base[row["id"]]["gw"][str(payload["next_gw"])]["points"],
        }
        source = vendor.get(str(row["id"]), {}).get("points", {})
        if str(payload["next_gw"]) in source:
            row["models"]["FPL Form"] = source[str(payload["next_gw"])]
    with path.open("x", encoding="utf-8") as file:
        json.dump(snapshot, file, ensure_ascii=False, allow_nan=False)
    return {
        "saved": True,
        "filename": path.name,
        "recorded_at": now.isoformat(),
        "deadline": event["deadline_time"],
        "players": len(payload["players"]),
    }


if (ROOT / "dist").exists():
    app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="web")

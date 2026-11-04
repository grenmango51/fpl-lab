"""Configurable live acquisition, shared by the API and a persistent timer."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import threading
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, StrictBool, StrictInt, Field

from .data import ROOT, get_data
from .capture import source_time
from .solio import archive_observation, summary

router = APIRouter()
_lock = threading.Lock()
_state_lock = threading.RLock()


@contextmanager
def process_lock():
    """Serialise API and systemd refreshes, including on Windows."""
    path = ROOT / "data" / "cache" / "auto-refresh.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        if os.name == "nt":
            import msvcrt
            if not path.stat().st_size:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


class RefreshConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: StrictBool = True
    interval_minutes: StrictInt = Field(default=30, ge=5, le=1440)


def read(name, default):
    try:
        return json.loads((ROOT / "data" / "cache" / name).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write(name, value):
    path = ROOT / "data" / "cache" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2), encoding="utf-8")
    os.replace(temp, path)


def configuration():
    return RefreshConfiguration.model_validate(read("auto-refresh.json", {}))


@router.get("/api/data-refresh")
def status():
    with _state_lock:
        config = configuration()
        state = read("auto-refresh-status.json", {})
        last = source_time(state.get("last_attempt_at"))
        next_at = last + timedelta(minutes=config.interval_minutes) if last and config.enabled else None
        return {**config.model_dump(), **state, "next_refresh_at": next_at.isoformat() if next_at else None,
                "running": _lock.locked()}


@router.post("/api/data-refresh")
def configure(config: RefreshConfiguration):
    with _state_lock:
        write("auto-refresh.json", config.model_dump())
        return status()


def archive_forecasts():
    """Freeze both independent and window-anchored full-season forecasts."""
    from .app import ForecastRequest, save_snapshot
    return [save_snapshot(ForecastRequest(use_solio=enabled), refresh_inputs=False)["filename"]
            for enabled in (False, True)]


def refresh_once(*, only_if_due=False):
    # API and in-process worker cannot refresh simultaneously. The systemd
    # service is the sole runner when the planner API is not running.
    with _lock, process_lock():
        # Another process may have completed a scheduled refresh while this
        # caller waited for the lock. Recheck the persisted schedule inside it.
        if only_if_due:
            config = configuration()
            last = source_time(read("auto-refresh-status.json", {}).get("last_attempt_at"))
            if not config.enabled or (last and datetime.now(timezone.utc) - last < timedelta(minutes=config.interval_minutes)):
                return None
        started = datetime.now(timezone.utc).isoformat()
        with _state_lock:
            write("auto-refresh-status.json", {**read("auto-refresh-status.json", {}), "last_attempt_at": started})
        try:
            dataset = get_data(refresh_live=True)
            filename = archive_observation(dataset, ROOT)
            forecasts = archive_forecasts()
            try:
                from .solio_validation import score_pending
                validation_results = score_pending(ROOT)
            except Exception as exc:
                # A frozen research campaign can correctly reject a changed
                # deadline/identity. That must not invalidate fresh live inputs
                # or rewrite the campaign to make it score. Keep the failure
                # explicit, without exposing exception/request details.
                validation_results = [{"status": "failed", "error": type(exc).__name__}]
            core = (dataset["sources"].get(key, {}).get("status") for key in ("fpl_bootstrap", "fpl_fixtures"))
            state = {
                "last_attempt_at": started, "last_success_at": datetime.now(timezone.utc).isoformat(),
                "loaded_at": dataset["loaded_at"], "next_gw": dataset["next_gw"],
                "solio": summary(dataset.get("solio", {})), "solio_capture": filename,
                "forecast_captures": forecasts,
                "validation_results": validation_results,
                "last_error": None, "core_fresh": all(s in ("live", "cached") for s in core),
            }
            with _state_lock:
                write("auto-refresh-status.json", state)
            return dataset
        except Exception as exc:
            with _state_lock:
                state = read("auto-refresh-status.json", {})
                # Exception messages can contain request details; publish only
                # the type. Previous successful data and receipts stay intact.
                write("auto-refresh-status.json", {**state, "last_attempt_at": started, "last_error": type(exc).__name__})
            raise


def due(now=None):
    state = status()
    if not state["enabled"] or state["running"]:
        return False
    last = source_time(state.get("last_attempt_at"))
    return last is None or (now or datetime.now(timezone.utc)) - last >= timedelta(minutes=state["interval_minutes"])


def tick():
    if due():
        refresh_once(only_if_due=True)
    return status()


async def loop():
    while True:
        # Initial bootstrap is handled by the first request. Keep the worker
        # off the critical startup path and check changed settings each minute.
        await asyncio.sleep(60)
        try:
            await asyncio.to_thread(tick)
        except Exception:
            pass  # Failure is recorded by refresh_once; retry at configured cadence.


@asynccontextmanager
async def lifespan(_app):
    worker = asyncio.create_task(loop())
    try:
        yield
    finally:
        worker.cancel()
        try:
            await worker
        except asyncio.CancelledError:
            pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--tick", action="store_true")
    parser.add_argument("--interval", type=int)
    parser.add_argument("--disable", action="store_true")
    args = parser.parse_args()
    if args.interval is not None or args.disable:
        config = configuration().model_dump()
        if args.interval is not None:
            config["interval_minutes"] = args.interval
        config["enabled"] = not args.disable
        configure(RefreshConfiguration.model_validate(config))
    print(json.dumps(tick() if args.tick else status(), ensure_ascii=False))

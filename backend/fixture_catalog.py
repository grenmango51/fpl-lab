"""Read-only official fixture catalog, independent of adjusted forecast membership.

The application owner mounts ``router`` before the static application mount.
This module uses the existing dataset accessor without refresh flags; it never
edits fixtures, fetches providers directly, or writes cache envelopes.
"""

from copy import deepcopy

from fastapi import APIRouter, HTTPException

from .data import get_data

router = APIRouter()


def build_fixture_catalog(dataset):
    next_gw = dataset["next_gw"]
    if type(next_gw) is not int or not 1 <= next_gw <= 38:
        raise ValueError("Invalid next gameweek")
    events = dataset["bootstrap"]["events"]
    gameweeks = sorted({
        event["id"] for event in events
        if type(event.get("id")) is int and next_gw <= event["id"] <= 38
        and not event.get("finished")
    })
    fixtures = []
    seen = set()
    for row in dataset["fixtures"]:
        # Old unplayed rows are not editable remaining-GW fixtures. Explicitly
        # unscheduled fixtures remain available, regardless of kickoff date.
        if row.get("finished") or row.get("finished_provisional"):
            continue
        event = row.get("event")
        if event is not None and (type(event) is not int or not 1 <= event <= 38):
            raise ValueError("Invalid official fixture gameweek")
        if event is not None and event not in gameweeks:
            continue
        if any(type(row.get(field)) is not int or row[field] <= 0 for field in ("id", "team_h", "team_a")):
            raise ValueError("Missing official fixture identity")
        if row["id"] in seen or row["team_h"] == row["team_a"]:
            raise ValueError("Conflicting official fixture identity")
        seen.add(row["id"])
        fixtures.append({field: row.get(field) for field in ("id", "event", "kickoff_time", "team_h", "team_a")})
    return {
        "next_gw": next_gw,
        "gameweeks": gameweeks,
        "season": dataset["season"],
        "fixtures": fixtures,
        "sources": deepcopy({key: value for key, value in dataset.get("sources", {}).items()
                             if key in {"fpl_bootstrap", "fpl_fixtures"}}),
    }


@router.get("/api/fixture-schedule")
def fixture_schedule():
    try:
        return build_fixture_catalog(get_data())
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=503, detail="Official fixture schedule is unavailable.") from None

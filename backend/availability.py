"""Date-aware planning assumptions from the *captured* official FPL news.

Unknown injury recovery is a declared uncertainty decay, not a medical model.
Unregistered/unavailable players are never automatically restored.
"""

from datetime import datetime
import re

UNKNOWN_INJURY_HALF_LIFE_DAYS = 28


def parsed_time(value):
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return date if date.tzinfo is not None else None
    except (AttributeError, TypeError, ValueError):
        return None


def next_availability(player):
    chance = player.get("chance_of_playing_next_round")
    return chance / 100 if chance is not None else (
        0 if player["status"] in ("u", "i", "s", "n") else 1
    )


def return_date(news, origin):
    match = re.search(r"(?:Expected back|Suspended until)\s+(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(20\d{2}))?", news or "", re.I)
    if not match or origin is None:
        return None
    try:
        month = datetime.strptime(match[2][:3].title(), "%b").month
        year = int(match[3]) if match[3] else origin.year
        date = origin.replace(year=year, month=month, day=int(match[1]),
                              hour=0, minute=0, second=0, microsecond=0)
        # October news about a January return crosses the calendar year. A
        # recently elapsed date remains elapsed, rather than moving a year out.
        if not match[3] and (origin - date).days > 180:
            date = date.replace(year=year + 1)
        return date
    except ValueError:
        return None


def fixture_availability(player, kickoff, origin, *, next_week=False):
    current = next_availability(player)
    target = parsed_time(kickoff)
    result = {"value": current, "source": "official next-round availability"}
    if target is None or origin is None or player["status"] in ("u", "n"):
        return result
    recovery = return_date(player.get("news"), origin)
    if recovery is not None and player["status"] in ("i", "s", "d"):
        value = (current if next_week else 0) if target < recovery else 1
        return {"value": value, "source": "official news return-date assumption",
                "return_date": recovery.date().isoformat(), "news": player.get("news", "")}
    if next_week or current == 1 or player["status"] not in ("i", "d"):
        return result
    days = max(0, (target - origin).total_seconds() / 86400)
    return {"value": 1 - (1 - current) * 2 ** (-days / UNKNOWN_INJURY_HALF_LIFE_DAYS),
            "source": "unknown-return planning decay", "lead_days": days,
            "half_life_days": UNKNOWN_INJURY_HALF_LIFE_DAYS}


def absence_censored_rows(rows, player):
    """Only trailing DNPs of a currently flagged player are censored. Available
    substitutes' DNPs remain selection evidence. Older injury labels are unknown.
    """
    eligible = list(rows)
    if next_availability(player) < 1 and player["status"] in ("i", "s", "d"):
        while eligible and eligible[-1]["minutes"] == 0:
            eligible.pop()
    return eligible


def selection_rows(rows, season, player):
    """Separate a current absence spell from selection conditional on return."""
    eligible = absence_censored_rows(rows, player)
    current = [r for r in eligible if r["season"] == season]
    return current if len(current) >= 3 else eligible

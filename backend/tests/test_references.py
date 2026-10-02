import copy
import csv
import io

import httpx
import pytest

from backend import data as data_module
from backend.references import CONDITIONING, FEEDS, build_reference, parse_reference


def write_csv(headers, rows):
    file = io.StringIO()
    writer = csv.writer(file)
    writer.writerow(headers)
    writer.writerows(rows)
    return file.getvalue()


def badge(code):
    return (
        f"![](https://resources.premierleague.com/premierleague/badges/70/t{code}.png)"
    )


@pytest.fixture
def pool():
    teams = {
        i: {"id": i, "short_name": name, "code": code}
        for i, name, code in [
            (1, "ARS", 3),
            (2, "CHE", 8),
            (3, "BHA", 36),
            (4, "COV", 9),
            (5, "MCI", 43),
        ]
    }
    players = {}
    for pid, first, second, web, team, pos in [
        (411, "Erling", "Haaland", "Haaland", 5, 4),
        (1, "David", "Raya Martin", "Raya", 1, 1),
        (165, "João Pedro", "Junqueira de Jesus", "João Pedro", 2, 4),
        (121, "Mitoma", "Kaoru", "Mitoma", 3, 3),
        (173, "Bobby", "Thomas", "Thomas", 4, 2),
        (194, "Brandon", "Thomas-Asante", "Thomas-Asante", 4, 4),
        (91, "Ethan", "Pinnock", "Pinnock", 4, 2),
    ]:
        players[pid] = {
            "id": pid,
            "first_name": first,
            "second_name": second,
            "web_name": web,
            "team": team,
            "element_type": pos,
        }
    return players, teams


def baseline_rows():
    return [
        ["E. Haaland", badge(43), 0.7, 0.16, 0.89],
        ["J. Pedro", badge(8), 0.42, 0.19, 0.64],
        ["K. Mitoma", badge(36), 0.3, 0.2, 0.53],
        ["B. Thomas", badge(9), 0.22, 0.09, 0.42],
    ]


def baseline_csv(rows=None):
    return write_csv(
        ["Player", "", "Goal Baseline", "Assist Baseline", "Goal Involvement Baseline"],
        baseline_rows() if rows is None else rows,
    )


def fantasy_rows():
    return [
        ["Raya", "ARS", badge(3), "GK", 69, ""],
        ["Haaland", "MCI", badge(43), "FWD", 100, "⭐"],
        ["João Pedro", "CHE", badge(8), "FWD", 90, ""],
        ["Mitoma", "BHA", badge(36), "MID", 75, ""],
        ["Thomas", "COV", "FALSE", "DEF", 59, ""],
        ["Pinnock", "COV", "FALSE", "DEF", 55, ""],
    ]


def fantasy_csv(rows=None, header="GW6 Captaincy Option?"):
    return write_csv(
        ["Player", "Team", "", "Position", "Future Importance", header],
        fantasy_rows() if rows is None else rows,
    )


def provenance(status="live"):
    return {
        config["source_key"]: {
            "status": status,
            "fetched_at": "2026-10-02T18:38:25+00:00",
            "sha256": "test-source-hash",
            "last_modified": "Fri, 02 Oct 2026 18:01:10 GMT",
        }
        for config in FEEDS.values()
    }


def test_baseline_matches_aliases_and_preserves_unknown_duration(pool):
    players, teams = pool
    before = copy.deepcopy(pool)
    result = parse_reference("\ufeff" + baseline_csv(), "baselines", players, teams)
    assert result["error"] is None
    assert result["matched_players"] == 4
    assert result["players"]["165"]["matches"][0]["method"] == "documented_alias"
    assert result["players"]["121"]["matches"][0]["team"] == "BHA"
    baseline = result["players"]["411"]["attacking_baseline"]
    assert baseline["conditioning"] == CONDITIONING
    assert baseline["duration_minutes"] is None and baseline["gameweek"] is None
    assert baseline["goal_involvement"] == 0.89
    assert "points" not in result["players"]["411"]
    assert pool == before


def test_alias_does_not_establish_identity_from_id_alone(pool):
    players, teams = pool
    players[165]["team"] = 5
    result = parse_reference(baseline_csv(), "baselines", players, teams)
    assert result["players"] == {}
    assert "80%" in result["error"]
    assert result["diagnostics"]["unmatched"][0]["provider_name"] == "J. Pedro"


def test_typo_is_diagnosed_instead_of_fuzzy_matched(pool):
    players, teams = pool
    rows = baseline_rows()
    rows[0][0] = "E. Haalend"
    result = parse_reference(baseline_csv(rows), "baselines", players, teams)
    assert not result["players"]
    assert result["diagnostics"]["unmatched"][0]["candidate_ids"] == []


def test_ambiguous_same_club_name_is_rejected(pool):
    players, teams = pool
    players[700] = {**players[411], "id": 700, "first_name": "Eirik"}
    result = parse_reference(baseline_csv(), "baselines", players, teams)
    ambiguous = result["diagnostics"]["ambiguous"]
    assert len(ambiguous) == 1
    assert set(ambiguous[0]["candidate_ids"]) == {411, 700}
    assert "411" not in result["players"] and "700" not in result["players"]


def test_captaincy_uses_numbered_header_and_coventry_team_fallback(pool):
    players, teams = pool
    players[700] = {**players[173], "id": 700, "element_type": 4}
    result = parse_reference(
        fantasy_csv(header="GW12 Captaincy Option?"), "fast_fantasy", players, teams
    )
    assert result["error"] is None and result["matched_players"] == 6
    assert result["captain_gameweek"] == 12
    assert result["players"]["411"]["captain"] is True
    assert result["players"]["411"]["future_importance"] == 100
    assert result["players"]["173"]["matches"][0]["club_basis"] == "team"
    assert result["players"]["173"]["matches"][0]["position"] == 2
    assert result["players"]["91"]["captain"] is False


def test_club_badge_disagreement_rejects_row_without_guessing(pool):
    players, teams = pool
    rows = fantasy_rows()
    rows[1][2] = badge(3)
    result = parse_reference(fantasy_csv(rows), "fast_fantasy", players, teams)
    assert result["error"] is None
    assert "411" not in result["players"] and result["matched_players"] == 5
    assert (
        result["diagnostics"]["unmatched"][0]["reason"]
        == "Badge and club label disagree."
    )


@pytest.mark.parametrize(
    "header",
    [
        "GW0 Captaincy Option?",
        "GW39 Captaincy Option?",
        "Next GW Captaincy",
        "Captaincy",
    ],
)
def test_unknown_or_impossible_captaincy_header_disables_feed(pool, header):
    players, teams = pool
    result = parse_reference(fantasy_csv(header=header), "fast_fantasy", players, teams)
    assert result["error"] and not result["players"]


@pytest.mark.parametrize("value", ["nan", "inf", "-0.1", "5.1", "not-a-number"])
def test_invalid_baseline_disables_entire_feed(pool, value):
    players, teams = pool
    rows = baseline_rows()
    rows[-1][2] = value
    result = parse_reference(baseline_csv(rows), "baselines", players, teams)
    assert result["error"] and result["players"] == {}


@pytest.mark.parametrize("value", ["nan", "101", "-1"])
def test_invalid_importance_is_not_treated_as_points(pool, value):
    players, teams = pool
    rows = fantasy_rows()
    rows[1][4] = value
    result = parse_reference(fantasy_csv(rows), "fast_fantasy", players, teams)
    assert result["error"] and not result["players"]


def test_duplicate_current_id_disables_feed(pool):
    players, teams = pool
    rows = baseline_rows()
    rows.append(rows[0])
    result = parse_reference(baseline_csv(rows), "baselines", players, teams)
    assert not result["players"]
    assert result["diagnostics"]["duplicates"][0]["player_id"] == 411


def test_unexpected_schema_disables_only_affected_feed(pool):
    players, teams = pool
    result = build_reference(
        {"baselines": "<html>Sign in</html>", "fast_fantasy": fantasy_csv()},
        provenance(),
        players,
        teams,
        season="2026-27",
        next_gw=6,
    )
    assert result["available"] and result["status"] == "partial"
    assert result["feeds"]["baselines"]["status"] == "invalid"
    assert result["feeds"]["fast_fantasy"]["available"]
    assert "attacking_baseline" not in result["players"]["411"]


def test_merge_retains_sources_and_warns_for_different_captain_gameweek(pool):
    players, teams = pool
    result = build_reference(
        {
            "baselines": baseline_csv(),
            "fast_fantasy": fantasy_csv(header="GW5 Captaincy Option?"),
        },
        provenance("stale"),
        players,
        teams,
        season="2026-27",
        next_gw=6,
    )
    assert result["status"] == "stale"
    assert len(result["players"]["411"]["matches"]) == 2
    assert result["feeds"]["fast_fantasy"]["captain_gameweek_matches_next"] is False
    assert result["feeds"]["fast_fantasy"]["source_at"] == "2026-10-02T18:38:25+00:00"
    assert result["coverage"] == {
        "official_players": 7,
        "matched_players": 6,
        "baseline_players": 4,
        "importance_players": 6,
    }
    assert result["players"]["411"]["attacking_baseline"]["duration_minutes"] is None


def test_optional_sources_unavailable_do_not_break_data_loading(pool, monkeypatch):
    players, teams = pool
    statuses = {}
    calls = []

    def unavailable(url, key, ttl, *, optional):
        assert optional is True
        calls.append(url)
        statuses[key] = {
            "status": "unavailable",
            "fetched_at": None,
            "error": "HTTP 503",
        }
        return None

    monkeypatch.setattr(data_module, "_statuses", statuses)
    monkeypatch.setattr(data_module, "fetch", unavailable)
    result = data_module.load_elevenify_reference("2026-27", 6, players, teams)
    assert len(calls) == 2
    assert result["status"] == "unavailable" and result["available"] is False
    assert result["players"] == {}
    assert all(feed["error"] == "HTTP 503" for feed in result["feeds"].values())


def test_fetch_preserves_last_modified_and_explicit_stale_fallback(
    pool, tmp_path, monkeypatch
):
    players, teams = pool
    raw = baseline_csv()
    calls = []
    url, key = FEEDS["baselines"]["url"], FEEDS["baselines"]["source_key"]

    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def get(self, requested):
            calls.append(requested)
            return httpx.Response(
                200 if len(calls) == 1 else 503,
                text=raw if len(calls) == 1 else "Unavailable",
                headers={
                    "Last-Modified": "Fri, 02 Oct 2026 11:01:15 GMT",
                    "Content-Type": "text/csv",
                },
                request=httpx.Request("GET", requested),
            )

    monkeypatch.setattr(data_module, "ROOT", tmp_path)
    monkeypatch.setattr(data_module, "CACHE", tmp_path / "cache")
    monkeypatch.setattr(data_module, "_statuses", {})
    monkeypatch.setattr(data_module.httpx, "Client", Client)
    assert data_module.fetch(url, key, -1, optional=True) == raw
    old_hash = data_module._statuses[key]["sha256"]
    assert data_module.fetch(url, key, -1, optional=True) == raw
    source = data_module._statuses[key]
    assert source["status"] == "stale" and source["sha256"] == old_hash
    assert source["last_modified"] == "Fri, 02 Oct 2026 11:01:15 GMT"
    assert (tmp_path / source["raw_archive"]).exists()
    reference = build_reference(
        {"baselines": raw},
        data_module._statuses,
        players,
        teams,
        season="2026-27",
        next_gw=6,
    )
    assert reference["feeds"]["baselines"]["status"] == "stale"
    assert reference["feeds"]["baselines"]["available"]

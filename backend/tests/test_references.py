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


def next_attack_csv(rows=None, gw=6, leading=True):
    content = write_csv(
        ["Player", "", f"GW{gw} Goals", f"GW{gw} Assists", f"GW{gw} Involvement"],
        rows
        if rows is not None
        else [
            ["E. Haaland", badge(43), 0.58, 0.12, 0.70],
            ["J. Pedro", badge(8), 0.46, 0.21, 0.68],
            ["K. Mitoma", badge(36), 0.30, 0.20, 0.53],
            ["B. Thomas", badge(9), 0.25, 0.10, 0.36],
        ],
    )
    return (",,,,\n" if leading else "") + content


def three_gw_csv(rows=None, weeks=(6, 7, 8), leading=True):
    content = write_csv(
        ["Player", "", *map(str, weeks), "TOTAL"],
        rows
        if rows is not None
        else [
            ["E. Haaland", badge(43), 0.56, 0.96, 0.69, 2.21],
            ["J. Pedro", badge(8), 0.48, 0.38, 0.44, 1.30],
        ],
    )
    return ("," * (len(weeks) + 2) + "\n" if leading else "") + content


def alias_pool(pool):
    players, teams = pool
    teams[6] = {"id": 6, "short_name": "CRY", "code": 31}
    teams[7] = {"id": 7, "short_name": "TOT", "code": 6}
    players[211] = {
        "id": 211,
        "code": 488024,
        "first_name": "Yéremy",
        "second_name": "Pino Santos",
        "web_name": "Yeremy",
        "team": 6,
        "element_type": 3,
    }
    players[403] = {
        "id": 403,
        "code": 510281,
        "first_name": "Sávio",
        "second_name": "Moreira de Oliveira",
        "web_name": "Sávio",
        "team": 7,
        "element_type": 3,
    }
    return players, teams


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
    assert result["status"] == "partial"
    assert result["feeds"]["baselines"]["status"] == "stale"
    assert len(result["players"]["411"]["matches"]) == 2
    assert result["feeds"]["fast_fantasy"]["captain_gameweek_matches_next"] is False
    assert result["feeds"]["fast_fantasy"]["source_at"] == "2026-10-02T18:38:25+00:00"
    assert result["coverage"] == {
        "official_players": 7,
        "matched_players": 6,
        "baseline_players": 4,
        "importance_players": 6,
        "attacking_players": 0,
    }
    assert result["players"]["411"]["attacking_baseline"]["duration_minutes"] is None


def test_optional_sources_unavailable_do_not_break_data_loading(pool, monkeypatch):
    players, teams = pool
    statuses = {}
    calls = []

    def unavailable(url, key, ttl, *, optional, refresh=False):
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
    assert len(calls) == len(FEEDS)
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


def test_next_gameweek_counts_keep_conditioning_and_actual_row_numbers(pool):
    players, teams = pool
    result = parse_reference(next_attack_csv(), "next_gw_attack", players, teams)
    assert result["error"] is None and result["matched_players"] == 4
    assert result["players"]["411"]["matches"][0]["row"] == 3
    view = result["players"]["411"]["attacking_views"]["next_gw_attack"]
    assert (
        view["conditioning"] == "assumes_player_starts"
        and view["duration_minutes"] is None
    )
    assert view["gameweeks"] == {
        "6": {"goal": 0.58, "assist": 0.12, "goal_involvement": 0.7}
    }
    assert "points" not in view and "expected_points" not in view
    assert result["gameweeks"] == [6]


def test_all_series_merge_without_overwriting_overlapping_gameweek_values(pool):
    players, teams = pool
    raw = {
        "baselines": baseline_csv(),
        "fast_fantasy": fantasy_csv(),
        "next_gw_attack": next_attack_csv(),
        "three_gw_goals": three_gw_csv(),
        "three_gw_assists": three_gw_csv(),
    }
    before = copy.deepcopy(raw)
    result = build_reference(
        raw, provenance(), players, teams, season="2026-27", next_gw=6
    )
    assert result["status"] == "live" and len(result["feeds"]) == len(FEEDS)
    haaland = result["players"]["411"]
    assert len(haaland["attacking_views"]) == 3
    assert (
        haaland["attacking_views"]["next_gw_attack"]["gameweeks"]["6"]["goal"] == 0.58
    )
    assert (
        haaland["attacking_views"]["three_gw_goals"]["gameweeks"]["6"]["goal"] == 0.56
    )
    assert set(haaland["attacking_views"]["three_gw_assists"]["gameweeks"]["6"]) == {
        "assist"
    }
    assert len(haaland["matches"]) == len(FEEDS)
    assert result["coverage"]["attacking_players"] == 4
    assert (
        result["coverage"]["baseline_players"] == 4
        and result["coverage"]["importance_players"] == 6
    )
    assert result["feeds"]["three_gw_goals"]["gameweeks"] == [6, 7, 8]
    assert result["feeds"]["three_gw_goals"]["caption_current"] is True
    assert raw == before


def test_official_documented_fixture_view_aliases_match_with_stable_codes(pool):
    players, teams = alias_pool(pool)
    raw = next_attack_csv(
        rows=[
            ["Y. Pino", badge(31), 0.2, 0.2, 0.4],
            ["Savinho", badge(6), 0.2, 0.2, 0.4],
        ]
    )
    result = parse_reference(raw, "next_gw_attack", players, teams)
    assert result["error"] is None and set(result["players"]) == {"211", "403"}
    assert result["players"]["211"]["matches"][0]["official_code"] == 488024
    assert result["players"]["403"]["matches"][0]["method"] == "documented_alias"


@pytest.mark.parametrize(
    "field,value",
    [
        ("id", 777),
        ("code", 1),
        ("team", 1),
        ("element_type", 4),
        ("web_name", "Other Player"),
    ],
)
def test_fixture_alias_requires_current_id_code_club_position_and_name(
    pool, field, value
):
    players, teams = alias_pool(pool)
    players[211][field] = value
    raw = next_attack_csv(rows=[["Y. Pino", badge(31), 0.2, 0.2, 0.4]])
    result = parse_reference(raw, "next_gw_attack", players, teams)
    assert not result["players"]
    assert result["diagnostics"]["unmatched"][0]["provider_name"] == "Y. Pino"


@pytest.mark.parametrize(
    "weeks", [(0, 1, 2), (37, 38, 39), (6, 7, 8, 9), (6, 8), ("06", 7, 8)]
)
def test_impossible_or_overlong_attacking_window_is_rejected(pool, weeks):
    players, teams = pool
    row = ["E. Haaland", badge(43), *([0.3] * len(weeks)), round(0.3 * len(weeks), 2)]
    result = parse_reference(
        three_gw_csv(rows=[row], weeks=weeks), "three_gw_goals", players, teams
    )
    assert result["error"] and not result["players"]


def test_end_of_season_window_can_have_fewer_than_three_weeks(pool):
    players, teams = pool
    result = parse_reference(
        three_gw_csv(rows=[["E. Haaland", badge(43), 0.3, 0.3]], weeks=(38,)),
        "three_gw_goals",
        players,
        teams,
    )
    assert result["error"] is None and result["gameweeks"] == [38]


def test_old_caption_is_preserved_and_marked_stale_instead_of_relabelled(pool):
    players, teams = pool
    result = build_reference(
        {"next_gw_attack": next_attack_csv(gw=5)},
        provenance(),
        players,
        teams,
        season="2026-27",
        next_gw=6,
    )
    feed = result["feeds"]["next_gw_attack"]
    assert feed["status"] == "stale" and feed["source_status"] == "live"
    assert feed["caption_current"] is False and feed["window_status"] == "past"
    assert feed["gameweeks"] == [5]
    assert set(
        result["players"]["411"]["attacking_views"]["next_gw_attack"]["gameweeks"]
    ) == {"5"}


def test_mixed_next_gameweek_headers_are_not_silently_combined(pool):
    players, teams = pool
    raw = next_attack_csv().replace("GW6 Assists", "GW7 Assists")
    result = parse_reference(raw, "next_gw_attack", players, teams)
    assert result["error"] and not result["players"]


@pytest.mark.parametrize("value", ["nan", "inf", "-0.1", "5.1"])
def test_nonfinite_or_implausible_fixture_counts_disable_the_feed(pool, value):
    players, teams = pool
    result = parse_reference(
        next_attack_csv(rows=[["E. Haaland", badge(43), value, 0.2, 0.3]]),
        "next_gw_attack",
        players,
        teams,
    )
    assert result["error"] and not result["players"]


def test_expected_counts_above_one_are_not_misread_as_probabilities(pool):
    players, teams = pool
    result = parse_reference(
        next_attack_csv(rows=[["E. Haaland", badge(43), 1.2, 0.2, 1.4]]),
        "next_gw_attack",
        players,
        teams,
    )
    assert result["error"] is None


def test_three_week_total_is_validated_without_becoming_a_fourth_gameweek(pool):
    players, teams = pool
    raw = three_gw_csv(rows=[["E. Haaland", badge(43), 0.3, 0.3, 0.3, 1.5]])
    result = parse_reference(raw, "three_gw_goals", players, teams)
    assert result["error"] and not result["players"]
    valid = parse_reference(three_gw_csv(), "three_gw_goals", players, teams)
    assert (
        "TOTAL"
        not in valid["players"]["411"]["attacking_views"]["three_gw_goals"]["gameweeks"]
    )


def test_only_leading_empty_rows_are_skipped(pool):
    players, teams = pool
    content = next_attack_csv(leading=False)
    assert (
        parse_reference("\n,,,,\n" + content, "next_gw_attack", players, teams)["error"]
        is None
    )
    assert parse_reference(
        "unexpected title\n" + content, "next_gw_attack", players, teams
    )["error"]
    assert parse_reference(content + ",,,,\n", "next_gw_attack", players, teams)[
        "error"
    ]


def test_duplicate_conditional_view_ids_disable_feed(pool):
    players, teams = pool
    row = ["E. Haaland", badge(43), 0.3, 0.2, 0.5]
    result = parse_reference(
        next_attack_csv(rows=[row, row]), "next_gw_attack", players, teams
    )
    assert (
        not result["players"]
        and result["diagnostics"]["duplicates"][0]["player_id"] == 411
    )

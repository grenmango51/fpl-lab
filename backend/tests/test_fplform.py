"""Public FPL Form exports must retain their actual weeks and missing values."""

import csv
import io

import pytest

from backend import data


@pytest.fixture
def pool():
    teams = {1: {"short_name": "ARS"}, 2: {"short_name": "MCI"}}
    players = {
        pid: {"id": pid, "team": team, "element_type": pos, "now_cost": price}
        for pid, team, pos, price in [
            (1, 1, 1, 50),
            (2, 1, 2, 55),
            (3, 1, 3, 70),
            (4, 2, 4, 100),
            (5, 2, 3, 65),
        ]
    }
    return players, teams


def export_csv(pool, weeks=(6, 7, 8, 9, 10), *, edit=None, probabilities=True):
    players, teams = pool
    headers = ["ID", "Name", "Team", "Pos", "Price"]
    for gw in weeks:
        headers.append(f"{gw}_pts_no_prob")
        if probabilities:
            headers.append(f"{gw}_prob")
        headers.append(f"{gw}_with_prob")
    rows = []
    for pid, player in players.items():
        row = {
            "ID": str(pid),
            "Name": f"Player, {pid}",
            "Team": teams[player["team"]]["short_name"],
            "Pos": {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}[player["element_type"]],
            "Price": str(player["now_cost"] / 10),
        }
        for gw in weeks:
            # The conditional prediction intentionally differs from the
            # appearance-weighted points used by the app.
            row[f"{gw}_pts_no_prob"] = "10"
            row[f"{gw}_with_prob"] = str(gw / 2)
            if probabilities:
                row[f"{gw}_prob"] = "0.5"
        rows.append(row)
    if edit:
        edit(headers, rows)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=headers)
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


@pytest.fixture
def acquisition(monkeypatch):
    """No network: mimic the normal fetch provenance envelope and record calls."""
    responses = {"body": None, "status": "live"}
    calls = []
    monkeypatch.setattr(data, "_statuses", {})

    def fetch(url, key, ttl=3600, *, optional=False, form=None, refresh=False):
        calls.append(
            {
                "url": url,
                "key": key,
                "ttl": ttl,
                "optional": optional,
                "form": form,
                "refresh": refresh,
            }
        )
        data._statuses[key] = {
            "url": url,
            "fetched_at": "2026-10-03T12:00:00+00:00",
            "status": responses["status"],
            "sha256": "test-source-hash",
            "request_form": form,
        }
        return responses["body"]

    monkeypatch.setattr(data, "fetch", fetch)
    return responses, calls


def test_normal_public_request_supplies_five_direct_weeks(pool, acquisition):
    responses, calls = acquisition
    responses["body"] = "\ufeff" + export_csv(pool)

    result = data.load_fplform("2026-27", 6, *pool, refresh=True)

    assert calls == [
        {
            "url": "https://www.fplform.com/export-fpl-form-data.php",
            "key": "fplform_2026-27_gw6",
            "ttl": 3600,
            "optional": True,
            "form": {"firstgw": "6", "lastgw": "10", "all": "1", "submit": "submit"},
            "refresh": True,
        }
    ]
    assert (
        result["weeks"]
        == result["header_weeks"]
        == result["requested_weeks"]
        == [6, 7, 8, 9, 10]
    )
    assert result["missing_weeks"] == []
    assert result["matched_players"] == result["prediction_players"] == 5
    assert result["players"]["1"]["points"] == {
        "6": 3.0,
        "7": 3.5,
        "8": 4.0,
        "9": 4.5,
        "10": 5.0,
    }
    assert result["players"]["1"]["probabilities"]["6"] == 0.5
    assert result["source_at"] == "2026-10-03T12:00:00+00:00"
    assert data.source_metadata(calls[0]["key"])["sha256"] == "test-source-hash"


@pytest.mark.parametrize(
    "start,horizon,expected", [(37, 5, [37, 38]), (6, 2, [6, 7]), (38, 1, [38])]
)
def test_configurable_window_clips_at_last_gameweek(
    pool, acquisition, start, horizon, expected
):
    responses, calls = acquisition
    responses["body"] = export_csv(pool, expected)

    result = data.load_fplform("2026-27", start, *pool, horizon=horizon)

    assert result["weeks"] == result["requested_weeks"] == expected
    assert calls[0]["form"]["firstgw"] == str(expected[0])
    assert calls[0]["form"]["lastgw"] == str(expected[-1])


def test_partial_provider_headers_do_not_manufacture_predictions(pool, acquisition):
    responses, calls = acquisition
    responses["body"] = export_csv(pool, (6, 7, 8))

    result = data.load_fplform("2026-27", 6, *pool)

    assert calls[0]["form"]["lastgw"] == "10"
    assert result["weeks"] == result["header_weeks"] == [6, 7, 8]
    assert result["requested_weeks"] == [6, 7, 8, 9, 10]
    assert result["missing_weeks"] == [9, 10]
    assert "9" not in result["players"]["1"]["points"]
    assert "10" not in result["players"]["1"]["probabilities"]


def test_blanks_stay_missing_but_supplied_zeroes_are_valid(pool, acquisition):
    responses, _ = acquisition

    def edit(headers, rows):
        for row in rows:
            row["10_with_prob"] = ""
            row["10_prob"] = ""
        rows[0]["6_with_prob"] = "0"
        rows[0]["6_prob"] = "0"
        rows[0]["7_with_prob"] = " "
        rows[0]["7_prob"] = " "

    responses["body"] = export_csv(pool, edit=edit)
    result = data.load_fplform("2026-27", 6, *pool)

    assert result["weeks"] == [6, 7, 8, 9]
    assert result["header_weeks"] == [6, 7, 8, 9, 10]
    assert result["missing_weeks"] == [10]
    assert result["players"]["1"]["points"] == {"6": 0.0, "8": 4.0, "9": 4.5}
    assert result["players"]["1"]["probabilities"]["6"] == 0.0
    assert "7" not in result["players"]["1"]["probabilities"]


def test_optional_probability_columns_do_not_create_zeroes(pool, acquisition):
    responses, _ = acquisition
    responses["body"] = export_csv(pool, probabilities=False)
    result = data.load_fplform("2026-27", 6, *pool)
    assert result["players"]["1"]["probabilities"] == {}
    assert result["players"]["1"]["points"]["6"] == 3


def test_old_extra_and_unscheduled_headers_are_not_relabelled(pool, acquisition):
    responses, _ = acquisition

    def edit(headers, rows):
        headers.append("tba_pts")
        for row in rows:
            row["tba_pts"] = "12"

    responses["body"] = export_csv(pool, (5, 6, 7, 8, 9, 10, 11), edit=edit)
    result = data.load_fplform("2026-27", 6, *pool)
    assert result["weeks"] == [6, 7, 8, 9, 10]
    assert set(result["players"]["1"]["points"]) == {"6", "7", "8", "9", "10"}


def test_current_player_club_position_and_price_gate_ids(pool, acquisition):
    responses, _ = acquisition

    def edit(headers, rows):
        rows[0]["Price"] = "5.2"  # Exact 0.2 tolerance survives floating point.
        rows[1]["Team"] = "MCI"  # Same ID, wrong current club: skip.

    responses["body"] = export_csv(pool, edit=edit)
    result = data.load_fplform("2026-27", 6, *pool)
    assert result["matched_players"] == 4
    assert "1" in result["players"]
    assert "2" not in result["players"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("Team", "MCI"),
        ("Pos", "FWD"),
        ("Price", "5.3"),
        ("Price", "nan"),
        ("ID", "999"),
    ],
)
def test_low_current_pool_coverage_disables_provider(pool, acquisition, field, value):
    responses, _ = acquisition

    def edit(headers, rows):
        rows[0][field] = value
        rows[1]["ID"] = "888"

    responses["body"] = export_csv(pool, edit=edit)
    assert data.load_fplform("2026-27", 6, *pool) == {}
    assert "Too few" in data.source_metadata("fplform_2026-27_gw6")["validation"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("6_with_prob", "nan"),
        ("6_with_prob", "inf"),
        ("6_with_prob", "61"),
        ("6_with_prob", "-6"),
        ("6_prob", "1.01"),
        ("6_prob", "-0.01"),
        ("6_prob", "nan"),
        ("6_prob", "inf"),
    ],
)
def test_nonfinite_or_out_of_range_values_disable_provider(
    pool, acquisition, field, value
):
    responses, _ = acquisition
    responses["body"] = export_csv(
        pool, edit=lambda headers, rows: rows[0].update({field: value})
    )
    assert data.load_fplform("2026-27", 6, *pool) == {}
    assert "Invalid" in data.source_metadata("fplform_2026-27_gw6")["validation"]


@pytest.mark.parametrize(
    "broken",
    [
        "duplicate_id",
        "duplicate_header",
        "missing_column",
        "extra_cell",
        "missing_cell",
        "html",
        "all_blank",
        "old_only",
    ],
)
def test_malformed_or_empty_forecast_exports_disable_provider(
    pool, acquisition, broken
):
    responses, _ = acquisition

    def edit(headers, rows):
        if broken == "duplicate_id":
            rows.append(dict(rows[0]))
        elif broken == "duplicate_header":
            headers.append("6_with_prob")
        elif broken == "missing_column":
            headers.remove("Name")
            for row in rows:
                row.pop("Name")
        elif broken == "all_blank":
            for row in rows:
                for gw in range(6, 11):
                    row[f"{gw}_with_prob"] = ""

    body = export_csv(
        pool, weeks=(1, 2, 3) if broken == "old_only" else (6, 7, 8, 9, 10), edit=edit
    )
    if broken == "extra_cell":
        body = body.rstrip() + ",extra\n"
    elif broken == "missing_cell":
        body = body.rstrip().rsplit(",", 1)[0] + "\n"
    elif broken == "html":
        body = "<html>Service temporarily unavailable</html>"
    responses["body"] = body
    assert data.load_fplform("2026-27", 6, *pool) == {}
    assert data.source_metadata("fplform_2026-27_gw6")["validation"]


@pytest.mark.parametrize(
    "start,horizon",
    [(0, 5), (39, 5), (True, 5), (6.0, 5), (6, 0), (6, 39), (6, True), (6, "5")],
)
def test_invalid_request_ranges_do_not_fetch(pool, acquisition, start, horizon):
    _, calls = acquisition
    with pytest.raises(ValueError, match="start/horizon"):
        data.load_fplform("2026-27", start, *pool, horizon=horizon)
    assert calls == []


def test_unavailable_provider_is_optional(pool, acquisition):
    responses, _ = acquisition
    responses["status"] = "unavailable"
    assert data.load_fplform("2026-27", 6, *pool) == {}
    assert data.source_metadata("fplform_2026-27_gw6")["status"] == "unavailable"


def test_stale_provenance_is_preserved(pool, acquisition):
    responses, _ = acquisition
    responses["status"] = "stale"
    responses["body"] = export_csv(pool)
    result = data.load_fplform("2026-27", 6, *pool)
    assert result["weeks"] == [6, 7, 8, 9, 10]
    assert data.source_metadata("fplform_2026-27_gw6")["status"] == "stale"

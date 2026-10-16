from backend.model import fixture_projection


def market_data():
    return {
        "teams": {1: {"short_name": "ARS"}, 2: {"short_name": "CHE"}},
        "joe": {"projectionsByPeriod": {"7": {
            "latestSnapshotTs": "2026-10-14T09:00:51Z",
            "fixtures": [{"homeTeamCode": "ARS", "awayTeamCode": "CHE",
                          "lambdaHome": 1.8, "lambdaAway": 1.1, "pHomeCs": 0.33}],
        }}},
        "sources": {"fpljoe": {"fetched_at": "2026-10-14T19:53:08Z"}},
    }


def test_gameweek_snapshot_time_has_explicit_scope_and_separate_extraction():
    result = fixture_projection(market_data(), {"team_h": 1, "team_a": 2, "event": 7}, 1, {}, 1.5)
    assert result["source_at"] == "2026-10-14T09:00:51Z"
    assert result["source_at_scope"] == "gameweek latest snapshot"
    assert result["source_extracted_at"] == "2026-10-14T19:53:08Z"
    assert (result["gf"], result["ga"], result["cs"]) == (1.8, 1.1, 0.33)


def test_fixture_timestamp_takes_precedence_without_using_extraction_time():
    data = market_data()
    data["joe"]["projectionsByPeriod"]["7"]["fixtures"][0]["snapshotTsUtc"] = "2026-10-14T08:55:00Z"
    result = fixture_projection(data, {"team_h": 1, "team_a": 2, "event": 7}, 1, {}, 1.5)
    assert result["source_at"] == "2026-10-14T08:55:00Z"
    assert result["source_at_scope"] == "fixture"


def test_unknown_provider_time_stays_unknown():
    data = market_data()
    del data["joe"]["projectionsByPeriod"]["7"]["latestSnapshotTs"]
    result = fixture_projection(data, {"team_h": 1, "team_a": 2, "event": 7}, 1, {}, 1.5)
    assert result["source_at"] is None
    assert result["source_extracted_at"] == "2026-10-14T19:53:08Z"

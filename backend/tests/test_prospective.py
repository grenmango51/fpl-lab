import json

from backend import prospective


def test_pending_gameweek_is_never_scored(tmp_path, monkeypatch):
    directory = tmp_path / "data" / "snapshots"
    directory.mkdir(parents=True)
    record = {
        "deadline": "2026-10-10T10:00:00Z",
        "recorded_at": "2026-10-09T10:00:00Z",
        "players": [],
    }
    (directory / "2026-27_gw6_pending.json").write_text(json.dumps(record))
    monkeypatch.setattr(prospective, "ROOT", tmp_path)
    monkeypatch.setattr(
        prospective,
        "get_data",
        lambda: {
            "season": "2026-27",
            "bootstrap": {
                "events": [
                    {"id": 6, "deadline_time": record["deadline"], "finished": False}
                ]
            },
        },
    )
    monkeypatch.setattr(
        prospective,
        "fetch",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("Pending GW must not fetch actual points")
        ),
    )
    assert prospective.score()["gameweeks"] == []


def test_latest_predeadline_capture_and_identical_model_cohort(tmp_path, monkeypatch):
    directory = tmp_path / "data" / "snapshots"
    directory.mkdir(parents=True)
    deadline = "2026-09-20T10:00:00Z"
    for stamp, points in [
        ("2026-09-18T10:00:00Z", 99),
        ("2026-09-19T10:00:00Z", 5),
        ("2026-09-20T10:00:01Z", 99),
    ]:
        record = {
            "deadline": deadline,
            "recorded_at": stamp,
            "model_version": "test",
            "players": [
                {
                    "id": 1,
                    "forecast": {"xmins": 70, "points": points},
                    "models": {
                        "Live ensemble": points,
                        "Component model": 4,
                        "FPL Form": 6,
                    },
                },
                {
                    "id": 2,
                    "forecast": {"xmins": 20, "points": 99},
                    "models": {
                        "Live ensemble": 99,
                        "Component model": 99,
                        "FPL Form": 99,
                    },
                },
            ],
        }
        (directory / f"2026-27_gw5_{stamp.replace(':', '')}.json").write_text(
            json.dumps(record)
        )
    monkeypatch.setattr(prospective, "ROOT", tmp_path)
    monkeypatch.setattr(
        prospective,
        "get_data",
        lambda: {
            "season": "2026-27",
            "bootstrap": {
                "events": [{"id": 5, "deadline_time": deadline, "finished": True}]
            },
        },
    )
    monkeypatch.setattr(
        prospective,
        "fetch",
        lambda *args, **kwargs: json.dumps(
            {
                "elements": [
                    {"id": 1, "stats": {"total_points": 7}},
                    {"id": 2, "stats": {"total_points": 0}},
                ]
            }
        ),
    )
    result = prospective.score()["gameweeks"][0]
    assert result["recorded_at"] == "2026-09-19T10:00:00Z"
    assert result["models"]["Live ensemble"]["mae"] == 2
    assert result["models"]["Component model"]["mae"] == 3
    assert result["models"]["FPL Form"]["mae"] == 1
    assert all(m["count"] == 1 for m in result["models"].values())

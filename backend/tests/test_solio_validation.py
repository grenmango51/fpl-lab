from copy import deepcopy
import gzip
import hashlib
import json

import pytest

from backend.solio_validation import score_pending, score_protocol


def example(tmp_path):
    player = {"id": 1, "code": 123, "models": {"Live ensemble": 4},
              "component_forecast": {"xmins": 75}}
    snapshot = {"recorded_at": "2026-10-19T04:00:00Z", "future_targets": {
        "13": {"deadline": "2026-12-04T18:30:00Z", "players": [player]}}}
    path = tmp_path / "data/snapshots/frozen.json.gz"
    path.parent.mkdir(parents=True)
    path.write_bytes(gzip.compress(json.dumps(snapshot).encode()))
    protocol = {"target_gw": 13, "season": "2026-27", "deadline": "2026-12-04T18:30:00Z",
                "frozen_at": "2026-10-19T04:00:00Z", "target_fraction": .95,
                "forecasts": {"student": {"filename": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}}}
    observation = {"season": "2026-27", "recorded_at": "2026-10-24T04:00:00Z",
                   "source": {"full_planner_connected": True, "matched_players": 1},
                   "future_targets": {"13": {"deadline": protocol["deadline"],
                                            "players": [{"id": 1, "code": 123, "models": {"Solio": 5.5}}]}}}
    return protocol, observation


def test_exact_frozen_forecast_scoring_without_current_model_inputs(tmp_path):
    protocol, observation = example(tmp_path)
    result = score_protocol(protocol, observation, tmp_path)["models"]["student"]
    assert result["all_matched"]["mae"] == 1.5
    assert result["all_matched"]["within_one_point"] == 0
    assert result["target_met"] is False
    assert result["frozen_minutes_45_plus"]["count"] == 1


@pytest.mark.parametrize("mutation", [
    lambda o: o.update(recorded_at="2026-10-18T00:00:00Z"),
    lambda o: o["future_targets"]["13"].update(deadline="2026-12-05T18:30:00Z"),
    lambda o: o["future_targets"]["13"]["players"][0].update(code=999),
    lambda o: o["source"].update(full_planner_connected=False),
    lambda o: o["source"].update(matched_players=2),
])
def test_incompatible_observations_cannot_support_the_claim(tmp_path, mutation):
    protocol, observation = example(tmp_path)
    mutation(observation)
    with pytest.raises(ValueError):
        score_protocol(protocol, observation, tmp_path)


def test_first_observation_is_used_even_if_later_one_scores_better_and_result_is_immutable(tmp_path):
    protocol, observation = example(tmp_path)
    directory = tmp_path / "data/validation"
    directory.mkdir()
    (directory / "trial.protocol.json").write_text(json.dumps(protocol))
    assert score_pending(tmp_path) == []
    later = deepcopy(observation)
    later["recorded_at"] = "2026-10-25T00:00:00Z"
    later["future_targets"]["13"]["players"][0]["models"]["Solio"] = 4
    observations = tmp_path / "data/snapshots/solio"
    observations.mkdir()
    for name, value in (("2026-27_gw9_first.json.gz", observation), ("2026-27_gw9_later.json.gz", later)):
        (observations / name).write_bytes(gzip.compress(json.dumps(value).encode()))
    assert score_pending(tmp_path) == ["trial.result.json"]
    report = json.loads((directory / "trial.result.json").read_text())
    assert report["models"]["student"]["target_met"] is False
    assert report["observation_filename"].endswith("first.json.gz")
    assert score_pending(tmp_path) == []


def test_changed_frozen_forecast_is_rejected(tmp_path):
    protocol, observation = example(tmp_path)
    (tmp_path / "data/snapshots/frozen.json.gz").write_bytes(b"changed")
    with pytest.raises(ValueError, match="hash mismatch"):
        score_protocol(protocol, observation, tmp_path)

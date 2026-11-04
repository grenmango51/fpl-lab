"""Score predeclared frozen forecasts against the first full Solio observation."""

import hashlib
import json
import math
from pathlib import Path

from .capture import read_snapshot, source_time


def agreement(rows):
    errors = [r["prediction"] - r["solio"] for r in rows]
    if not errors:
        return None
    n = len(errors)
    return {"count": n, "mae": sum(map(abs, errors)) / n,
            "rmse": math.sqrt(sum(e * e for e in errors) / n), "bias": sum(errors) / n,
            "within_one_point": sum(abs(e) <= 1 for e in errors),
            "within_one_point_fraction": sum(abs(e) <= 1 for e in errors) / n,
            "errors_over_two_points": sum(abs(e) > 2 for e in errors)}


def score_protocol(protocol, observation, root):
    """No current forecasts, fitting or choice among target observations here."""
    gw = str(protocol["target_gw"])
    target = observation["future_targets"][gw]
    if observation["season"] != protocol["season"] or target["deadline"] != protocol["deadline"]:
        raise ValueError("Validation season/deadline changed")
    if source_time(observation["recorded_at"]) <= source_time(protocol["frozen_at"]):
        raise ValueError("Observation does not follow the freeze")
    source = observation.get("source", {})
    if not source.get("full_planner_connected") or len(target["players"]) != source.get("matched_players"):
        raise ValueError("Incomplete or selected target observation")
    observed = {p["id"]: p for p in target["players"]}
    if len(observed) != len(target["players"]):
        raise ValueError("Duplicate observation identity")
    result = {"target_gw": int(gw), "season": protocol["season"],
              "frozen_at": protocol["frozen_at"], "observed_at": observation["recorded_at"],
              "method": "Predeclared frozen forecasts versus the first complete later Solio target observation; agreement with projections, not actual match points.", "models": {}}
    for name, receipt in protocol["forecasts"].items():
        path = Path(root) / "data" / "snapshots" / receipt["filename"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != receipt["sha256"]:
            raise ValueError("Frozen forecast hash mismatch")
        record = read_snapshot(path)
        if record["recorded_at"] > protocol["frozen_at"]:
            raise ValueError("Forecast was created after the declared freeze")
        frozen = record["future_targets"][gw]
        if frozen["deadline"] != target["deadline"] or any("Solio" in p["models"] for p in frozen["players"]):
            raise ValueError("Frozen target is incompatible or already observed")
        rows = []
        for player in frozen["players"]:
            vendor = observed.get(player["id"])
            if vendor is None:
                continue
            if player["code"] != vendor["code"]:
                raise ValueError("Stable identity changed")
            rows.append({"id": player["id"], "code": player["code"],
                         "prediction": player["models"]["Live ensemble"],
                         "solio": vendor["models"]["Solio"],
                         "xmins": player["component_forecast"]["xmins"]})
        matched = agreement(rows)
        top = sorted(rows, key=lambda p: (-p["solio"], p["id"]))[:20]
        ours = sorted(rows, key=lambda p: (-p["prediction"], p["id"]))[:10]
        result["models"][name] = {
            "all_matched": matched, "frozen_minutes_45_plus": agreement([p for p in rows if p["xmins"] >= 45]),
            "solio_top20_descriptive": agreement(top),
            "top10_overlap": len({p["id"] for p in ours} & {p["id"] for p in top[:10]}),
            "target_met": bool(matched and matched["within_one_point_fraction"] >= protocol["target_fraction"]),
            "missing_observation": len(frozen["players"]) - len(rows),
            "new_provider_players": len(observed) - len(rows), "players": rows,
        }
    return result


def score_pending(root):
    root = Path(root)
    saved = []
    for path in sorted((root / "data" / "validation").glob("*.protocol.json")):
        output = path.with_name(path.name.replace(".protocol.json", ".result.json"))
        if output.exists():
            continue
        protocol = json.loads(path.read_text())
        candidates = []
        for source_path in (root / "data" / "snapshots" / "solio").glob(f"{protocol['season']}_gw*.json.gz"):
            observation = read_snapshot(source_path)
            if (str(protocol["target_gw"]) in observation.get("future_targets", {})
                    and observation.get("source", {}).get("full_planner_connected")
                    and source_time(observation["recorded_at"]) > source_time(protocol["frozen_at"])):
                candidates.append((observation["recorded_at"], source_path.name, observation))
        if not candidates:
            continue
        _, source_name, observation = min(candidates, key=lambda row: row[:2])
        # A changed deadline/identity is an error, never a reason to choose a
        # later observation with a preferable score.
        result = score_protocol(protocol, observation, root)
        result.update(observation_filename=source_name,
                      protocol_sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        with output.open("x", encoding="utf-8") as file:
            json.dump(result, file, indent=2, allow_nan=False)
        saved.append(output.name)
    return saved

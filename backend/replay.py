"""Reconstruct a capture's inputs from its content-addressed local receipts.

No network or current cache is consulted. Use in a separate process: acquisition
globals are patched temporarily and must not be shared with a live API worker.
"""

import gzip
import hashlib
from pathlib import Path
from unittest.mock import patch

from . import data, solio
from .capture import read_snapshot


def replay_dataset(snapshot_path, archive_root):
    snapshot = read_snapshot(snapshot_path)
    sources = snapshot.get("sources") or snapshot["capture_receipt"]["sources"]
    used = {}

    def archived_fetch(url, key, *args, optional=False, **kwargs):
        meta = sources.get(key, {})
        digest = meta.get("sha256")
        if not digest:
            if not optional:
                raise ValueError(f"Capture has no receipt for required source {key}")
            used[key] = {**meta, "status": "unavailable"}
            return ""
        path = Path(archive_root) / "data" / "raw" / key / f"{digest}.payload.gz"
        raw = gzip.decompress(path.read_bytes())
        if hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError(f"Archived source hash mismatch: {key}")
        used[key] = dict(meta)
        return raw.decode("utf-8-sig", errors="replace")

    with patch.object(data, "fetch", archived_fetch), \
         patch.object(data, "_statuses", used), \
         patch.object(data, "_dataset", None), \
         patch.object(data, "_loaded", 0), \
         patch.object(solio, "load", return_value={}):
        dataset = data.get_data(force=True)
    dataset["loaded_at"] = snapshot.get("capture_receipt", {}).get(
        "dataset_loaded_at", snapshot["recorded_at"]
    )
    dataset["replay"] = {"snapshot": str(snapshot_path), "network": False,
                         "source_hashes": {k: v.get("sha256") for k, v in used.items()}}
    return dataset

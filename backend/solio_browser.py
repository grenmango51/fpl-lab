"""Optional authenticated acquisition; configuration and sessions stay local."""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timedelta, timezone


def load(root, *, refresh=False):
    path = root / "data" / "cache" / "solio_authenticated.json"
    try:
        config = json.loads((root / "data" / "cache" / "solio-browser.json").read_text())
    except (OSError, ValueError):
        return None
    if not config.get("enabled"):
        return None
    error = None
    if refresh:
        try:
            subprocess.run([config["python"], str(root / "tools" / "capture_solio_browser.py"),
                            "--root", str(root), "--cdp-url", config["cdp_url"]],
                           check=True, capture_output=True, timeout=150)
        except Exception as exc:
            error = type(exc).__name__
    try:
        envelope = json.loads(path.read_text(encoding="utf-8"))
        when = datetime.fromisoformat(envelope["fetched_at"])
        age = datetime.now(timezone.utc) - when
        if not timedelta(0) <= age <= timedelta(hours=8):
            error = error or "OldAcquisition"
        if error:
            envelope.update(status="stale", error=error)
            temp = path.with_suffix(f".{os.getpid()}.tmp")
            temp.write_text(json.dumps(envelope, ensure_ascii=False), encoding="utf-8")
            os.replace(temp, path)
        elif envelope.get("status") == "live" and not refresh:
            envelope["status"] = "cached"
        return envelope
    except (OSError, ValueError, KeyError):
        return None

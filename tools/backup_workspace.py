"""Consistent daily workspace backup; retained locally for 14 days."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import sqlite3

from backend.workspace import configuration

path = configuration()
if path and path.exists():
    destination = path.parent / "cloud" / "backups"
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(destination, 0o700)
    backup = destination / (datetime.now(timezone.utc).strftime("%Y-%m-%d") + ".sqlite3")
    with sqlite3.connect(path) as source, sqlite3.connect(backup) as target:
        source.backup(target)
    os.chmod(backup, 0o600)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).timestamp()
    for item in destination.glob("*.sqlite3"):
        if item.stat().st_mtime < cutoff:
            item.unlink()
    print("Workspace backup saved.")

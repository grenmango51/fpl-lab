"""One personal workspace, with atomic revisions on durable local disk."""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from fastapi import HTTPException


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def configuration():
    path = os.environ.get("OPEN_FPL_WORKSPACE_PATH", "")
    return Path(path) if path else None


def _connect(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=15, isolation_level=None)
    connection.execute("CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id=1), body TEXT NOT NULL)")
    return connection


def read():
    path = configuration()
    empty = {"enabled": bool(path), "revision": 0, "document": None, "saved_at": None}
    if path:
        with closing(_connect(path)) as connection:
            row = connection.execute("SELECT body FROM workspace WHERE id=1").fetchone()
        return {**json.loads(row[0]), "enabled": True} if row else empty
    return empty


def save(revision, document):
    path = configuration()
    if not path:
        raise HTTPException(409, "Shared saving is not enabled on this host.")
    value = {"revision": revision + 1, "saved_at": datetime.now(timezone.utc).isoformat(), "document": document}
    body = encode(value)
    if len(body.encode()) > 5_000_000:
        raise HTTPException(413, "The shared workspace exceeds 5 MB. Export older branches first.")
    connection = _connect(path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT body FROM workspace WHERE id=1").fetchone()
        current_revision = json.loads(row[0])["revision"] if row else 0
        if current_revision != revision:
            raise HTTPException(409, "Plans changed on another device. Your local copy is retained.")
        connection.execute("INSERT OR REPLACE INTO workspace VALUES (1, ?)", (body,))
        connection.commit()
    finally:
        connection.close()
    return {**value, "enabled": True}

"""Test-only stdin bridge to the real in-process plan validation endpoint.

No lifespan, socket listener, data acquisition or collector is started.
"""
import json
import os
import sys

os.environ.pop("OPEN_FPL_ORIGIN_TOKEN", None)

from fastapi.testclient import TestClient  # noqa: E402
from backend import app as api  # noqa: E402

client = TestClient(api.app)
for line in sys.stdin:
    if not line.strip():
        continue
    request = json.loads(line)
    api.forecast_for = lambda _: request["forecast"]
    response = client.post("/api/plan/validate", json=request["body"])
    sys.stdout.write(
        json.dumps(
            {
                "id": request.get("id"),
                "status": response.status_code,
                "body": response.json(),
            }
        )
        + "\n"
    )
    sys.stdout.flush()

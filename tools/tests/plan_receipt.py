"""Test-only stdin bridge to the real in-process plan validation endpoint.

No lifespan, socket listener, data acquisition or collector is started.
"""
import json
import sys

from fastapi.testclient import TestClient
from backend import app as api

request = json.load(sys.stdin)
api.forecast_for = lambda _: request["forecast"]
response = TestClient(api.app).post("/api/plan/validate", json=request["body"])
json.dump({"status": response.status_code, "body": response.json()}, sys.stdout)

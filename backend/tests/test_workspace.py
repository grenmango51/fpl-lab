from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend import app as api_module, workspace
from backend.tests.test_plan_state import state_fixture


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_FPL_WORKSPACE_PATH", str(tmp_path / "workspace.sqlite3"))
    monkeypatch.delenv("OPEN_FPL_ORIGIN_TOKEN", raising=False)
    return TestClient(api_module.app)


def test_workspace_survives_new_connections_and_rejects_lost_updates(store):
    assert workspace.read()["document"] is None
    first = workspace.save(0, {"plans": ["first"]})
    assert first["revision"] == 1
    assert workspace.read()["document"] == {"plans": ["first"]}
    with pytest.raises(HTTPException) as error:
        workspace.save(0, {"plans": ["stale device"]})
    assert error.value.status_code == 409
    assert workspace.read()["document"] == {"plans": ["first"]}


def test_two_concurrent_devices_cannot_both_replace_the_same_revision(store):
    workspace.save(0, {"plans": []})
    def write(label):
        try:
            return workspace.save(1, {"device": label})["revision"]
        except HTTPException as error:
            return error.status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(write, ["phone", "laptop"]))
    assert sorted(results) == [2, 409]
    assert workspace.read()["revision"] == 2


def test_api_validates_saved_squad_and_resources_before_advancing_revision(store, monkeypatch):
    _, body = state_fixture(monkeypatch)
    plan = {"id": "personal", "name": "My team", "base_squad": body["base_squad"],
            "base_bank": body["bank"], "free_transfers": body["free_transfers"],
            "purchase_prices": body["purchase_prices"], "weeks": body["weeks"]}
    document = {"version": 1, "plans": [plan], "active_id": "personal", "watch": [1]}
    saved = store.post("/api/workspace", json={"revision": 0, "document": document})
    assert saved.status_code == 200, saved.text
    assert saved.json()["document"]["plans"][0]["weeks"][0]["permanent_squad"] == body["base_squad"]
    broken = deepcopy(document)
    broken["plans"][0]["weeks"][0]["captain"] = 999
    assert store.post("/api/workspace", json={"revision": 1, "document": broken}).status_code == 422
    assert store.get("/api/workspace").json()["revision"] == 1
    assert store.post("/api/workspace", json={"revision": 0, "document": document}).status_code == 409


def test_disabled_workspace_preserves_local_only_mode(monkeypatch):
    monkeypatch.delenv("OPEN_FPL_WORKSPACE_PATH", raising=False)
    assert workspace.read() == {"enabled": False, "revision": 0, "document": None, "saved_at": None}


def test_origin_is_closed_even_for_health_and_static_routes_without_gateway_token(store, monkeypatch):
    monkeypatch.setenv("OPEN_FPL_ORIGIN_TOKEN", "unit-test-gateway-credential")
    for path in ("/", "/api/health", "/api/workspace", "/docs"):
        assert store.get(path).status_code == 403
        assert store.get(path, headers={"x-open-fpl-origin-token": "incorrect"}).status_code == 403
    response = store.get("/api/health", headers={"x-open-fpl-origin-token": "unit-test-gateway-credential"})
    assert response.status_code == 200

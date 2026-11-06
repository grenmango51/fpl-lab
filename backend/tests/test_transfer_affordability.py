"""The picker's shared financial cases must agree with actual server requests."""

from copy import deepcopy
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import app as api


FIXTURE = json.loads((Path(__file__).parent / "fixtures/transfer_affordability.json").read_text())


def replace(week, outgoing, incoming):
    for field in ("squad", "starters", "bench"):
        week[field] = [incoming if pid == outgoing else pid for pid in week[field]]
    for field in ("captain", "vice"):
        if week[field] == outgoing:
            week[field] = incoming


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["name"])
def test_picker_accounting_against_server(monkeypatch, case):
    players = [{
        "id": pid, "position_id": position,
        "team": case.get("teams", {}).get(str(pid), team),
        "price": case.get("prices", {}).get(str(pid), price),
        "pplay": 1,
        "gw": {str(w["gw"]): {"points": 2, "pplay": 1, "p60": 1, "xmins": 90}
               for w in case["weeks"]},
    } for pid, position, team, price in FIXTURE["players"]]
    monkeypatch.setattr(api, "forecast_for", lambda _: {
        "players": players, "gameweeks": [w["gw"] for w in case["weeks"]],
    })
    weeks = []
    for spec in case["weeks"]:
        week = {
            "gw": spec["gw"], "chip": spec.get("chip", "none"),
            "squad": list(range(1, 16)),
            "starters": [1, 3, 4, 5, 8, 9, 10, 11, 13, 14, 15],
            "bench": [2, 6, 7, 12], "captain": 13, "vice": 8,
        }
        for outgoing, incoming in spec["swaps"]:
            replace(week, outgoing, incoming)
        weeks.append(week)
    body = {
        "base_squad": list(range(1, 16)), "bank": case.get("bank", 0),
        "free_transfers": case.get("free_transfers", 5), "purchase_prices": case.get("purchases", {"13": 5.5}),
        "weeks": weeks,
    }
    client = TestClient(api.app)  # No lifespan/server/collector is started.
    before = client.post("/api/plan/validate", json=body)
    assert before.status_code == 200, before.text
    assert before.json()["weeks"][-1]["bank"] == case["expected"]["bank"]
    if "hitsBefore" in case["expected"]:
        assert before.json()["weeks"][-1]["hits"] == case["expected"]["hitsBefore"]
        assert before.json()["weeks"][-1]["free_transfers"] == case["expected"]["freeTransfers"]
    edited = deepcopy(body)
    replace(edited["weeks"][-1], case["outgoing"], case["target"])
    after = client.post("/api/plan/validate", json=edited)
    if case.get("clubBlocked"):
        assert after.status_code == 422, after.text
        assert "club" in after.text.lower()
    elif case["expected"]["bankAfter"] < 0:
        assert after.status_code == 422, after.text
        assert "available bank" in after.text
    else:
        assert after.status_code == 200, after.text
        result = after.json()["weeks"][-1]
        assert result["bank"] == case["expected"]["bankAfter"]
        if "hitsAfter" in case["expected"]:
            assert result["hits"] == case["expected"]["hitsAfter"]
        # Net cancellation retains the historical receipt, including on FH/WC.
        if len(weeks) == 1 and case["target"] == 13:
            expected_receipt = body["purchase_prices"].get("13", 6.5)
            assert result["purchase_prices"]["13"] == expected_receipt
            if case["name"] in ("same-week cancellation", "wildcard cancellation", "Free Hit cancellation"):
                assert result["transfers_in"] == result["transfers_out"] == []

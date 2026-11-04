"""Read Solio's signed-in Points table through an existing Ilmari Chrome.

Optional runner: requires Playwright, but does not launch a browser, copy
cookies, change forecasts/plans, or attempt Google verification challenges.
Only this runner's newly opened tab is operated and closed.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit


# Read only the active replica's public player identities and source receipts.
# Never export account/session data or the user's saved plans.
IDENTITIES = r"""async () => {
  const databases = (await indexedDB.databases()).filter(x =>
    x.name.includes('zero-') && !x.name.includes('zero-anon'));
  if (databases.length !== 1) throw Error('Ambiguous forecast cache');
  const db = await new Promise((ok, no) => {
    const r = indexedDB.open(databases[0].name);
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
  try {
    const read = key => new Promise((ok, no) => {
      const r = db.transaction('chunks').objectStore('chunks').get(key);
      r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
    });
    const groups = await read('c/' + await read('h/client-groups') + '/d');
    const heads = Object.values(groups).filter(x => !x.disabled).map(x => x.headHash);
    if (heads.length !== 1) throw Error('Ambiguous active forecast cache');
    const commit = await read('c/' + heads[0] + '/d');
    if (!commit.valueHash) throw Error('Unknown forecast cache format');
    const result = {elements: [], teams: [], background_receipts: [], scenario: [], overrides: 0};
    const visit = async hash => {
      const node = await read('c/' + hash + '/d');
      if (!Array.isArray(node) || !Array.isArray(node[1])) throw Error('Unknown tree format');
      if (node[0] > 0) {
        for (const entry of node[1]) await visit(entry[1]);
        return;
      }
      for (const [key, value] of node[1]) {
        if (typeof key !== 'string' || !key.startsWith('e/')) continue;
        const table = key.split('/')[1];
        if (table === 'fplElement') result.elements.push(value);
        else if (table === 'fplTeam') result.teams.push(value);
        else if (table === 'fplInfoSet') result.scenario.push(Object.fromEntries(
          Object.entries(value).filter(([k]) => ['name', 'isBase', 'active', 'homeGoalMultiplier'].includes(k))));
        else if (table.includes('BackgroundProjectionBatch')) result.background_receipts.push(
          Object.fromEntries(Object.entries(value).filter(([k]) =>
            ['id', 'lastUpdated', 'updatedAt', 'updated_at', 'gameweek', 'fixtureId', 'defaultGameweek'].includes(k))));
        else if (/^fpl(Element.*Projection|Team.*Projection|TeamStrength|FixturePermutation|Element.*Propensity|ElementPenaltyShare)/.test(table)) result.overrides++;
      }
    };
    await visit(commit.valueHash);
    return result;
  } finally { db.close(); }
}"""

ROWS = """xs => xs.map(x => ({
  index: Number(x.getAttribute('aria-rowindex')) - 2,
  cells: Array.from(x.querySelectorAll('td')).map(c => c.textContent)
}))"""


def capture(endpoint):
    from playwright.sync_api import sync_playwright

    parsed = urlsplit(endpoint)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost") or parsed.username or parsed.password or parsed.query:
        raise ValueError("Use a local dedicated-browser endpoint")
    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(endpoint, timeout=15000)
        if len(browser.contexts) != 1:
            raise ValueError("Ambiguous browser context")
        page = browser.contexts[0].new_page()
        sync = {"confirmed_at": None, "connected": False}

        def websocket(socket):
            if urlsplit(socket.url).hostname != "sync.solioanalytics.com":
                return
            sync["connected"] = True

            def received(raw):
                try:
                    message = json.loads(raw)
                    if isinstance(message, list) and message[0] == "pokeEnd":
                        sync["confirmed_at"] = datetime.now(timezone.utc).isoformat()
                except (ValueError, IndexError):
                    pass

            socket.on("framereceived", received)
            socket.on("close", lambda: sync.update(connected=False))

        page.on("websocket", websocket)
        try:
            page.goto("https://fpl.solioanalytics.com/", wait_until="domcontentloaded", timeout=30000)
            page.get_by_role("tab", name="Projections", exact=True).click(timeout=30000)
            page.get_by_role("tab", name="Players", exact=True).click()
            # The new tab uses the default Base Scenario; never alter inputs to
            # manufacture a provider observation from a saved custom scenario.
            page.get_by_role("combobox", name="Select projection metric", exact=True).wait_for()
            grid = page.locator("table[role=grid]")
            grid.wait_for(state="attached")
            page.wait_for_function("document.querySelector('table[role=grid] th')?.textContent === 'Name' && Number(document.querySelector('table[role=grid]')?.getAttribute('aria-rowcount')) > 1")
            for _ in range(100):
                if sync["confirmed_at"] and sync["connected"]:
                    break
                page.wait_for_timeout(100)
            if not sync["confirmed_at"] or not sync["connected"]:
                raise ValueError("No live source sync; offline browser cache is not a fresh acquisition")
            identity = page.evaluate(IDENTITIES)
            # Solio retains deactivated information sets after their tree node
            # is removed. They are not inputs to the active Base Scenario.
            active = [s for s in identity["scenario"] if s.get("active") is not False]
            if identity["overrides"] or len(active) != 1 or not active[0].get("isBase") or active[0].get("homeGoalMultiplier") not in (None, 1):
                raise ValueError("Source has custom forecast assumptions")
            if page.get_by_role("combobox", name="Select projection metric", exact=True).inner_text().strip().casefold() != "points":
                raise ValueError("Expected the unmodified Points metric")
            headers = grid.locator("th").all_text_contents()
            expected = int(grid.get_attribute("aria-rowcount")) - 1
            if expected != sum(x.get("purchaseable") is True for x in identity["elements"]):
                raise ValueError("Filtered or incomplete source player pool")
            rows = {}
            scroller = page.locator(".dvn-scroller")
            for _ in range(100):
                if len(rows) == expected:
                    break
                target = min(set(range(expected)) - rows.keys())
                scroller.evaluate("(x, i) => {x.scrollTop = i * 30}", target)
                page.wait_for_function("i => Array.from(document.querySelectorAll('table[role=grid] tbody tr')).some(x => Number(x.getAttribute('aria-rowindex')) - 2 === i)", arg=target, timeout=7000)
                for row in grid.locator("tbody tr").evaluate_all(ROWS):
                    if row["index"] in rows and rows[row["index"]] != row["cells"]:
                        raise ValueError("Forecast publication changed during acquisition")
                    rows[row["index"]] = row["cells"]
            if set(rows) != set(range(expected)):
                raise ValueError("Missing virtual table rows")
            # Detect updates to source assumptions while reading the table.
            after = page.evaluate(IDENTITIES)
            if after != identity or not sync["connected"]:
                raise ValueError("Source changed during acquisition")
            return {"schema": 1, "captured_at": datetime.now(timezone.utc).isoformat(),
                    "sync_confirmed_at": sync["confirmed_at"],
                    "headers": headers, "expected_rows": expected,
                    "rows": [{"index": i, "cells": rows[i]} for i in sorted(rows)], "identity": identity}
        finally:
            page.close()


def persist(record, root):
    raw = json.dumps(record, ensure_ascii=False, allow_nan=False).encode()
    digest = hashlib.sha256(raw).hexdigest()
    archive = root / "data" / "raw" / "solio_authenticated" / f"{digest}.payload.gz"
    archive.parent.mkdir(parents=True, exist_ok=True)
    with archive.open("xb") as handle:
        handle.write(gzip.compress(raw, mtime=0))
    meta = {"url": "https://fpl.solioanalytics.com/", "fetched_at": record["captured_at"],
            "fetched_epoch": datetime.fromisoformat(record["captured_at"]).timestamp(),
            "sha256": digest, "bytes": len(raw), "status": "live", "content_type": "application/json",
            "raw_archive": str(archive.relative_to(root)),
            "sync_confirmed_at": record["sync_confirmed_at"],
            "extraction_method": "Signed-in Base Scenario Points table; all virtual rows; publication time unknown"}
    path = root / "data" / "cache" / "solio_authenticated.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(f".{os.getpid()}.tmp")
    temp.write_text(json.dumps({**meta, "body": raw.decode()}, ensure_ascii=False), encoding="utf-8")
    os.replace(temp, path)
    return {"players": record["expected_rows"], "gameweeks": record["headers"][4:], "fetched_at": record["captured_at"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cdp-url", required=True)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        print(json.dumps(persist(capture(args.cdp_url), args.root)))
    except Exception as exc:
        # Browser errors can contain session URLs; publish only the type.
        print(json.dumps({"error": type(exc).__name__}))
        raise SystemExit(1)

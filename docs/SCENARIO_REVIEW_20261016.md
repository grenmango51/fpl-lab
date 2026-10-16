# Fixture scenario integrity review — 2026-10-16

Bounded source review of the fixture backend/model pipeline and frontend persistence. Read global/project AGENTS, MODEL_PROVIDERS, STATUS, PLAN, MODEL, FIXTURE_SCENARIOS and TEAM_SCENARIOS. No delegation, browser automation, source acquisition or server restart. Other uncommitted work was preserved.

## Findings

1. **P2, fixed: plan import discarded the official fixture catalog.** `preparePlanImport` returned the raw `/projections` response, and App adopts that response as its forecast state. This response does not carry the separately fetched client catalog. Subsequent fixture controls lost original Unset fixtures and persistence stopped checking unknown fixture IDs against the catalog. The helper now retains the incoming official catalog, as `loadPlanningState` already does. A regression uses a real-shaped projection response without the catalog and confirms an official Unset fixture survives while an unknown ID is pruned afterward. Changed only `src/planningPersistence.ts` and its test for this fix.

2. **P2, parent action: refresh bypasses catalog enrichment.** In `src/App.tsx`, `refresh()` obtains its baseline directly from POST `/refresh`, then supplies that response to `loadPlanningState`. Unlike `forecastBaseline()`, it does not GET `/fixture-schedule`. A successful refresh therefore drops the official catalog; if a stored moved fixture has since finished, its saved ID is not pruned and the second `/projections` call can fail with 422 instead of restoring the remaining planning state. Fetch the current official catalog after refresh and enrich the baseline before sanitisation. App is explicitly parent-owned and was not edited.

3. **P2, parent action: catalog and forecast disagree on provisional completion.** `backend/fixture_catalog.py:build_fixture_catalog` excludes `finished` rows but includes `finished_provisional` rows, whereas `canonical_fixture_moves` rejects both. A saved move can therefore survive restore sanitisation after the match becomes provisionally finished, then prevent reload with 422. Direct reproduction using the catalog test dataset and fixture 71 with `finished_provisional=True`: catalog includes 71; `canonical_fixture_moves({'71': 8}, dataset)` rejects it as completed. Exclude provisional completions from the editable catalog and add a genuine restore/catalog regression. This module is outside this review's permitted edit ownership and was not edited.

## Bounded checks

- `npm test -- src/planningPersistence.test.ts`: **20 passed**, including the new import regression.
- `python -m pytest backend/tests/test_fixture_scenarios.py backend/tests/test_fixture_catalog.py -q`: **41 passed**, existing Starlette/httpx deprecation warning only.
- Source inspection confirmed `cache=False` prevents both cache hits and writes in scenario component construction. Original fixture dictionaries and the entire original schedule feed market lookup; moved target weeks do not become source events or dates.
- Empty/identity maps return the ordinary payload; both clubs' affected origin/destination weeks are replaced, while unaffected calibrated dictionaries remain frozen. Destination minutes precede component construction; team factors follow fixture changes; individual stat schedules apply last.
- Fixture destination validation uses strict integers and excludes booleans/floats/nonfinite values. Team factors reject booleans/nonfinite values. Persistence uses finite-number checks.
- Request inheritance and dynamic forecast field collection carry fixture/team maps through solver, jobs, plan validation and snapshots. Snapshot configuration/hash and scenario receipts are covered by the focused suite.

No additional actionable numerical pipeline issue was found within this scope. The supplied parent report of 21,226 unchanged rows out of 21,344 was not independently rerun. Full suites/build, live browser save/reload/import/refresh acceptance and coverage remain the parent's final checks. These checks do not establish numerical Solio parity, calibrated move probabilities, congestion/recovery modelling or forecast accuracy.

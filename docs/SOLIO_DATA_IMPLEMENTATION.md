# Season stats implementation

Owned implementation: `src/SeasonData.tsx`, `src/season-data.css`,
`src/seasonDataModel.ts` and focused tests; `backend/season_data.py` and tests.
Existing app/model/types/forecast logic is left to the parent owners.

## Wiring for parent

Import `{ SeasonData } from "./SeasonData"` and render
`<SeasonData data={data} onDetail={id => /* existing player detail action */} />`
as the separate Data/Season Stats destination.

The real API entry point is `backend/app.py` (`backend/main.py` does not exist).
Import `router as season_data_router` from `.season_data` and call
`app.include_router(season_data_router)` **before the static-file mount**.
The child intentionally does not edit `backend/app.py` because it is outside
the assigned existing-file ownership. Restart the API after mounting.

`GET /api/season-data` reads official cached aggregates and fixture results,
without loading/changing the forecast pipeline. Its receipts preserve the
original extraction times and hashes. The component falls back explicitly to
Bootstrap minutes/FPL points/price/ownership if the endpoint is unavailable;
model xG90/xA90 and all forecast GW fields are excluded.

## Tools

Players/Teams, multi-search, position/team/minutes filters, counting metrics
per 90, grouped sortable columns, independent-axis SVG Graph alongside the
table, plus/check Compare with full names and Clear, and locally named saved
column views with show/hide/order controls. Team outcomes come from completed
fixture scores, never sums of player clean-sheet counts.

Maps exposes Touches/Passes/Shots with the precise required event coordinates,
outcomes and trajectory/keeper inputs. Official FPL summary feeds do not
provide those events. No synthetic coordinates or Opta labels are used.

## Verification

Integrated into `App.tsx` as the separate, lazy-loaded Data view, and the router is mounted before static files in `backend/app.py`.

The full current suites pass: 357 backend tests, 94 frontend tests and the production build. Dedicated Ilmari/Profile 8 browser checks verified the real endpoint's 667-player/20-club coverage, four-row comma/pipe substring search, independent graph axes alongside the table, per-90 labels, two-player comparison/full names/Clear, saved column order through reload and deletion, all 20 team rows, the event-data limitation and layouts at 390/768/1280 pixels. Receipts: ignored `data/exports/qa/ilmari-workflows-20261015/data-checks.json` and `responsive-checks.json`.

Official aggregates do not provide event coordinates, pass trajectories or keeper positions; event Maps remains unavailable for that specific reason. This is not a claim of complete Opta-data parity.

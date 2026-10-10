# Open FPL

Free, local-first Fantasy Premier League forecasting and planning web app: real forecasts through GW38, a constrained multi-week optimiser, and an honest evaluation view. Personal project; runs only on the Windows laptop. This folder is a local git repo with no remote.

## Start here
- `docs/STATUS.md`: current handover, what is delivered and verified. Read it first.
- `docs/PLAN.md` (research and build plan), `docs/MODEL.md` (model derivation and limits), `docs/PROVIDER_ACCESS.md` (what each data provider gives and how it is accessed), `docs/SOLIO_UX.md` and `docs/ELEVENIFY_FIXTURE_VIEWS.md` (UI references).
- Read STATUS, PLAN and MODEL before changing any modelling assumption.
- `README.md`: run commands, CSV formats, evaluation and prospective scoring commands.

## Run and check
- Needs Python 3.11+ and Node 20.19+/22.12+.
- Run: `./start.ps1 -Install` once, then `./start.ps1` → http://127.0.0.1:8000. Dev: `./start.ps1 -Development` → http://127.0.0.1:5173.
- Checks: `python -m pytest backend/tests -q`, `npm test`, `npm run build`.

## Rules
- Use real sourced data. Record source, extraction time and any forecast adjustment; show fallback status and model limitations in the UI.
- Stable player codes across seasons, current official FPL numeric IDs within the live season, club codes across providers.
- Every backtest feature must use only information available before the predicted fixture. Never use final-season aggregates to predict the same season.
- Keep the historical component benchmark separate from the live provider ensemble. Capture pre-deadline predictions before reporting prospective accuracy.
- Don't claim competitive or paid-provider accuracy without a fair, deadline-aligned out-of-sample benchmark.
- Validate squad, formation, XI, budget, club limits, captain, bench, chips, selling prices, bank, hits and FT carryover on the server.
- Raw provider payloads, vendor datasets and forecast snapshots stay in ignored local storage. Never expose `.env` values, credentials, cookies or account tokens.
- Public provider inputs, imported projections and extrapolation are authorised for this personal project.
- Design: Solio's dark navy/orange planner, pitch, timeline and compact analytical views as references, under the original Open FPL branding.

## Done means
- All three checks pass.
- Data coverage is checked, not assumed: every expected gameweek and player is present after the change. Missing forecast weeks were caught by me before, not by tests.
- You opened the affected browser flows and looked. Keep UI text short; I've had to cut excessive text before.
- `docs/STATUS.md` reflects what changed and what is still unproven.

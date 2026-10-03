# Solio workflow observations

Checked 2026-10-03 in the authorised Ilmari Chrome profile, using an ordinary free Google sign-in and public FPL entry 2200722. No subscription was purchased. Sources: [live planner](https://fpl.solioanalytics.com/), [official optimiser tutorial](https://www.youtube.com/watch?v=0ywv0p6itmU), and [tutorial channel](https://www.youtube.com/@SolioAnalytics).

## Observed interaction

The pitch stays visible beside the selected analytical tab. Bank, saved transfers, chip and gameweek controls sit next to the lineup. The planning tree carries the horizon and transfer decisions; it is a working control rather than a large explanatory introduction.

The free optimiser exposes named presets, adjustable risk and disruption assumptions, player inclusions/exclusions and transfer constraints. A normal solve opens the plan comparison, previews the draft lineup and transfers, and offers adoption, an alternative and copying. The comparison keeps the existing plan visible. On this team's default five-week run, the saved plan displayed 292.9 projected points and the draft 308.9, with six transfers across GW6–10. These are Solio's displayed estimates, not observed match outcomes or our model's accuracy.

The current free interface gates sentence-based rules and automatic chip planning behind a membership action; chips can be placed manually. This is an observation of the accessed free account, not a complete paid feature inventory. The official 92-second optimiser demo also shows the pitch beside the optimisation controls. The browser briefly labelled captions unavailable, so no complete transcript or claims about unobserved narration are made.

## Changes to Open FPL

- Removed the planner slogan, large metric cards and repeated introductory copy. Bank, free transfers and points use a compact row; the horizon uses a short scrolling timeline.
- Optimisation shows the current lineup before solving, then one selected draft gameweek with a pitch, transfers, captain, bank and hits. The default horizon is five weeks. Numerical objective settings are under Advanced; stress testing is a closed disclosure.
- A comparable draft shows its net-point change against a frozen, server-validated baseline over identical GWs. Incomplete baseline coverage suppresses the comparison. Adoption creates a separate branch.
- Solving starts at the selected gameweek. The preceding validated decisions determine the permanent squad, bank, purchase values, chip usage and transfer allowance. Free Hit restores the permanent holdings. The source branch and result context are frozen so switching branches during a solve cannot change adoption's origin.
- Earlier decisions remain when a future solve is adopted; the branch ends at the solved horizon. Fresh future-start branches survive reload. Source and method detail remain accessible in disclosures and Analysis.
- Analysis compares actual shared gameweeks, including hit deductions. Different starts and horizon lengths do not misalign the chart or inflate a longer branch's comparison total.

The Solio comparison exposed a rules bug: Wildcard and Free Hit must preserve the saved transfer allowance without granting an extra transfer. Imports, server validation and MILP constraints now agree. Entry 2200722 reconstructs three saved transfers and £0.2m for GW6. [Official Premier League FAQ](https://www.premierleague.com/en/news/4661030).

This reproduces useful interaction patterns, not Solio's proprietary optimiser or stochastic risk calculations. Open FPL still uses a screened MILP pool, fixed future prices, a linear bench approximation and an ownership heuristic. It has manual chip schedules and sampled sensitivity scenarios rather than a calibrated branching stochastic programme.

## Provider data scope

FPL Form's previous three-week window was a local request restriction. Its ordinary [public export](https://www.fplform.com/export-fpl-form-data) supplied real GW6–10 points for all 667 current players. The loader now requests five weeks, clips at GW38, validates current identities and preserves actual missing cells and headers. Later points remain extrapolated. Current provider values are live anchors and future evaluation inputs; they are not inserted into historical ML training or held-out historical targets.

Solio's homepage also explicitly advertises a public [AI report](https://fpl.solioanalytics.com/api/data/latest.json). The checked report covers only GW6: overlapping lists contain 57 unique matched players, without FPL IDs or future-week series. It is not a complete five-week projection export. Its cached report-generation time is distinct from extraction time and the age of underlying markets. Raw research responses stay in ignored local caches; no production model integration was made. The homepage invitation and the [general terms](https://solioanalytics.com/legal/terms-of-service/) give different signals about automated model use, so the report is recorded as a bounded research reference.

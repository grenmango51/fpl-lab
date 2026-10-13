# Solio rebuild reference, 2026-10-12

Observed directly in the user's already-open, signed-in Chrome tab at
https://fpl.solioanalytics.com/?view=tree&tab=lineup. The older settled T3
session `9edcd637-bbe9-41af-941e-a8e2c9cae126` was read for source context.
Its public entry is 2200722. No paid membership was bought.

## Layout and interactions

- Narrow left rail: brand, Plan, Opta data, Market data, settings at bottom.
- Dotted dark navy branching canvas on the left; selected detail panel on
  the right. At the observed 790-pixel viewport, the split is approximately
  equal. Top canvas controls Configure and 5 GWs; bottom Create/Copy/Delete.
- Connected Base Team, orange Base Scenario node, GW cards and evaluation
  node. Cards show expected points, bank and used/available transfers. The
  selected card has an orange outline and an Optimise button above it.
- Right panel tabs: Lineup, Projections, Optimise, Plans, Fixtures.
- Lineup: editable FTs/available and bank, display metric and chip selects,
  previous/next GW, Reset and Actions. Large shirt pitch, bench, transfer
  summary, then a points-distribution chart.
- Player click opens C, VC, Lock, Ban and Remove actions. Transfer/Edit
  tabs; transfer shortlist includes price, selected-GW value and horizon
  difference. The edit panel is premium-gated but exposes minutes states,
  non-penalty goals/90, assists/90, defensive contributions/90 and component
  summaries. We implement explicit human GW scenarios in our own units.
- Plans: Table/Distribution/Scatter views, saved/generated plan selection,
  horizon or GW analysis. The inspected free account exposes ownership
  swing, weaker starter alternatives, transfer value versus holding, bank/FT
  pressure over time, autosub likelihood, points-component contributions and
  fixture-strength exposure. Consensus effective ownership and calibrated
  distributions are Solio inputs; official ownership and local independent
  appearance estimates must carry their own labels in our implementation.
- Projections: Players/Teams/Fixtures subtabs, scenario selector, search,
  filters, sortable heatmap with Name/Team/Price/Average and GW columns.
  Metric options observed: points, effective ownership, price, minutes,
  goals, assists, penalties, clean sheets, bonus, DefCon%, averages, baselines.

## Optimise

Preset cards: Default, High Risk, Low Risk, Optimistic, Safe and Custom.
Default displays risk 0 and disruption 50%; High/Low Risk display +/-0.5
and 25%; Optimistic 0 and 0%; Safe 0 and 75%. Objective has risk and
disruption sliders, each with Apply to future decisions. Constraints offer
locked/banned players and transfer controls (Used and Split diff).
Rules in sentences and automatic chip planning are visibly Pro-gated;
manual chips remain available. A footer Optimise action runs the solver.

Open FPL's ownership preference, saved-transfer value and bench weight are
different objective assumptions. Similar preset names must not imply
reproduction of Solio's disruption probabilities or stochastic programme.
Its exact player forecasts, probability model and paid optimisation
internals remain unavailable; UI resemblance cannot establish equality.

## Sources retained

FPL Joe fixture markets, Elevenify season team forecasts and five separate
player reference feeds, FPL Form's actual supplied player/GW point window,
official FPL identities/rules/history and authorised uploaded projections.
Every remaining player/GW forecast must be present; supplied and extrapolated
points remain distinct. Source extraction times and stale fallbacks remain
available in the app. Historical component evaluation stays separate from
the current provider ensemble.

Public pages checked today: https://fpl.solioanalytics.com/ and
https://solioanalytics.com/. Solio advertises a five-GW free planner and
member full-season optimisation. The observed account has GW7-11.

## Verification record

The completed build and browser/data checks are recorded in STATUS.md.
This file is a direct observed feature inventory, not a claim that all
premium features or proprietary numerical behavior have been reproduced.

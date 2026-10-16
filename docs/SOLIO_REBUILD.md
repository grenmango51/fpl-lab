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

## Interaction follow-up, October 14–15

The signed-in free Solio planner was inspected again in the existing Chrome
session. No membership was purchased and no proprietary forecast feed or source
code was acquired. Observed details included the small adjacent player popup,
C/VC/Lock/Ban actions, Transfer/Edit tabs, contextual replacement list, compact
controls around the goalkeeper, Configure and Actions menus, selectable Plans
Table/Distribution/Scatter views, collapsible analytical sections, and fixture
attack/clean-sheet views. The account still exposed GW7–11; gated controls could
be inventoried but not exercised.

Open FPL now follows those observable interaction patterns using its own
components, forecasts and branding. The player popup stays alongside the pitch
on desktop and fits the screen on mobile. It includes a real same-position,
budget/club-aware replacement list and a confirmation step, rather than routing
every transfer through the full projections table. Whole-shirt hitboxes, legal
substitution targets, drag substitutions, captain/vice controls, branch controls,
resource editing, reversible plan changes and remembered filters are functional.
The splitter is draggable and keyboard accessible. The original lineup image
can be previewed and saved as PNG; rendering is verified, browser download
completion has the automation limitation recorded in STATUS.md.

Table/Scatter compare identical gameweeks and expose which plans are selected.
The optimiser keeps the pitch present and separates setup, players, rules and
advanced options. Drafts remain read-only until independently validated adoption.
Fixture drilldowns retain source units/time scope and never replace team market
odds with a player's manual scenario.

This is a substantial implementation of the inspected flow, not pixel-identical
or exhaustive parity. Solio's calibrated distributions, projected effective
ownership, disruption/risk model, proprietary objective, natural-language rules,
paid edit units and inaccessible premium screens are not reproduced. Similar
layout does not imply equal numerical behaviour or forecast accuracy.

## Recovered all-tab review, October 15

The follow-up extends compact controls and contextual navigation to every main
view and its subtabs. Tab strips reveal the selected item after resizing and
support arrows/Home/End. Projection player and team metrics retain independent
choices; filters and subviews survive navigation. Settings groups inputs,
backups and sources. Market cards open fixture details, and dense tables retain
internal scrolling on phones. Source times and player match records use readable
text. The compact desktop editor stacks its stat and minutes forms.

The review confirmed and fixed hidden player History results. Successful draft
adoption now clears the old Apply action, and optimiser player links preserve
the previewed GW. Direct checks include a real solve/adoption, fixed-plan chip
recommendation, GW38 details, desktop/mobile tabs and production smoke checks.
This recovery continued without subagents. STATUS.md records the checks and
remaining limits; these changes do not establish exhaustive Solio parity.

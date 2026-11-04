# Five-gameweek optimiser benchmark

Research performed 20 October 2026 UTC; implementation verified 21 October local time. Source: the signed-in free [Solio planner](https://fpl.solioanalytics.com/) in the existing dedicated Ilmari Chrome. No subscription was purchased. This is a development benchmark and feature audit, not an actual-points accuracy test or a complete Solio clone.

## Reproduce

The reusable runner is `tools/benchmark_optimiser.py`. It makes no network requests and independently replays each result through the server's squad, budget, selling-price, chip, FT and hit validator. It also checks ownership and captain constraints. Detailed inputs, solver versions, source hashes, results, browser receipts and the interactive report stay ignored under `data/exports/benchmarks/solio-optimiser-20261020/`.

```powershell
$bench = 'data/exports/benchmarks/solio-optimiser-20261020'
python tools/benchmark_optimiser.py "$bench/frozen-solio-points.json" "$bench/cases.json" --seconds 2 5 15 --repeats 2 --output "$bench/rerun.json"
python tools/benchmark_optimiser.py "$bench/frozen-solio-points.json" "$bench/cases-second-squad.json" --seconds 2 5 15 --repeats 2 --output "$bench/rerun-second.json"
```

Use a new output name for each run. To replay the original implementation, add `--solver-file "$bench/solver-before.py"`. `before-final.json` / `before-second-final.json` and `after-verified.json` / `after-second-verified.json` contain the paired benchmark. `max-xi.json` is a separate objective experiment, not a default-setting result.

## Frozen protocol

- Exactly **GW8–12**, with **563 purchaseable Solio players × five weeks = 2,815 supplied cells**, captured at **2026-10-20 20:23:56 UTC**. All current IDs, stable codes, clubs, positions and deadlines validate. The 668-player local pool retains the other 105 players explicitly; none was selected by any compared plan. Provider publication time is unknown.
- Local appearances, fixtures and remaining-season inputs come from the archived `2026-27_gw8_20261020T195933986572Z.json.gz` inputs. The frozen file applies the captured Solio cells explicitly. The generic archived replay deliberately omits Solio, so merely requesting `use_solio=true` from that replay is insufficient. The initial exploratory runs without that injection are excluded from the paired result.
- Entry 2200722 starts with **four FTs and £1.5m**. Purchase prices were read from Solio's base-team editor, rather than using Open FPL's reconstructed historical estimates. Case variants use a two-transfer ceiling, Auto/up to 15, zero FTs, and a Haaland ban.
- A second legal initial squad replaces Calafiori/Szoboszlai/Haaland with Justin/Saka/Calvert-Lewin, with **one FT and £9.4m** as displayed by Solio after those base-team transfers. Its case uses Auto. Every case has two repeats at 2/5/15-second budgets: **30 runs per local solver version**.
- The common score is **XI + captain − hits**, using identical full-precision point cells. It excludes each app's autosub/vice/risk model; the benchmark retains those displayed totals separately. Ordinary objectives still include future discounting, FT utility and bench weighting. This score does not make the underlying objectives identical.
- Local timing is solver-call wall time, including seed/model/scoring work, excluding independent replay and forecast acquisition. Solio timing is browser-observed start to the first usable draft, including communication/rendering. Solio's hardware, internal stopping tolerance and optimality gap are unknown. Two repeats on one frozen window are not a general speed or quality guarantee.

## Findings

The original solver returned **14/30 valid results**; the revised solver returned **30/30**. At the two-second budget the result is **0/10 → 10/10**. A legal incumbent prevents short requests from spending their entire budget rediscovering feasibility. Longer searches can improve points; individual cases can also take longer than the original implementation.

Measured Solio first-draft times were **6.89s Default**, **10.62s Optimistic**, **5.89s with Haaland banned**, and **15.74s for the second squad**. Their displayed totals were **311.8**, **312.9**, **307.5** and **306.5**, respectively. The first exploratory default run was not instrumented and is excluded from timing statistics.

Solio's saved default plan scores **309.10 common points**, its banned-Haaland plan **305.12**, and its second-squad plan **303.41**, including the second squad's first-week hit. The local Auto case finds **308.09** in longer searches. The optional Max XI points objective finds **310.53** in **7.78s**, versus **308.69** at five seconds and **302.02** at two seconds. That extra score uses a different objective and eight transfers; it is not evidence of superior Solio risk/disruption optimisation or forecast accuracy.

## Controls directly inspected

- **Presets:** Default = risk 0 / disruption 50%; High Risk = +0.5 / 25%; Low Risk = −0.5 / 25%; Optimistic = 0 / 0%; Safe = 0 / 75%; Custom permits tuning. Risk ranges from −1 to +1; disruption from 0% to 100%. Both show inheritance and an Apply to future decisions checkbox. The disruption tooltip describes an unexpected transfer before each GW and more conservative bench choices. These are distinct from a forecast confidence interval.
- **Lock/ban picker:** searchable full identity pool, separate columns for the selected GW and that GW onwards, counts and clear controls. The Haaland ban was solved and every resulting squad was captured. Lock controls were inspected; arbitrary lock combinations were not all solved.
- **Transfers:** Auto or an integer 0–15 for transfers **used this GW**, described as a total. This is different from Open FPL's maximum-per-week ceiling. Exact transfer-count rules remain a local gap.
- **Starting resources:** editable purchase prices, FTs and bank. Confirmed base-team swaps update purchase values, bank and FTs. Invalid club composition disables branch-copy actions and marks affected GW nodes. The two initial squads exercised this workflow.
- **Information tree:** Add information inserts a scenario after the selected decision. Its probability slider was changed from 100% to **30%** in 1% steps. Projections then showed only GW9–12 after the GW8 decision. This verifies an editable scenario weight and timing; it does not verify non-anticipativity, stochastic coupling, normalisation or the solver's aggregation formula.
- **Drafts and alternatives:** running percentage, automatic Plans navigation, saved/draft rows, projected points, risk, transfer count and relative time. Apply and Reject were exercised. Alt/Alternative and Copy are visible; their diversity guarantees and exact algorithms remain unverified.
- **Plan views:** Table, Distribution and Scatter; Absolute; All/This node; Horizon/Gameweek. Analysis exposes Swing, Health and Robustness, EO bets, weak spots, transfer contribution, bank/FT pressure, autosub risk, Points DNA and fixture distribution. Those proprietary distributions and effective-ownership forecasts were not imported into Open FPL.
- **Projection views:** Points, effective ownership, price, minutes, goals, assists, penalties, clean sheets, bonus, Defcon %, ban risk, averages and baselines. Player search and scenario selection work alongside the tree.
- **Minutes editor:** opening Haaland's future-week cell showed conditional minute-survival information and **Upgrade to edit**. No edit was submitted or gate bypassed. Numerical projection-edit propagation cannot be claimed from this free account.
- **Pro gates:** natural-language hard/preference rules and automatic chip planning explicitly require Pro; manual chip placement is advertised as available. Visible examples include cheap-defender counts, penalty-taker preferences and avoiding goalkeeper purchases before a Wildcard. Current paid-rule semantics and paid chip search remain untested.

## Delivered locally and remaining work

Delivered: checked held/rolling incumbents, bounded seed work inside ordinary short budgets, a five-second left quick action, a two-second full-workspace option, Auto transfer ceiling, Max XI points preset, provider-positive candidate eligibility, honest gap-target status and replayable comparisons. These retain the existing server validation, frozen-source adoption, earlier weeks, right tab and Undo.

Next priorities are separate risk/disruption assumptions with measurable semantics; scenario-specific forecast snapshots and shared pre-information decisions; exact transfer counts; diverse alternative plans; and progress/cancellation during a single solve. Existing ownership heuristics and sampled stress branches do not implement those features. Conserved goal/assist shares, minutes-adjusted penalty tiers and calibrated distributions remain separate model work.

## Cleanup and acquisition

The original Solio base squad, all 15 purchase prices, four FTs, £1.5m bank and original **286.6-point** five-week tree were restored. Research plan branches were removed and the research information set was explicitly deactivated in the scenario selector. Solio retains deactivated sets in its local replica even after tree deletion. Acquisition now ignores only sets with the literal boolean `active=false`; another active/unknown set, projection overrides or altered base multiplier still rejects the source. Fresh complete acquisition was verified after cleanup. No account credentials or session payloads were exported.

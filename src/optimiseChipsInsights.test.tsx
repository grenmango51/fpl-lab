import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chipPlannerInputKey } from "./ChipPlanner";
import {
  ChipStrategyView,
  chipStrategyInputSignature,
  sign as chipSign,
  type ChipStrategyJob,
} from "./ChipStrategyView";
import {
  comparisonYBounds,
  formatPlanGWs,
  PlanComparisonView,
} from "./PlanComparisonView";
import { deltaClass, PlanInsights, round1, signed } from "./PlanInsights";
import { watchSensitivity } from "./sensitivity";
import { SensitivityView } from "./SensitivityView";
import type {
  Bootstrap,
  Evaluation,
  Forecast,
  Plan,
  Player,
  SensitivityJob,
  SolveResult,
  Week,
} from "./types";
import {
  AnalysisView,
  buildPlayerConstraintReceipts,
  MarketView,
  OptimiseView,
  type SolverSettings,
} from "./Views";

const hooks = vi.hoisted(() => ({
  enabled: false,
  values: [] as unknown[],
  deps: [] as (readonly unknown[] | undefined)[],
  refs: [] as { current: unknown }[],
  cursor: 0,
  effectCursor: 0,
  refCursor: 0,
}));

vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (!hooks.enabled) return actual.useState(initial);
      const slot = hooks.cursor++;
      if (!(slot in hooks.values)) {
        hooks.values[slot] =
          typeof initial === "function" ? (initial as () => unknown)() : initial;
      }
      return [
        hooks.values[slot],
        (next: unknown) => {
          hooks.values[slot] =
            typeof next === "function"
              ? (next as (prev: unknown) => unknown)(hooks.values[slot])
              : next;
        },
      ];
    },
    useRef: (initial: unknown) => {
      if (!hooks.enabled) return actual.useRef(initial);
      const slot = hooks.refCursor++;
      if (!hooks.refs[slot]) hooks.refs[slot] = { current: initial };
      return hooks.refs[slot];
    },
    useMemo: (calc: () => unknown, deps?: readonly unknown[]) => {
      if (!hooks.enabled) return actual.useMemo(calc, deps ?? []);
      return calc();
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      if (!hooks.enabled) return actual.useEffect(effect, deps);
      const slot = hooks.effectCursor++;
      const prev = hooks.deps[slot];
      const changed =
        !prev ||
        !deps ||
        prev.length !== deps.length ||
        deps.some((d, i) => !Object.is(d, prev[i]));
      hooks.deps[slot] = deps;
      if (changed) effect();
    },
  };
});

const viewStateOverrides: Record<string, unknown> = {};
vi.mock("./useViewState", () => ({
  useViewState: (key: string, fallback: unknown) => [
    key in viewStateOverrides ? viewStateOverrides[key] : fallback,
    vi.fn(),
  ],
}));

function resetHooks() {
  hooks.enabled = false;
  hooks.values = [];
  hooks.deps = [];
  hooks.refs = [];
  hooks.cursor = 0;
  hooks.effectCursor = 0;
  hooks.refCursor = 0;
}

function runCycle<T>(fn: () => T): T {
  let out!: T;
  for (let pass = 0; pass < 4; pass++) {
    const before = [...hooks.values];
    hooks.cursor = 0;
    hooks.effectCursor = 0;
    hooks.refCursor = 0;
    out = fn();
    if (
      before.length === hooks.values.length &&
      before.every((v, i) => Object.is(v, hooks.values[i]))
    ) {
      break;
    }
  }
  return out;
}

afterEach(() => {
  resetHooks();
  for (const key of Object.keys(viewStateOverrides)) {
    delete viewStateOverrides[key];
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function makePlayer(id: number, pos = 3, points = 4, price = 6): Player {
  const f: Forecast = {
    points,
    xmins: 90,
    pplay: 1,
    fixtures: [],
    components: { appearance: 2, goals: points - 2 },
  };
  return {
    id,
    code: id,
    name: `Player ${id}`,
    full_name: `Player ${id}`,
    position: (["GKP", "DEF", "MID", "FWD"] as const)[pos - 1],
    position_id: pos,
    team: ((id - 1) % 10) + 1,
    team_name: `Team ${((id - 1) % 10) + 1}`,
    team_short: `T${((id - 1) % 10) + 1}`,
    team_code: ((id - 1) % 10) + 1,
    price,
    ownership: 15,
    status: "a",
    news: "",
    chance: 100,
    form: 4,
    total_points: 40,
    minutes: 900,
    xg90: 0.3,
    xa90: 0.2,
    xmins: 90,
    pplay: 1,
    p60: 0.9,
    dc_probability: 0,
    sample_matches: 10,
    has_prior: true,
    overridden: false,
    price_change: 0.1,
    transfers_in: 1200,
    transfers_out: 400,
    price_change_percent: "42",
    price_change_projections: [],
    penalties_order: null,
    gw: { "11": f, "12": f, "19": f, "20": f, "37": f, "38": f },
  };
}

function makeSetup() {
  const positions = [1, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 1, 2, 2, 3];
  const players = positions.map((pos, i) => makePlayer(i + 1, pos, 4, 5));
  players.push(makePlayer(16, 2, 8, 4.8));
  const week11: Week = {
    gw: 11,
    squad: players.slice(0, 15).map((p) => p.id),
    starters: players.slice(0, 11).map((p) => p.id),
    bench: [12, 13, 14, 15],
    captain: 5,
    vice: 6,
    chip: "none",
    bank: 1.5,
    free_transfers: 2,
    next_free_transfers: 3,
    hits: 0,
    points: 48,
    net_points: 48,
    transfers_in: [],
    transfers_out: [],
  };
  const week12: Week = {
    ...week11,
    gw: 12,
    chip: "benchboost",
    net_points: 62,
    points: 62,
  };
  const plan: Plan = {
    id: "plan-a",
    name: "Branch A",
    weeks: [week11, week12],
    base_squad: [...week11.squad],
    base_bank: 1.5,
    free_transfers: 2,
    purchase_prices: {},
    created_at: "2026-10-01T00:00:00Z",
  };
  const data: Bootstrap = {
    players,
    gameweeks: [11, 12, 13, 14, 19, 20, 37, 38],
    events: [],
    teams: [],
    next_gw: 11,
    season: "2026-27",
    loaded_at: "2026-10-01T12:00:00Z",
    model_version: "v0.3",
    history_rows: 1000,
    sources: {
      fpl_bootstrap: {
        url: "https://fantasy.premierleague.com/api/bootstrap-static/",
        fetched_at: "2026-10-01T12:00:00Z",
        status: "ok",
        sha256: "abcdef1234567890",
      },
      elevenify: {
        url: "https://elevenify.com",
        fetched_at: null,
        status: "stale",
      },
    },
    limitations: ["Test limitation"],
    parameters: {},
  };
  const solver: SolverSettings = {
    horizon: 4,
    max_transfers: 2,
    decay: 0.9,
    ft_value: 1.5,
    bench_weight: 0.08,
    risk: 0,
    seconds: 15,
    locked: [5],
    excluded: [],
  };
  return { players, week11, week12, plan, data, solver };
}

describe("SensitivityView and sensitivity polling fixes", () => {
  it("URL-encodes job IDs when polling", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "a/b?c", status: "complete" })),
      );
    vi.stubGlobal("fetch", fetcher);
    const stop = watchSensitivity("a/b?c", {
      update: vi.fn(),
      error: vi.fn(),
      missing: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/sensitivity/a%2Fb%3Fc",
      undefined,
    );
    stop();
  });

  it("filters stress horizon against plan startGW, guards single-GW range, and fixes 1 gameweek grammar", () => {
    const { data, plan, solver, week11 } = makeSetup();
    const latePlan: Plan = {
      ...plan,
      weeks: [
        { ...week11, gw: 37 },
        { ...week11, gw: 38 },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(SensitivityView, {
        data,
        plan: latePlan,
        strategy: solver,
        forecast: {},
        busy: false,
        onApply: vi.fn(),
        onDetail: vi.fn(),
      }),
    );
    expect(html).toContain("1 gameweek</option>");
    expect(html).toContain("2 gameweeks</option>");
    expect(html).not.toContain("3 gameweeks</option>");
    expect(html).not.toContain("1 gameweeks");

    const finalGwPlan: Plan = { ...plan, weeks: [{ ...week11, gw: 38 }] };
    const finalGwHtml = renderToStaticMarkup(
      createElement(SensitivityView, {
        data,
        plan: finalGwPlan,
        strategy: solver,
        forecast: {},
        busy: false,
        onApply: vi.fn(),
        onDetail: vi.fn(),
      }),
    );
    expect(finalGwHtml).toContain("Branch A · GW38</small>");
    expect(finalGwHtml).not.toContain("GW38–38");
  });

  it("renders null variant.gap as unknown, prefixes positive mean with +, guards null loaded_at, and shows ready badge", async () => {
    vi.useFakeTimers();
    const { data, plan, solver, week11 } = makeSetup();
    const job: SensitivityJob = {
      id: "job-gap",
      status: "complete",
      phase: "Complete",
      created_at: "2026-10-01T12:00:00Z",
      finished_at: "2026-10-01T12:01:00Z",
      attempted: 3,
      completed: 3,
      total: 3,
      cancel_requested: false,
      error: null,
      failures: [],
      settings: {
        variation: 0.25,
        seed: 2026,
        name: "Branch A",
        solve: {
          squad: plan.base_squad,
          bank: 1.5,
          free_transfers: 2,
          purchase_prices: {},
          used_chips: [],
          start_gw: 11,
          horizon: 2,
          seconds: 4,
          decay: 0.9,
        },
      },
      forecast: {
        model_version: "v0.3",
        loaded_at: null,
        sha256: "0123456789abcdef0123",
        layers: [],
      },
      baseline: null,
      baseline_value: 90,
      summary: {
        denominator: 3,
        frequencies: { purchases: [], sales: [], captains: [] },
        roll_count: 2,
        differences: { mean: 1.4, p10: -2.1, p90: 3.5 },
        variants: [
          {
            count: 2,
            scenario: 1,
            weeks: [week11],
            base_value: 48,
            gap: null,
          },
        ],
      },
      method: "Perturbed solves",
      limitations: [],
    };
    vi.stubGlobal("localStorage", {
      getItem: () => "job-gap",
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(job))),
    );
    hooks.enabled = true;
    runCycle(() =>
      SensitivityView({
        data,
        plan,
        strategy: solver,
        forecast: {},
        busy: false,
        onApply: vi.fn(),
        onDetail: vi.fn(),
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const tree = runCycle(() =>
      SensitivityView({
        data,
        plan,
        strategy: solver,
        forecast: {},
        busy: false,
        onApply: vi.fn(),
        onDetail: vi.fn(),
      }),
    );
    hooks.enabled = false;
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("gap unknown");
    expect(html).not.toContain("gap 0.0%");
    expect(html).toContain("<b>+1.4</b>");
    expect(html).toContain("Source time unavailable");
    expect(html).not.toContain("Invalid Date");
    expect(html).toContain("disclosure-ready");
  });
});

describe("ChipPlanner and ChipStrategyView contract fixes", () => {
  it("normalizes -0.0 in chipSign and excludes plan.name from ChipPlanner inputKey", () => {
    expect(chipSign(-0.02)).toBe("+0.0");
    expect(chipSign(-0)).toBe("+0.0");
    expect(chipSign(-0.14)).toBe("-0.1");
    expect(chipSign(2.34)).toBe("+2.3");

    const { plan } = makeSetup();
    const renamed = { ...plan, name: "Renamed Branch" };
    expect(chipPlannerInputKey(plan, { use_market: true })).toBe(
      chipPlannerInputKey(renamed, { use_market: true }),
    );
  });

  it("tracks forecast, next_gw, loaded_at, and player pool metadata in chipStrategyInputSignature", () => {
    const { data } = makeSetup();
    const baseSig = chipStrategyInputSignature({ a: 1, b: 2 }, data);
    expect(chipStrategyInputSignature({ b: 2, a: 1 }, data)).toBe(baseSig);
    expect(chipStrategyInputSignature({ a: 1, b: 3 }, data)).not.toBe(baseSig);
    expect(
      chipStrategyInputSignature({ a: 1, b: 2 }, { ...data, next_gw: 12 }),
    ).not.toBe(baseSig);
    expect(
      chipStrategyInputSignature(
        { a: 1, b: 2 },
        { ...data, loaded_at: "2026-10-01T12:05:00Z" },
      ),
    ).not.toBe(baseSig);
    const repriced = structuredClone(data);
    repriced.players[0].price += 0.1;
    expect(chipStrategyInputSignature({ a: 1, b: 2 }, repriced)).not.toBe(
      baseSig,
    );
    const transferred = structuredClone(data);
    transferred.players[0].team = 99;
    expect(chipStrategyInputSignature({ a: 1, b: 2 }, transferred)).not.toBe(
      baseSig,
    );
    const reclassified = structuredClone(data);
    reclassified.players[0].position_id = 4;
    expect(chipStrategyInputSignature({ a: 1, b: 2 }, reclassified)).not.toBe(
      baseSig,
    );
  });

  it("enforces input signature match, blocks chip-less baseline saves, renders inline candidate failures, and syncs half across GW19/20", async () => {
    vi.useFakeTimers();
    const { data, plan, solver, week11 } = makeSetup();
    const forecast = { use_market: true };
    const matchingSig = chipStrategyInputSignature(forecast, data);
    const baseJob: ChipStrategyJob = {
      id: "cs-job",
      status: "complete",
      phase: "Complete",
      elapsed_seconds: 12,
      attempted: 2,
      completed: 1,
      total: 2,
      cancel_requested: false,
      error: null,
      settings: {
        auto_chip: "wildcard",
        chip_half: 1,
        max_candidates: 4,
        budget_seconds: 120,
        name: "Branch A",
        solve: {},
      },
      forecast: {
        sha256: "abcdef0123456789abcdef",
        model_version: "v0.3",
        loaded_at: "2026-10-01T12:00:00Z",
      },
      scope: {
        gameweeks: [11, 12],
        eligible_gameweeks: [11],
        selected_gameweeks: [11],
        all_eligible_selected: true,
      },
      candidates: [
        {
          id: "baseline",
          chip: "none",
          gw: null,
          status: "complete",
          error: null,
          weeks: [week11],
          net_points: 48,
          improvement: 0,
        },
        {
          id: "wc-11",
          chip: "wildcard",
          gw: 11,
          status: "failed",
          error: "Infeasible club constraint",
        },
      ],
      baseline: {
        id: "baseline",
        chip: "none",
        gw: null,
        status: "complete",
        error: null,
        weeks: [week11],
        net_points: 48,
        improvement: 0,
      },
      best: {
        id: "baseline",
        chip: "none",
        gw: null,
        status: "complete",
        error: null,
        weeks: [week11],
        net_points: 48,
        improvement: 0,
      },
      recommendation: null,
      method: "Bounded placement search",
      limitations: [],
    };
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          id: "cs-job",
          source: plan,
          inputSignature: matchingSig,
        }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(baseJob))),
    );
    hooks.enabled = true;
    runCycle(() =>
      ChipStrategyView({
        data,
        plan,
        gw: 19,
        strategy: solver,
        forecast,
        busy: false,
        onApply: vi.fn(async () => {}),
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    // 1. With matching inputs, !job.recommendation still disables Save strategy branch and shows inline failure note!
    const noRecTree = runCycle(() =>
      ChipStrategyView({
        data,
        plan,
        gw: 19,
        strategy: solver,
        forecast,
        busy: false,
        onApply: vi.fn(async () => {}),
      }),
    );
    hooks.enabled = false;
    const noRecHtml = renderToStaticMarkup(noRecTree);
    expect(noRecHtml).toContain("Infeasible club constraint");
    expect(noRecHtml).toMatch(
      /<button[^>]*disabled=""[^>]*>Save strategy branch<\/button>/,
    );
    expect(noRecHtml).not.toContain("Inputs changed since this search");

    // 2. Now suppose job HAS a recommendation, verify enabled with matching inputs, then disabled + orange notice when inputs change, and half syncs on GW20!
    hooks.enabled = true;
    // Update job state in hook slot to have a recommendation:
    const recJob: ChipStrategyJob = {
      ...baseJob,
      best: {
        id: "wc-11",
        chip: "wildcard",
        gw: 11,
        status: "complete",
        error: null,
        weeks: [week11],
        net_points: 53,
        improvement: 5,
      },
      recommendation: { chip: "wildcard", gw: 11, improvement: 5 },
    };
    const jobSlot = hooks.values.findIndex(
      (v) => v !== null && typeof v === "object" && "candidates" in v,
    );
    hooks.values[jobSlot] = recJob;
    const enabledTree = runCycle(() =>
      ChipStrategyView({
        data,
        plan,
        gw: 19,
        strategy: solver,
        forecast,
        busy: false,
        onApply: vi.fn(async () => {}),
      }),
    );
    hooks.enabled = false;
    const enabledHtml = renderToStaticMarkup(enabledTree);
    expect(enabledHtml).toContain(
      '<button class="button primary small">Save strategy branch</button>',
    );

    hooks.enabled = true;
    const staleAndCrossedTree = runCycle(() =>
      ChipStrategyView({
        data: { ...data, next_gw: 12 },
        plan,
        gw: 20,
        strategy: solver,
        forecast,
        busy: false,
        onApply: vi.fn(async () => {}),
      }),
    );
    hooks.enabled = false;
    const staleHtml = renderToStaticMarkup(staleAndCrossedTree);
    expect(staleHtml).toContain(
      "Inputs changed since this search. Rerun to save a branch.",
    );
    expect(staleHtml).toMatch(
      /<button[^>]*disabled=""[^>]*>Save strategy branch<\/button>/,
    );
    expect(staleHtml).toContain('<option value="2" selected="">GW20–38</option>');

    // 3. Verify storageWarning survives watchChipStrategy polling callbacks.error("") when localStorage.setItem throws!
    resetHooks();
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: vi.fn(),
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(recJob)))
        .mockResolvedValueOnce(new Response(JSON.stringify(recJob))),
    );
    hooks.enabled = true;
    const initialCsTree = runCycle(() =>
      ChipStrategyView({
        data,
        plan,
        gw: 11,
        strategy: solver,
        forecast,
        busy: false,
        onApply: vi.fn(async () => {}),
      }),
    );
    // Find and invoke "Search chip strategy" onClick:
    function findButtons(node: unknown): { props: Record<string, any> }[] {
      if (Array.isArray(node)) return node.flatMap(findButtons);
      if (!node || typeof node !== "object" || !("type" in node)) return [];
      const el = node as { type: unknown; props: Record<string, any> };
      return [
        ...(el.type === "button" ? [el] : []),
        ...findButtons(el.props?.children),
      ];
    }
    const searchBtn = findButtons(initialCsTree).find((b) =>
      JSON.stringify(b.props.children).includes("Search chip strategy"),
    )!;
    await searchBtn.props.onClick();
    // Run effect cycle so watchChipStrategy polls and invokes callbacks.error(""):
    runCycle(() =>
      ChipStrategyView({
        data,
        plan,
        gw: 11,
        strategy: solver,
        forecast,
        busy: false,
        onApply: vi.fn(async () => {}),
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const afterPollTree = runCycle(() =>
      ChipStrategyView({
        data,
        plan,
        gw: 11,
        strategy: solver,
        forecast,
        busy: false,
        onApply: vi.fn(async () => {}),
      }),
    );
    hooks.enabled = false;
    const afterPollHtml = renderToStaticMarkup(afterPollTree);
    expect(afterPollHtml).toContain(
      "Search running. Storage unavailable; keep this page open to save.",
    );
  });
});

describe("OptimiseView, AnalysisView, and MarketView fixes", () => {
  it("groups global and GW-onwards player constraint receipts cleanly", () => {
    const { solver } = makeSetup();
    const receipts = buildPlayerConstraintReceipts(
      {
        ...solver,
        locked: [5],
        excluded: [9],
        locked_by_gw: { "12": [16], "13": [16], "14": [16] },
        excluded_by_gw: { "37": [7], "38": [7] },
      },
      [11, 12, 13, 14, 37, 38],
    );
    expect(receipts.map((r) => `${r.kind}:${r.id}:${r.scopeLabel}`)).toEqual([
      "locked:5:All GWs",
      "locked:16:GW12–14",
      "excluded:9:All GWs",
      "excluded:7:GW37 onwards",
    ]);
  });

  it("tracks tree gw changes without snapping selectedGw back to result.weeks[0].gw and renders empty/meta search results", () => {
    const { data, plan, solver, week11, week12 } = makeSetup();
    const result: SolveResult = {
      weeks: [week11, week12],
      objective: 110,
      status: "Optimal",
      gap: 0,
      candidate_count: 60,
      pool_count: 600,
      assumptions: [],
    };
    hooks.enabled = true;
    runCycle(() =>
      OptimiseView({
        data,
        plan,
        gw: 11,
        settings: solver,
        onSettings: vi.fn(),
        onSolve: vi.fn(),
        result,
        busy: false,
        onApply: vi.fn(),
        onDetail: vi.fn(),
      }),
    );
    // Advance tree gw to 12 while result stays the same object:
    const movedTree = runCycle(() =>
      OptimiseView({
        data,
        plan,
        gw: 12,
        settings: solver,
        onSettings: vi.fn(),
        onSolve: vi.fn(),
        result,
        busy: false,
        onApply: vi.fn(),
        onDetail: vi.fn(),
      }),
    );
    hooks.enabled = false;
    const movedHtml = renderToStaticMarkup(movedTree);
    expect(movedHtml).toContain("<b>GW12</b><span>Bench Boost</span>");

    viewStateOverrides["optimise.query"] = "NonexistentXYZ";
    const noMatchHtml = renderToStaticMarkup(
      createElement(OptimiseView, {
        data,
        plan,
        gw: 11,
        settings: solver,
        onSettings: vi.fn(),
        onSolve: vi.fn(),
        result: null,
        busy: false,
        onApply: vi.fn(),
        onDetail: vi.fn(),
      }),
    );
    expect(noMatchHtml).toContain("No matching players.");

    viewStateOverrides["optimise.query"] = "Player 16";
    const matchHtml = renderToStaticMarkup(
      createElement(OptimiseView, {
        data,
        plan,
        gw: 11,
        settings: solver,
        onSettings: vi.fn(),
        onSolve: vi.fn(),
        result: null,
        busy: false,
        onApply: vi.fn(),
        onDetail: vi.fn(),
      }),
    );
    expect(matchHtml).toContain("T6 · DEF");
  });

  it("renders Reject when onDiscard is passed, falls back draftLabel to New £100m squad / baselinePlan.name, strips scoped duplicates when removing All GWs, and singularizes max 1 transfer", () => {
    const { data, plan, solver, week11, week12 } = makeSetup();
    data.players[0].gw["11"] = {
      points: 0,
      xmins: 0,
      pplay: 0,
      fixtures: [],
      components: {},
    };
    const result: SolveResult = {
      weeks: [week11, week12],
      objective: 95,
      status: "Optimal",
      gap: 0,
      candidate_count: 60,
      pool_count: 600,
      assumptions: ["Test assumption"],
    };
    const onSettings = vi.fn();
    const html = renderToStaticMarkup(
      createElement(OptimiseView, {
        data,
        plan,
        gw: 11,
        settings: {
          ...solver,
          transfer_limits: { "11": 1 },
          captain_locks: { "11": 1 },
          locked_by_gw: { "12": [5, 16] },
        },
        onSettings,
        onSolve: vi.fn(),
        result,
        busy: false,
        resultFresh: false,
        baselinePlan: plan,
        onApply: vi.fn(),
        onDiscard: vi.fn(),
        onDetail: vi.fn(),
      }),
    );
    expect(html).toContain("Reject");
    // Falls back to baselinePlan.name when sourceName is omitted!
    expect(html).toContain("Draft · Branch A");
    expect(html).toContain("GW11: max 1 transfer</span>");
    expect(html).not.toContain("Squad rules checked");
    expect(html).not.toContain("No chip");
    expect(html).toContain("<small>BB</small>");
    expect(html).toContain("Max transfers");
    expect(html).toContain("GW11 onwards");
    expect(html).toContain("Player 1 · T1");
    expect(html).toContain("GW12: include Player 16");

    // Fresh squad fallback when sourceName is omitted:
    const freshHtml = renderToStaticMarkup(
      createElement(OptimiseView, {
        data,
        plan,
        gw: 11,
        settings: solver,
        onSettings: vi.fn(),
        onSolve: vi.fn(),
        result,
        busy: false,
        resultFresh: true,
        onApply: vi.fn(),
        onDetail: vi.fn(),
      }),
    );
    expect(freshHtml).toContain("Draft · New £100m squad");

    // Removing global All GWs receipt also strips hidden per-GW entry for player 5:
    hooks.enabled = true;
    const tree = runCycle(() =>
      OptimiseView({
        data,
        plan,
        gw: 11,
        settings: {
          ...solver,
          locked: [5],
          locked_by_gw: { "12": [5, 16] },
        },
        onSettings,
        onSolve: vi.fn(),
        result: null,
        busy: false,
        onApply: vi.fn(),
        onDetail: vi.fn(),
      }),
    );
    hooks.enabled = false;
    function findButtons(node: unknown): { props: Record<string, any> }[] {
      if (Array.isArray(node)) return node.flatMap(findButtons);
      if (!node || typeof node !== "object" || !("type" in node)) return [];
      const el = node as { type: unknown; props: Record<string, any> };
      return [
        ...(el.type === "button" ? [el] : []),
        ...findButtons(el.props?.children),
      ];
    }
    const chipBtn = findButtons(tree).find((b) =>
      JSON.stringify(b.props.children).includes("Player 5"),
    )!;
    chipBtn.props.onClick();
    expect(onSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        locked: [],
        locked_by_gw: { "12": [16] },
      }),
    );
  });

  it("wraps benchmark tables in table-container, guards missing generated_at, and marks stale sources orange", () => {
    const { data, plan } = makeSetup();
    viewStateOverrides["plans.section"] = "benchmarks";
    const evalData: Evaluation = {
      available: true,
      models: {
        "Component model": { rmse: 2.1, mae: 1.5, bias: 0.02, count: 500 },
      },
      gameweeks: [{ gw: 1, component: 1.5, form: 1.7, ppg: 1.8, count: 50 }],
      positions: [
        { position: "MID", rmse: 2.2, mae: 1.6, bias: 0, count: 200 },
      ],
      budget_squads: { component: 61.2 },
      captains: { component: 410 },
      appearance: {
        next_gw: {
          pplay: {
            "Component model": {
              log_loss: 0.31,
              brier: 0.1,
              predicted: 0.8,
              observed: 0.8,
              count: 500,
            },
          },
          p60: {},
        },
        by_flag: {},
      },
    };
    const benchmarkHtml = renderToStaticMarkup(
      createElement(AnalysisView, {
        data,
        plans: [plan],
        active: plan,
        evalData,
        prospective: null,
        busy: false,
        selectedGW: 11,
        onSnapshot: vi.fn(),
        onScore: vi.fn(),
        onDetail: vi.fn(),
        onLock: vi.fn(),
        onPlan: vi.fn(),
      }),
    );
    expect(benchmarkHtml).not.toContain("Invalid Date");
    const tableContainers = [
      ...benchmarkHtml.matchAll(/<div class="table-container">/g),
    ];
    expect(tableContainers.length).toBeGreaterThanOrEqual(2);

    viewStateOverrides["plans.section"] = "sources";
    const sourcesHtml = renderToStaticMarkup(
      createElement(AnalysisView, {
        data,
        plans: [plan],
        active: plan,
        evalData,
        prospective: null,
        busy: false,
        selectedGW: 11,
        onSnapshot: vi.fn(),
        onScore: vi.fn(),
        onDetail: vi.fn(),
        onLock: vi.fn(),
        onPlan: vi.fn(),
      }),
    );
    expect(sourcesHtml).toContain('class="source-state orange">stale</span>');
  });

  it("renders MarketView watch star with fill and aria-pressed and places Price signal outside table-footer", () => {
    const { data } = makeSetup();
    const html = renderToStaticMarkup(
      createElement(MarketView, {
        data,
        gw: 11,
        watch: [1],
        onWatch: vi.fn(),
        onDetail: vi.fn(),
      }),
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('fill="currentColor"');
    const footerMatch = html.match(
      /<div class="table-footer">([\s\S]*?)<\/div>\s*<details/,
    );
    expect(footerMatch).not.toBeNull();
    expect(footerMatch![1]).not.toContain("Price signal");
  });
});

describe("PlanInsights and PlanComparisonView fixes", () => {
  it("resolves float-zero sign/color contradictions and renders 4-column Key bets header, Hold -> Plan order, locked aria-pressed, and selected GW highlight", () => {
    expect(round1(-0.02)).toBe(0);
    expect(signed(-0.02)).toBe("0.0");
    expect(deltaClass(-0.02)).toBe("");
    expect(signed(null)).toBe("—");
    expect(deltaClass(null)).toBe("");
    expect(signed(0.12)).toBe("+0.1");
    expect(deltaClass(0.12)).toBe("pi-positive");
    expect(signed(-0.12)).toBe("-0.1");
    expect(deltaClass(-0.12)).toBe("pi-negative");

    const { data, plan } = makeSetup();
    const html = renderToStaticMarkup(
      createElement(PlanInsights, {
        data,
        plan,
        selectedGW: 12,
        lockedIds: [16],
        onDetail: vi.fn(),
        onLock: vi.fn(),
      }),
    );
    expect(html).toContain(
      '<div class="pi-exposure-head"><span>Player</span><span>Copies</span><span>Owned</span><span>xPts</span></div>',
    );
    expect(html.indexOf("Hold initial squad")).toBeLessThan(
      html.indexOf("This plan, net"),
    );
    expect(html).toContain('class="pi-lock active" aria-pressed="true"');
    expect(html).toContain("pi-selected-gw");
  });

  it("fits Y bounds to multi-week plan totals, formats single/range GWs, hides Deselect all for 1 plan, and renders active scatter point last", () => {
    const bounds = comparisonYBounds([312.4, 316.8]);
    expect(bounds.min).toBeGreaterThan(290);
    expect(bounds.min).toBeLessThan(312.4);
    expect(bounds.max).toBeGreaterThan(316.8);
    expect((bounds.max - bounds.min) % 4).toBe(0);

    expect(formatPlanGWs([{ gw: 11 }])).toBe("GW11");
    expect(formatPlanGWs([{ gw: 11 }, { gw: 15 }])).toBe("GW11–15");

    const { plan, week11, week12 } = makeSetup();
    const singleHtml = renderToStaticMarkup(
      createElement(PlanComparisonView, {
        plans: [{ ...plan, weeks: [week11] }],
        activeId: plan.id,
        onPlan: vi.fn(),
      }),
    );
    expect(singleHtml).not.toContain("Deselect all");
    expect(singleHtml).toContain('<span class="sr-only">Compare</span>');
    expect(singleHtml).toContain("<td>GW11</td>");

    viewStateOverrides["plans.comparison"] = "scatter";
    viewStateOverrides["plans.excluded"] = ["plan-a"];
    const planB: Plan = {
      ...plan,
      id: "plan-b",
      name: "Branch B",
      weeks: [week11, { ...week12, net_points: 52, bank: 0.8 }],
    };
    const planC: Plan = {
      ...plan,
      id: "plan-c",
      name: "Branch C",
      weeks: [week11, { ...week12, net_points: 56, bank: 2.1 }],
    };
    const scatterHtml = renderToStaticMarkup(
      createElement(PlanComparisonView, {
        plans: [plan, planB, planC],
        activeId: "plan-b",
        onPlan: vi.fn(),
      }),
    );
    expect(scatterHtml).toContain('viewBox="0 0 460 240"');
    expect(scatterHtml).toContain('r="14" fill="transparent"');
    expect(scatterHtml).toContain('fill="#69cbb3"');
    expect(scatterHtml.indexOf('aria-label="Select Branch C"')).toBeLessThan(
      scatterHtml.indexOf('aria-label="Select Branch B"'),
    );
  });
});

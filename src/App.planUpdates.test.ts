/// <reference types="vite/client" />
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import appSource from "./App.tsx?raw";
import {
  defaultForecastConfiguration,
  defaultSolverSettings,
  solverSettingsForHorizon,
  planValidationRequest,
} from "./planningPersistence";
import { uid, chipNames, planFromSquad } from "./lib";
import { teamPoints } from "./scoring";
import { quickSolveHorizon, planWithOptimisedSuffix } from "./quickOptimise";
import type { Plan, Week, Prospective, SensitivityJob } from "./types";

type History = Record<string, { past: Plan[]; future: Plan[] }>;
type State = {
  plans: Plan[];
  activeId: string;
  gw: number;
  busy: string;
  prospective: Prospective | null;
  selected: number | null;
  tab: string;
  detailId: number | null;
  deletedPlans: Plan[];
  previewingDraft: boolean;
  planHistory: History;
  toast: { text: string; error?: boolean } | null;
};
type Update<T> = T | ((current: T) => T);

// Run the actual App closures with deferred API responses and React-style
// state setters. No DOM, bootstrap requests, timers or shared workspace needed.
const source = ts.createSourceFile(
  "App.tsx",
  appSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const app = source.statements.find(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "App",
)!;
const names = [
  "assertPlanInputs",
  "validatedPlan",
  "updatePlan",
  "travelPlan",
  "scoreProspective",
  "beginOperation",
  "finishOperation",
  "operationMessage",
  "createPlan",
  "startBranchAt",
  "restoreDeleted",
  "importTeam",
  "runSolve",
  "applySolve",
  "applyStress",
  "refresh",
  "snapshot",
  "importPlans",
  "applyChipPlan",
  "applyChipStrategy",
  "clonePlan",
  "deletePlan",
  "reorderPlan",
  "choosePlan",
  "navigateTab",
  "adoptShared",
] as const;
const functions = app.body!.statements.filter(
  (node) =>
    ts.isFunctionDeclaration(node) &&
    names.some((name) => name === node.name!.text),
);
if (functions.length !== names.length) throw new Error("Missing plan actions");
const printer = ts.createPrinter();
const initialEffect = app.body!.statements.find(
  (node) =>
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(source) === "useEffect" &&
    node.expression.arguments[0]
      .getText(source)
      .includes("Building a legal £100m"),
) as ts.ExpressionStatement & { expression: ts.CallExpression };
let cancelTransfer: ts.Expression | undefined;
function findCancel(node: ts.Node) {
  if (
    ts.isJsxAttribute(node) &&
    node.name.getText(source) === "onCancelTransfer" &&
    node.initializer &&
    ts.isJsxExpression(node.initializer)
  )
    cancelTransfer = node.initializer.expression;
  ts.forEachChild(node, findCancel);
}
findCancel(app);
if (!cancelTransfer) throw new Error("Missing transfer cancellation action");
function effectContaining(text: string) {
  const effect = app.body!.statements.find(
    (node) => ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(source) === "useEffect" &&
      node.expression.arguments[0].getText(source).includes(text),
  ) as ts.ExpressionStatement & { expression: ts.CallExpression };
  if (!effect) throw new Error(`Missing App effect: ${text}`);
  return effect.expression.arguments[0].getText(source);
}
const actions = ts.transpileModule(
  `const { plans, active, gw, busy, tab, planHistory, forecastArgs,
    api, teamPoints, planValidationRequest, livePlanningRef, operationRef, operationVersionRef, data,
    settings, solveInFlightRef, solveRequestRef, forecastBaseline, uid, chipNames,
    solverSettingsForHorizon, quickSolveHorizon, planWithOptimisedSuffix, initRef, planFromSquad, setTeamBank, setTeamFT, setModal,
    loadPlanningState, archivePlanningInputs, dataRequestRef, loadedForecastArgsRef,
    applyForecastConfiguration, setSettings, setData, setWatch,
    setActiveId, setTab, setDetailId, setDeletedPlans, setPreviewingDraft,
    pitchExpanded, wideLayout, treeHidden, solveResult, solveContext,
    setSolveResult, setSolveContext, teamId,
    setPlans, setPlanHistory, setBusy, setToast, setGw, setSelected, notify, setProspective
  } = scope;
  ${functions.map((node) => printer.printNode(ts.EmitHint.Unspecified, node, source)).join("\n")}
  return { ${names.join(", ")}, loadForecasts: ${effectContaining("const serialized = JSON.stringify(forecastArgs)")}, rescore: ${effectContaining("const latest = new Map(data.players")}, initialise: ${initialEffect.expression.arguments[0].getText(source)}, cancelTransfer: ${cancelTransfer.getText(source)} };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const createActions = new Function("scope", actions) as (
  scope: object,
) => Record<
  (typeof names)[number] | "initialise" | "cancelTransfer" | "loadForecasts" | "rescore",
  (...args: any[]) => any
> & {
  updatePlan: (
    plan: Plan,
    message?: string,
    remember?: boolean,
    pendingMessage?: string,
  ) => Promise<Plan | boolean>;
  scoreProspective: () => Promise<void>;
  travelPlan: (direction: "past" | "future") => Promise<void>;
};

function branch(id: string, gameweeks = [7, 8, 9]): Plan {
  const squad = Array.from({ length: 15 }, (_, i) => i + 1);
  return {
    id,
    name: id,
    base_squad: squad,
    base_bank: 1,
    free_transfers: 2,
    purchase_prices: { "1": 4.5 },
    created_at: "2026-11-05",
    weeks: gameweeks.map((gw): Week => ({
      gw,
      squad: [...squad],
      starters: [1, 3, 4, 5, 8, 9, 10, 11, 13, 14, 15],
      bench: [2, 6, 7, 12],
      captain: 1,
      vice: 3,
      chip: "none",
      bank: 1,
      free_transfers: 2,
      next_free_transfers: 3,
      hits: 0,
      points: 40,
      net_points: 40,
      transfers_in: [],
      transfers_out: [],
    })),
  };
}

function harness(plans = [branch("A"), branch("B", [12, 13])]) {
  const state: State = {
    plans,
    activeId: plans[0]?.id ?? "",
    gw: plans[0]?.weeks[0].gw ?? 7,
    busy: "",
    prospective: null,
    selected: 3,
    tab: "lineup",
    detailId: 3,
    deletedPlans: [],
    previewingDraft: false,
    planHistory: {},
    toast: { text: "Earlier message" },
  };
  let data = {
    next_gw: 7,
    gameweeks: [7, 8, 9],
    players: branch("A").base_squad.map((id, i) => ({
      id,
      price: 6,
      position_id: i < 2 ? 1 : i < 7 ? 2 : i < 12 ? 3 : 4,
      pplay: 1,
      gw: Object.fromEntries([7, 8, 9].map((gw) => [String(gw), { points: 2, pplay: 1 }])),
    })),
  };
  let forecastArgs = structuredClone(defaultForecastConfiguration);
  const loadedForecastArgsRef = { current: JSON.stringify(forecastArgs) };
  const dataRequestRef = { current: 0 };
  const initRef = { current: null as object | null };
  const solveInFlightRef = { current: false };
  const solveRequestRef = { current: 0 };
  const operationVersionRef = { current: 0 };
  const operationRef = { current: null as symbol | null };
  const livePlanningRef = {
    current: { ...state, data, forecastArgs: defaultForecastConfiguration },
  };
  const requests: {
    path: string;
    body: unknown;
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
  }[] = [];
  const api = vi.fn(
    (path: string, body: unknown) =>
      new Promise<unknown>((resolve, reject) => {
        requests.push({ path, body, resolve, reject });
      }),
  );
  const setter =
    <K extends keyof State>(key: K) =>
    (update: Update<State[K]>) => {
      state[key] =
        typeof update === "function"
          ? (update as (current: State[K]) => State[K])(state[key])
          : update;
    };
  const render = (extra: object = {}) => {
    if ("data" in extra) data = extra.data as typeof data;
    if ("forecastArgs" in extra) forecastArgs = extra.forecastArgs as typeof forecastArgs;
    livePlanningRef.current = {
      ...state,
      data,
      forecastArgs,
    };
    return createActions({
      ...state,
      active:
        state.plans.find((p) => p.id === state.activeId) ?? state.plans[0],
      forecastArgs,
      livePlanningRef,
      loadedForecastArgsRef,
      dataRequestRef,
      teamPoints,
      setData: (update: Update<typeof data>) => {
        data = typeof update === "function" ? update(data) : update;
      },
      operationRef,
      operationVersionRef,
      api,
      data,
      settings: defaultSolverSettings,
      solverSettingsForHorizon,
      quickSolveHorizon,
      planWithOptimisedSuffix,
      initRef,
      planFromSquad,
      setTeamBank: vi.fn(),
      setTeamFT: vi.fn(),
      setModal: vi.fn(),
      solveResult: { weeks: plans[0]?.weeks ?? [] },
      solveContext: { fresh: false, sourcePlan: plans[0], prefix: [] },
      solveInFlightRef,
      solveRequestRef,
      forecastBaseline: () => api("/refresh", {}),
      uid,
      chipNames,
      teamId: "123",
      pitchExpanded: false,
      wideLayout: true,
      treeHidden: false,
      setActiveId: setter("activeId"),
      setTab: setter("tab"),
      setDetailId: setter("detailId"),
      setDeletedPlans: setter("deletedPlans"),
      setPreviewingDraft: setter("previewingDraft"),
      setSolveResult: vi.fn(),
      setSolveContext: vi.fn(),
      planValidationRequest,
      setPlans: setter("plans"),
      setProspective: setter("prospective"),
      setPlanHistory: setter("planHistory"),
      setBusy: setter("busy"),
      setToast: setter("toast"),
      setGw: setter("gw"),
      setSelected: setter("selected"),
      notify: (text: string, error = false) => {
        state.toast = { text, error };
      },
      ...extra,
    });
  };
  return { state, requests, api, render, operationRef, solveInFlightRef, loadedForecastArgsRef, livePlanningRef, get data() { return data; } };
}

describe("deferred plan validation", () => {
  it("keeps a newer name while adopting server weeks and requested resources", async () => {
    const h = harness();
    const before = structuredClone(h.state.plans[0]);
    const candidate = { ...before, base_bank: 2, free_transfers: 4 };
    candidate.weeks = candidate.weeks.map((w) => ({
      ...w,
      captain: 3,
      vice: 1,
    }));
    const pending = h.render().updatePlan(candidate, "Updated.");
    expect(h.state.busy).toBe("Updating plan…");
    expect(h.state.toast).toBeNull();
    expect(h.state.plans[0]).toEqual(before);
    expect(h.state.planHistory).toEqual({});
    expect(h.requests[0]).toMatchObject({
      path: "/plan/validate",
      body: planValidationRequest(candidate, defaultForecastConfiguration),
    });

    h.state.plans = h.state.plans.map((p) => ({
      ...p,
      name: `Renamed ${p.id}`,
    }));
    h.render();
    const weeks = candidate.weeks.map((w) => ({ ...w, bank: 1.7, points: 51 }));
    h.requests[0].resolve({ weeks });
    expect(await pending).toBeTruthy();

    expect(h.state.plans[0]).toEqual({
      ...candidate,
      name: "Renamed A",
      weeks,
    });
    expect(h.state.plans[1].name).toBe("Renamed B");
    expect(h.state.planHistory.A).toEqual({ past: [before], future: [] });
    expect(h.state.busy).toBe("");
    expect(h.state.toast).toEqual({ text: "Updated.", error: false });
  });

  it.each(["past", "future"] as const)(
    "%s completion preserves another plan's current week and selection",
    async (direction) => {
      const h = harness();
      const original = structuredClone(h.state.plans[0]);
      const target = branch("A", [8, 9]);
      target.name = "Old historical name";
      h.state.planHistory = {
        A: { past: [], future: [], [direction]: [target] },
        B: { past: [branch("B")], future: [] },
      };
      const otherHistory = structuredClone(h.state.planHistory.B);
      const pending = h.render().travelPlan(direction);
      expect(h.state.busy).toBe(direction === "past" ? "Undoing…" : "Redoing…");
      h.state.plans = h.state.plans.map((p) =>
        p.id === "A" ? { ...p, name: "New A" } : p,
      );
      h.state.activeId = "B";
      h.state.gw = 13;
      h.state.selected = 5;
      h.render();
      const weeks = target.weeks.map((w) => ({ ...w, bank: 0.6 }));
      h.requests[0].resolve({ weeks });
      await pending;

      expect(h.state.activeId).toBe("B");
      expect(h.state.gw).toBe(13);
      expect(h.state.selected).toBe(5);
      expect(h.state.plans[0]).toEqual({ ...target, name: "New A", weeks });
      expect(h.state.planHistory.A[direction]).toEqual([]);
      expect(
        h.state.planHistory.A[direction === "past" ? "future" : "past"],
      ).toEqual([original]);
      expect(h.state.planHistory.B).toEqual(otherHistory);
      expect(h.state.busy).toBe("");
    },
  );

  it.each(["past", "future"] as const)(
    "%s preserves a newly selected valid week on the same plan",
    async (direction) => {
      const h = harness();
      const target = branch("A", [8, 9]);
      h.state.planHistory.A = { past: [], future: [], [direction]: [target] };
      const pending = h.render().travelPlan(direction);
      h.state.gw = 9;
      h.render();
      h.requests[0].resolve({ weeks: target.weeks });
      await pending;
      expect(h.state.gw).toBe(9);
      expect(h.state.selected).toBeNull();
    },
  );

  it.each(["past", "future"] as const)(
    "%s reconciles an absent week using the canonical response calendar",
    async (direction) => {
      const h = harness();
      // The historical target contains GW7, but the server response does not.
      const target = branch("A");
      h.state.planHistory.A = { past: [], future: [], [direction]: [target] };
      const pending = h.render().travelPlan(direction);
      h.requests[0].resolve({ weeks: target.weeks.slice(1) });
      await pending;
      expect(h.state.gw).toBe(8);
      expect(h.state.plans[0].weeks.map((w) => w.gw)).toEqual([8, 9]);
    },
  );

  it.each(["past", "future"] as const)(
    "%s failure leaves edits/history intact and allows a guarded retry",
    async (direction) => {
      const h = harness();
      const target = branch("A", [8, 9]);
      h.state.planHistory.A = { past: [], future: [], [direction]: [target] };
      const history = structuredClone(h.state.planHistory);
      const pending = h.render().travelPlan(direction);
      const busy = h.render();
      await busy.travelPlan(direction);
      expect(await busy.updatePlan(target)).toBe(false);
      expect(h.api).toHaveBeenCalledTimes(1);
      h.state.plans = h.state.plans.map((p) => ({
        ...p,
        name: `Edited ${p.id}`,
      }));
      const edited = structuredClone(h.state.plans);
      h.render();
      h.requests[0].reject(new Error("Validation unavailable"));
      await pending;
      expect(h.state.plans).toEqual(edited);
      expect(h.state.planHistory).toEqual(history);
      expect(h.state.gw).toBe(7);
      expect(h.state.selected).toBe(3);
      expect(h.state.toast).toEqual({
        text: "Validation unavailable",
        error: true,
      });
      expect(h.state.busy).toBe("");

      const retry = h.render().travelPlan(direction);
      expect(h.api).toHaveBeenCalledTimes(2);
      h.requests[1].resolve({ weeks: target.weeks });
      await retry;
      expect(h.state.plans[0].name).toBe("Edited A");
      expect(h.state.gw).toBe(8);
      expect(h.state.planHistory.A[direction]).toEqual([]);
      expect(h.state.toast?.error).toBe(false);
    },
  );

  it("records a successful retry once, caps undo history and clears redo", async () => {
    const h = harness();
    h.state.planHistory.A = {
      past: Array.from({ length: 30 }, (_, i) => branch(`past-${i}`)),
      future: [branch("redo")],
    };
    const history = structuredClone(h.state.planHistory);
    const candidate = { ...structuredClone(h.state.plans[0]), base_bank: 2 };
    const pending = h.render().updatePlan(candidate);
    h.state.plans = h.state.plans.map((p) => ({ ...p, name: `New ${p.id}` }));
    h.render();
    h.requests[0].reject(new Error("Invalid plan"));
    expect(await pending).toBe(false);
    expect(h.state.planHistory).toEqual(history);
    expect(h.state.plans[0].base_bank).toBe(1);
    expect(h.state.plans[0].name).toBe("New A");
    expect(h.state.busy).toBe("");

    const beforeRetry = structuredClone(h.state.plans[0]);
    const retry = h.render().updatePlan(candidate);
    h.requests[1].resolve({ weeks: candidate.weeks });
    expect(await retry).toBeTruthy();
    expect(h.state.plans[0]).toEqual({ ...candidate, name: "New A" });
    expect(h.state.planHistory.A).toEqual({
      past: [...history.A.past.slice(1), beforeRetry],
      future: [],
    });
  });

  it("round-trips validated decisions through undo/redo without undoing names", async () => {
    const h = harness();
    const previous = branch("A", [7, 8]);
    previous.name = "Historical name";
    const current = { ...branch("A", [8, 9]), base_bank: 2 };
    h.state.plans[0] = current;
    h.state.gw = 9;
    h.state.planHistory.A = { past: [previous], future: [] };
    const undo = h.render().travelPlan("past");
    h.state.plans = h.state.plans.map((p) => ({ ...p, name: "Latest name" }));
    h.render();
    const undoWeeks = previous.weeks.map((w) => ({ ...w, points: 50 }));
    h.requests[0].resolve({ weeks: undoWeeks });
    await undo;
    const undone = { ...previous, name: "Latest name", weeks: undoWeeks };
    expect(h.state.plans[0]).toEqual(undone);
    expect(h.state.planHistory.A).toEqual({ past: [], future: [current] });
    expect(h.state.gw).toBe(7);

    const redo = h.render().travelPlan("future");
    const redoWeeks = current.weeks.map((w) => ({ ...w, points: 60 }));
    h.requests[1].resolve({ weeks: redoWeeks });
    await redo;
    expect(h.state.plans[0]).toEqual({
      ...current,
      name: "Latest name",
      weeks: redoWeeks,
    });
    expect(h.state.planHistory.A).toEqual({ past: [undone], future: [] });
    expect(h.state.gw).toBe(8);
    expect(h.state.busy).toBe("");
    await h.render().travelPlan("future");
    expect(h.api).toHaveBeenCalledTimes(2);
  });
});

describe("operation ownership", () => {
  it("does not let Score weeks unlock validation and lose a newer accepted decision", async () => {
    const h = harness();
    const original = structuredClone(h.state.plans[0]);
    const decisionA = structuredClone(original);
    decisionA.weeks[0].captain = 3;
    decisionA.weeks[0].vice = 1;
    const pendingA = h.render().updatePlan(decisionA);

    // Plans/Benchmarks uses this actual App action. On the old code it
    // completes while A is pending and clears A's global busy message.
    const scoring = h.render().scoreProspective();
    if (h.requests[1]) h.requests[1].resolve({ gameweeks: [] });
    await scoring;
    const pendingLabel = h.state.busy;
    const decisionB = structuredClone(original);
    decisionB.weeks[0].captain = 4;
    const requestCount = h.requests.length;
    const pendingB = h.render().updatePlan(decisionB);
    if (h.requests[requestCount])
      h.requests[requestCount].resolve({ weeks: decisionB.weeks });
    const acceptedB = await pendingB;
    h.render();
    h.requests[0].resolve({ weeks: decisionA.weeks });
    await pendingA;

    expect(pendingLabel).toBe("Updating plan…");
    expect(acceptedB).toBe(false);
    expect(h.requests).toHaveLength(1);
    expect(h.state.plans[0]).toEqual(decisionA);
    expect(h.state.planHistory.A).toEqual({ past: [original], future: [] });

    // Once A finishes, B can be submitted against the accepted plan.
    const retryB = h.render().updatePlan(decisionB);
    h.requests[1].resolve({ weeks: decisionB.weeks });
    await retryB;
    expect(h.state.plans[0]).toEqual(decisionB);
    expect(h.state.planHistory.A).toEqual({
      past: [original, decisionA],
      future: [],
    });
  });
});

function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const stressJob = {
  settings: {
    name: "Stress",
    solve: {
      squad: branch("A").base_squad,
      bank: 1,
      free_transfers: 2,
      purchase_prices: { "1": 4.5 },
      used_chips: [],
    },
  },
} as unknown as SensitivityJob;

describe("adjacent global operations", () => {
  it.each([
    ["scoreProspective", []],
    ["snapshot", []],
    ["refresh", []],
    ["importTeam", []],
    ["importPlans", [{ size: 0, text: vi.fn() }]],
    ["createPlan", []],
    ["startBranchAt", [8]],
    ["restoreDeleted", [branch("deleted")]],
    ["runSolve", []],
    ["applySolve", []],
    ["applyStress", [stressJob, branch("A").weeks, "reference"]],
    ["applyChipPlan", [branch("A"), branch("A").weeks]],
    ["applyChipStrategy", [branch("A"), branch("A").weeks, {}]],
  ] as const)(
    "blocks stale %s callbacks while validation owns the operation",
    async (name, args) => {
      const h = harness();
      const stale = h.render(); // busy was empty in this render
      const pending = stale.updatePlan(h.state.plans[0]);
      const owner = h.operationRef.current;
      await stale[name](...args);
      expect(h.api).toHaveBeenCalledTimes(1);
      expect(h.state.busy).toBe("Updating plan…");
      expect(h.operationRef.current).toBe(owner);
      expect(h.state.planHistory).toEqual({});
      expect(h.state.toast).toBeNull();
      h.requests[0].resolve({ weeks: h.state.plans[0].weeks });
      await pending;
    },
  );

  it("guards two mutations in one render, including structural branch actions", async () => {
    const h = harness();
    const original = structuredClone(h.state.plans);
    const stale = h.render();
    const pending = stale.updatePlan(original[0]);
    expect(await stale.updatePlan({ ...original[0], base_bank: 4 })).toBe(
      false,
    );
    stale.clonePlan();
    stale.deletePlan();
    stale.reorderPlan(1);
    expect(h.api).toHaveBeenCalledTimes(1);
    expect(h.state.plans).toEqual(original);
    expect(h.state.deletedPlans).toEqual([]);
    h.requests[0].reject(new Error("Invalid lineup"));
    await pending;
    expect(h.state.plans).toEqual(original);
    expect(h.state.planHistory).toEqual({});
    expect(h.state.busy).toBe("");
  });

  it("holds ownership through navigation and closing player tools", async () => {
    const h = harness();
    const pending = h.render().updatePlan(h.state.plans[0]);
    h.render().cancelTransfer();
    expect(h.state.selected).toBeNull();
    h.render().navigateTab("analysis");
    h.render().choosePlan("B");
    h.render().navigateTab("lineup");
    expect(h.state.detailId).toBeNull();
    expect(h.state.gw).toBe(12);
    expect(h.state.busy).toBe("Updating plan…");
    expect(await h.render().updatePlan(h.state.plans[1])).toBe(false);
    h.requests[0].resolve({ weeks: h.state.plans[0].weeks });
    await pending;
    expect(h.state.activeId).toBe("B");
    expect(h.state.gw).toBe(12);
    expect(h.state.busy).toBe("");
  });

  it.each(["success", "failure"])(
    "scoring %s cannot overlap another score or plan edit and permits retry",
    async (outcome) => {
      const h = harness();
      const original = structuredClone(h.state.plans);
      const stale = h.render();
      const scoring = stale.scoreProspective();
      await stale.scoreProspective();
      expect(await stale.updatePlan(original[0])).toBe(false);
      expect(h.state.busy).toBe("Scoring completed gameweeks…");
      expect(h.requests).toHaveLength(1);
      if (outcome === "success") h.requests[0].resolve({ gameweeks: [] });
      else h.requests[0].reject(new Error("Scoring unavailable"));
      await scoring;
      expect(h.state.prospective).toEqual(
        outcome === "success" ? { gameweeks: [] } : null,
      );
      expect(h.state.plans).toEqual(original);
      expect(h.state.planHistory).toEqual({});
      expect(h.state.busy).toBe("");
      const retry = h.render().scoreProspective();
      h.requests[1].resolve({ gameweeks: [] });
      await retry;
      expect(h.state.prospective).toEqual({ gameweeks: [] });
      expect(h.state.busy).toBe("");
    },
  );

  it.each(["snapshot", "refresh", "importTeam", "runSolve"] as const)(
    "%s failure releases its operation without changing accepted plans",
    async (name) => {
      const h = harness();
      const original = structuredClone(h.state.plans);
      const pending = h.render()[name](true);
      expect(h.state.busy).not.toBe("");
      expect(await h.render().updatePlan(original[0])).toBe(false);
      h.requests[0].reject(new Error("Request failed"));
      await pending;
      expect(h.state.toast).toEqual({ text: "Request failed", error: true });
      expect(h.state.plans).toEqual(original);
      expect(h.state.planHistory).toEqual({});
      expect(h.state.busy).toBe("");
      expect(h.solveInFlightRef.current).toBe(false);
      const retry = h.render().updatePlan(original[0]);
      h.requests[1].resolve({ weeks: original[0].weeks });
      expect(await retry).toBeTruthy();
    },
  );

  it("owns a pending file read, releases a failed read, and does not read a second import", async () => {
    const h = harness();
    const read = deferred<string>();
    const file = { size: 1, text: vi.fn(() => read.promise) };
    const stale = h.render();
    const pending = stale.importPlans(file);
    await stale.importPlans(file);
    expect(await stale.updatePlan(h.state.plans[0])).toBe(false);
    expect(file.text).toHaveBeenCalledTimes(1);
    expect(h.state.busy).toBe("Checking imported planning branches…");
    expect(h.api).not.toHaveBeenCalled();
    read.reject(new Error("File read failed"));
    await pending;
    expect(h.state.busy).toBe("");
    expect(h.state.planHistory).toEqual({});
    // Parse/size rejection must also release ownership without an API call.
    await h.render().importPlans({ size: 1, text: async () => "{" });
    expect(h.state.busy).toBe("");
    await h.render().importPlans({ size: 5_000_001 });
    expect(h.state.toast).toEqual({
      text: "Plan file is too large.",
      error: true,
    });
    expect(h.state.busy).toBe("");
    expect(h.api).not.toHaveBeenCalled();
    const retry = h.render().updatePlan(h.state.plans[0]);
    h.requests[0].resolve({ weeks: h.state.plans[0].weeks });
    await retry;
  });

  it.each(["applyChipPlan", "applyChipStrategy"] as const)(
    "%s releases ownership on propagated validation failure",
    async (name) => {
      const h = harness();
      const original = structuredClone(h.state.plans);
      const invoke = () =>
        h.render()[name](original[0], original[0].weeks, {
          settings: { auto_chip: "freehit" },
          scope: { gameweeks: [7] },
        });
      const pending = invoke();
      const failed = expect(pending).rejects.toThrow("Invalid branch");
      h.requests[0].reject(new Error("Invalid branch"));
      await failed;
      expect(h.state.busy).toBe("");
      expect(h.state.plans).toEqual(original);
      const retry = invoke();
      const canonical = original[0].weeks.map((w) => ({ ...w, bank: 0.8 }));
      h.requests[1].resolve({ weeks: canonical });
      await retry;
      expect(h.state.plans).toHaveLength(3);
      expect(h.state.plans[2].weeks).toEqual(canonical);
      expect(h.state.plans[2].base_bank).toBe(1);
      expect(h.state.plans[2].purchase_prices).toEqual({ "1": 4.5 });
      expect(h.state.planHistory).toEqual({});
      expect(h.state.busy).toBe("");
    },
  );

  it("does not let an old finalizer or status update release a newer operation", async () => {
    const h = harness();
    const actions = h.render();
    const pending = actions.updatePlan(h.state.plans[0]);
    const oldOwner = h.operationRef.current;
    h.requests[0].reject(new Error("Request aborted"));
    await pending;
    const scoring = h.render().scoreProspective();
    actions.finishOperation(oldOwner);
    actions.operationMessage(oldOwner, "Old message");
    expect(h.state.busy).toBe("Scoring completed gameweeks…");
    h.requests[1].resolve({ gameweeks: [] });
    await scoring;
  });
});

describe("automatic initial squad ownership", () => {
  it("waits for another operation, releases failure, and retries only with new data", async () => {
    const h = harness([]);
    const scoring = h.render().scoreProspective();
    h.render().initialise();
    expect(h.requests).toHaveLength(1);
    h.requests[0].resolve({ gameweeks: [] });
    await scoring;
    h.render().initialise();
    expect(h.requests[1].path).toBe("/optimise");
    expect(h.state.busy).toContain("Building a legal");
    await h.render().scoreProspective();
    expect(h.requests).toHaveLength(2);
    h.requests[1].reject(new Error("Initial solve failed"));
    await vi.waitFor(() => expect(h.state.busy).toBe(""));
    h.render().initialise();
    expect(h.requests).toHaveLength(2); // busy rendering must not cause a retry loop
    // A refreshed Bootstrap object is a new attempt; mimic the new render's data.
    const retry = { ...h.data };
    h.render({ data: retry }).initialise();
    expect(h.requests).toHaveLength(3);
    h.requests[2].reject(new Error("Still unavailable"));
    await vi.waitFor(() => expect(h.state.busy).toBe(""));
    expect(h.state.plans).toEqual([]);
  });

  it("holds ownership until the generated squad receives canonical validation", async () => {
    const h = harness([]);
    h.render().initialise();
    h.requests[0].resolve({ weeks: branch("seed").weeks });
    await vi.waitFor(() => expect(h.requests).toHaveLength(2));
    expect(h.requests[1].path).toBe("/plan/validate");
    await h.render().scoreProspective();
    expect(h.requests).toHaveLength(2);
    expect(h.state.plans).toEqual([]);
    const canonical = branch("server").weeks;
    h.requests[1].resolve({ weeks: canonical });
    await vi.waitFor(() => expect(h.state.busy).toBe(""));
    expect(h.state.plans).toHaveLength(1);
    expect(h.state.plans[0].weeks).toEqual(canonical);
  });
});

describe("background shared-plan adoption", () => {
  it.each(["pending", "success", "failure"])(
    "rejects a reload spanning a %s validation even without an intervening render",
    async (outcome) => {
      const h = harness();
      const original = structuredClone(h.state.plans);
      const reload = deferred<unknown>();
      const load = vi.fn(() => reload.promise);
      const actions = h.render({ loadPlanningState: load });
      const shared = actions.adoptShared({ plans: original }, () => true);
      expect(load).toHaveBeenCalledTimes(1);
      const candidate = { ...original[0], base_bank: 2 };
      const pending = actions.updatePlan(candidate);
      if (outcome === "success") {
        h.requests[0].resolve({ weeks: candidate.weeks });
        await pending;
      } else if (outcome === "failure") {
        h.requests[0].reject(new Error("Validation failed"));
        await pending;
      }
      // The reload must be discarded before it can adopt old plans/resources,
      // even though livePlanningRef still contains the previous render.
      reload.resolve({ plans: original });
      expect(await shared).toBe(false);
      expect(h.state.plans[0].base_bank).toBe(outcome === "success" ? 2 : 1);
      if (outcome === "pending") {
        expect(h.state.busy).toBe("Updating plan…");
        h.requests[0].resolve({ weeks: candidate.weeks });
        await pending;
      }
    },
  );
});

describe("optimiser operation ownership", () => {
  it("keeps the same owner through solve and canonical adoption with one undo record", async () => {
    const h = harness();
    const original = structuredClone(h.state.plans[0]);
    const actions = h.render();
    const pending = actions.runSolve(false, true);
    const owner = h.operationRef.current;
    h.requests[0].resolve({ weeks: original.weeks });
    await vi.waitFor(() => expect(h.requests).toHaveLength(2));
    expect(h.requests[1].path).toBe("/optimise");
    const solved = original.weeks.map((w) => ({ ...w, captain: 3 }));
    h.requests[1].resolve({ weeks: solved });
    await vi.waitFor(() => expect(h.requests).toHaveLength(3));
    expect(h.state.busy).toBe("Checking optimised team…");
    expect(h.operationRef.current).toBe(owner);
    expect(h.requests[2].path).toBe("/plan/validate");
    await actions.scoreProspective();
    expect(await actions.updatePlan(original)).toBe(false);
    expect(h.requests).toHaveLength(3);
    expect(h.state.planHistory).toEqual({});
    const canonical = solved.map((w) => ({
      ...w,
      bank: 0.8,
      hits: 4,
      next_free_transfers: 1,
    }));
    h.requests[2].resolve({ weeks: canonical });
    await pending;
    expect(h.state.plans[0]).toEqual({ ...original, weeks: canonical });
    expect(h.state.planHistory.A).toEqual({ past: [original], future: [] });
    expect(h.state.busy).toBe("");
    expect(h.solveInFlightRef.current).toBe(false);
  });
});

describe("validation forecast/input coherence", () => {
  it.each([
    ["createPlan", []],
    ["restoreDeleted", [branch("deleted")]],
    ["applySolve", []],
    ["applyStress", [stressJob, branch("A").weeks, "reference"]],
    ["applyChipPlan", [branch("A"), branch("A").weeks]],
    [
      "applyChipStrategy",
      [
        branch("A"),
        branch("A").weeks,
        { settings: { auto_chip: "wildcard" }, scope: { gameweeks: [7] } },
      ],
    ],
  ] as const)("rejects input drift during %s adoption", async (name, args) => {
    const h = harness();
    const before = structuredClone(h.state.plans);
    const pending = h
      .render()
      [name](...args)
      .catch((error: Error) => error);
    expect(h.requests[0].path).toBe("/plan/validate");
    h.render({ data: structuredClone(h.data) });
    h.requests[0].resolve({ weeks: before[0].weeks });
    await pending;
    expect(h.state.plans).toEqual(before);
    expect(h.state.activeId).toBe("A");
    expect(h.state.planHistory).toEqual({});
    expect(h.state.busy).toBe("");
  });

  it("does not adopt a future branch built from a receipt preceding an input change", async () => {
    const h = harness();
    const before = structuredClone(h.state.plans);
    const pending = h.render().startBranchAt(8);
    h.requests[0].resolve({
      weeks: before[0].weeks.map((w) => ({
        ...w,
        permanent_squad: w.squad,
        permanent_bank: 0.8,
        purchase_prices: { "1": 4.5 },
      })),
    });
    await vi.waitFor(() => expect(h.requests).toHaveLength(2));
    h.render({ data: structuredClone(h.data) });
    h.requests[1].resolve({ weeks: before[0].weeks.slice(1) });
    await pending;
    expect(h.state.plans).toEqual(before);
    expect(h.state.planHistory).toEqual({});
    expect(h.state.busy).toBe("");
  });

  it("does not adopt an initial squad if inputs change during canonical validation", async () => {
    const h = harness([]);
    h.render().initialise();
    h.requests[0].resolve({ weeks: branch("seed").weeks });
    await vi.waitFor(() => expect(h.requests).toHaveLength(2));
    h.render({ data: structuredClone(h.data) });
    h.requests[1].resolve({ weeks: branch("server").weeks });
    await vi.waitFor(() => expect(h.state.busy).toBe(""));
    expect(h.state.plans).toEqual([]);
    h.render().initialise(); // new data permits the existing automatic retry
    expect(h.requests[2].path).toBe("/optimise");
    h.requests[2].reject(new Error("Unavailable"));
    await vi.waitFor(() => expect(h.state.busy).toBe(""));
  });

  it("does not import a squad whose validation inputs changed", async () => {
    const h = harness();
    const before = structuredClone(h.state.plans);
    const pending = h.render().importTeam();
    h.requests[0].resolve({
      squad: before[0].base_squad,
      bank: 1,
      free_transfers: 2,
      purchase_prices: {},
      name: "Imported",
    });
    await vi.waitFor(() => expect(h.requests).toHaveLength(2));
    h.render({ data: structuredClone(h.data) });
    h.requests[1].resolve({ weeks: before[0].weeks });
    await pending;
    expect(h.state.plans).toEqual(before);
    expect(h.state.activeId).toBe("A");
    expect(h.state.busy).toBe("");
  });

  it("rejects a quick solve receipt after same-config data replacement", async () => {
    const h = harness();
    const before = structuredClone(h.state.plans);
    const pending = h.render().runSolve(false, true);
    h.requests[0].resolve({ weeks: before[0].weeks });
    await vi.waitFor(() => expect(h.requests).toHaveLength(2));
    h.requests[1].resolve({ weeks: before[0].weeks });
    await vi.waitFor(() => expect(h.requests).toHaveLength(3));
    h.render({ data: structuredClone(h.data) });
    h.requests[2].resolve({ weeks: before[0].weeks });
    await pending;
    expect(h.state.plans).toEqual(before);
    expect(h.state.planHistory).toEqual({});
    expect(h.state.busy).toBe("");
  });

  it.each(["before effect", "loading", "failed load"])(
    "rejects changed settings %s without changing resources or history",
    async (phase) => {
      const h = harness();
      const before = structuredClone(h.state.plans);
      h.state.planHistory.A = {
        past: [branch("past")],
        future: [branch("future")],
      };
      const history = structuredClone(h.state.planHistory);
      const candidate = { ...before[0], base_bank: 2 };
      const pending = h.render().updatePlan(candidate);
      const changed = { ...defaultForecastConfiguration, use_market: false };
      const actions = h.render({ forecastArgs: changed });
      if (phase !== "before effect") actions.loadForecasts();
      if (phase === "failed load") {
        h.requests[1].reject(new Error("Offline"));
        await vi.waitFor(() => expect(h.state.toast?.text).toBe("Offline"));
      }
      h.requests[0].resolve({ weeks: candidate.weeks });
      expect(await pending).toBe(false);
      expect(h.state.plans).toEqual(before);
      expect(h.state.planHistory).toEqual(history);
      expect(h.state.busy).toBe("");
      const count = h.requests.length;
      // The current settings still have no matching projections. A retry must
      // not send a validation against the old displayed input data.
      expect(await h.render().updatePlan(candidate)).toBe(false);
      expect(h.requests).toHaveLength(count);
      if (phase === "loading") {
        h.requests[1].resolve({ ...h.data });
        await vi.waitFor(() =>
          expect(h.loadedForecastArgsRef.current).toBe(JSON.stringify(changed)),
        );
      }
    },
  );

  it("invalidates a receipt when new data arrives under unchanged settings", async () => {
    const h = harness();
    const candidate = { ...h.state.plans[0], base_bank: 2 };
    const pending = h.render().updatePlan(candidate);
    h.render({ data: structuredClone(h.data) }).rescore();
    const rescored = structuredClone(h.state.plans);
    h.requests[0].resolve({ weeks: candidate.weeks });
    expect(await pending).toBe(false);
    expect(h.state.plans).toEqual(rescored);
    expect(h.state.planHistory).toEqual({});
    const retry = h.render().updatePlan(candidate);
    h.requests[1].resolve({ weeks: candidate.weeks });
    expect(await retry).toBeTruthy();
    expect(h.state.planHistory.A).toEqual({ past: [rescored[0]], future: [] });
  });

  it.each(["past", "future"] as const)(
    "keeps %s history intact on input drift, then validates the retry once",
    async (direction) => {
      const h = harness();
      const target = branch("A");
      target.weeks[0].captain = 3;
      h.state.planHistory.A = { past: [], future: [], [direction]: [target] };
      const history = structuredClone(h.state.planHistory);
      const pending = h.render().travelPlan(direction);
      h.render({ data: structuredClone(h.data) }).rescore();
      const beforeRetry = structuredClone(h.state.plans[0]);
      h.requests[0].resolve({ weeks: target.weeks });
      await pending;
      expect(h.state.planHistory).toEqual(history);
      expect(h.state.plans[0]).toEqual(beforeRetry);
      const retry = h.render().travelPlan(direction);
      const canonical = target.weeks.map((w) => ({
        ...w,
        bank: 0.7,
        points: 59,
      }));
      h.requests[1].resolve({ weeks: canonical });
      await retry;
      expect(h.state.plans[0].weeks).toEqual(canonical);
      expect(h.state.planHistory.A).toEqual(
        direction === "past"
          ? { past: [], future: [beforeRetry] }
          : { past: [beforeRetry], future: [] },
      );
    },
  );

  it.each(["success", "failure"])(
    "ignores an obsolete validation %s without releasing a newer owner",
    async (outcome) => {
      const h = harness();
      const actions = h.render();
      const original = structuredClone(h.state.plans);
      const pending = actions.updatePlan(
        { ...original[0], base_bank: 2 },
        "Old success",
      );
      actions.finishOperation(h.operationRef.current);
      const newer = actions.beginOperation("New operation");
      h.state.toast = { text: "New feedback" };
      if (outcome === "success")
        h.requests[0].resolve({ weeks: original[0].weeks });
      else h.requests[0].reject(new Error("Old failure"));
      expect(await pending).toBe(false);
      expect(h.state.plans).toEqual(original);
      expect(h.state.planHistory).toEqual({});
      expect(h.operationRef.current).toBe(newer);
      expect(h.state.busy).toBe("New operation");
      expect(h.state.toast).toEqual({ text: "New feedback" });
    },
  );

  it("does not replace F1 scores with a late, valid F0 receipt", async () => {
    const h = harness();
    h.render().rescore();
    expect(h.state.plans[0].weeks[0].points).toBe(24);
    const before = structuredClone(h.state.plans[0]);
    const candidate = {
      ...before,
      base_bank: 2,
      free_transfers: 4,
      weeks: before.weeks.map((w) => ({ ...w, captain: 3, vice: 1 })),
    };
    const pending = h.render().updatePlan(candidate, "Updated.");
    const changed = { ...defaultForecastConfiguration, provider_weight: 0.8 };
    h.render({ forecastArgs: changed }).loadForecasts();
    expect(h.requests[1].path).toBe("/projections");
    const f1 = {
      ...h.data,
      players: h.data.players.map((p) => ({
        ...p,
        gw: Object.fromEntries(
          [7, 8, 9].map((gw) => [String(gw), { points: 5, pplay: 1 }]),
        ),
      })),
    };
    h.requests[1].resolve(f1);
    await vi.waitFor(() => expect(h.data.players[0].gw["7"].points).toBe(5));
    h.render().rescore(); // the actual [data] effect has already run
    expect(h.state.plans[0].weeks[0].points).toBe(60);
    h.requests[0].resolve({ weeks: candidate.weeks });
    expect(await pending).toBe(false);
    expect(h.state.plans[0].weeks[0].points).toBe(60);
    expect(h.state.plans[0].weeks[0].captain).toBe(1);
    expect(h.state.plans[0].base_bank).toBe(1);
    expect(h.state.planHistory).toEqual({});
    expect(h.state.busy).toBe("");
    expect(h.state.toast).toEqual({
      text: "Forecasts changed. Try again.",
      error: true,
    });
    expect(h.livePlanningRef.current.forecastArgs).toEqual(changed);
    const beforeRetry = structuredClone(h.state.plans[0]);
    const retry = h.render().updatePlan(candidate, "Updated.");
    expect(h.requests[2].body).toEqual(
      planValidationRequest(candidate, changed),
    );
    const canonical = candidate.weeks.map((w) => ({
      ...w,
      points: 60,
      net_points: 56,
      hits: 4,
      bank: 1.6,
      next_free_transfers: 1,
      permanent_squad: w.squad,
      permanent_bank: 1.6,
      purchase_prices: { "1": 4.5 },
    }));
    h.requests[2].resolve({ weeks: canonical });
    expect(await retry).toEqual({ ...candidate, weeks: canonical });
    expect(h.state.plans[0]).toEqual({ ...candidate, weeks: canonical });
    expect(h.state.planHistory.A).toEqual({ past: [beforeRetry], future: [] });
  });
});

describe("projection request coherence", () => {
  it("accepts a still-current F0 receipt after settings revert and discards the pending F1 load", async () => {
    const h = harness();
    const original = structuredClone(h.state.plans[0]);
    const candidate = { ...original, base_bank: 2 };
    const pending = h.render().updatePlan(candidate);
    h.render({
      forecastArgs: { ...defaultForecastConfiguration, use_provider: false },
    }).loadForecasts();
    h.render({ forecastArgs: defaultForecastConfiguration }).loadForecasts();
    const canonical = candidate.weeks.map((w) => ({ ...w, points: 24, bank: 1.8 }));
    h.requests[0].resolve({ weeks: canonical });
    expect(await pending).toEqual({ ...candidate, weeks: canonical });
    h.requests[1].resolve({ ...h.data, players: [] });
    await Promise.allSettled(h.api.mock.results.map((r) => r.value));
    expect(h.data.players).toHaveLength(15);
    expect(h.state.plans[0].weeks).toEqual(canonical);
    expect(h.state.planHistory.A).toEqual({ past: [original], future: [] });
  });

  it.each(["success", "failure"])(
    "ignores obsolete %s receipts across repeated edits and reversion to loaded settings",
    async (outcome) => {
      const h = harness();
      const original = h.data;
      const f1 = { ...defaultForecastConfiguration, provider_weight: 0.8 };
      const f2 = { ...defaultForecastConfiguration, provider_weight: 0.2 };
      h.render({ forecastArgs: f1 }).loadForecasts();
      h.render({ forecastArgs: f2 }).loadForecasts();
      h.render({ forecastArgs: defaultForecastConfiguration }).loadForecasts();
      expect(h.requests).toHaveLength(2); // F0 is already loaded
      for (const request of [...h.requests].reverse()) {
        if (outcome === "success")
          request.resolve({ ...original, players: [] });
        else request.reject(new Error("Obsolete error"));
      }
      await Promise.allSettled(h.api.mock.results.map((r) => r.value));
      expect(h.data).toBe(original);
      expect(h.loadedForecastArgsRef.current).toBe(
        JSON.stringify(defaultForecastConfiguration),
      );
      expect(h.state.toast?.text).toBe("Earlier message");
      h.render().rescore();
      expect(h.state.plans[0].weeks.map((w) => w.points)).toEqual([24, 24, 24]);
    },
  );

  it("rejects an obsolete projection before the newer render's effect runs", async () => {
    const h = harness();
    const original = h.data;
    h.render({
      forecastArgs: { ...defaultForecastConfiguration, use_provider: false },
    }).loadForecasts();
    h.render({ forecastArgs: defaultForecastConfiguration });
    h.requests[0].resolve({ ...original, players: [] });
    await Promise.allSettled(h.api.mock.results.map((r) => r.value));
    expect(h.data).toBe(original);
  });

  it("discards a projection receipt after effect cleanup", async () => {
    const h = harness();
    const original = h.data;
    const cleanup = h
      .render({
        forecastArgs: { ...defaultForecastConfiguration, use_provider: false },
      })
      .loadForecasts();
    cleanup();
    h.requests[0].resolve({ ...original, players: [] });
    await Promise.allSettled(h.api.mock.results.map((r) => r.value));
    expect(h.data).toBe(original);
  });
});

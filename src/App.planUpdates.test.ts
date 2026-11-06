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
import { replacePlayer } from "./plannerInteractions";
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
  toast: {
    text: string;
    error?: boolean;
    origin?: Origin;
    action?: { label: string; run: () => Promise<void> };
  } | null;
  busyStatus: { message: string; origin?: Origin };
  detailGW: number;
  detailInline: boolean;
  detailReadOnly: boolean;
  modal: string | null;
};
type Origin = { id: string; name: string; gw: number | null };
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
  "setBusy",
  "planMessage",
  "transferIn",
  "validatedPlan",
  "updatePlan",
  "travelPlan",
  "scoreProspective",
  "canStartOperation",
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
const pendingLabel = app
  .body!.statements.flatMap((node) =>
    ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [],
  )
  .find((node) => node.name.getText(source) === "planBusyLabel")!.initializer!;
const declarations = app.body!.statements.flatMap((node) =>
  ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [],
);
const toastText = declarations.find(
  (node) => node.name.getText(source) === "planToastText",
)!.initializer!;
const notify = declarations.find(
  (node) => node.name.getText(source) === "notify",
)!.initializer!;
let transferCallback: ts.Expression | undefined;
function findTransfer(node: ts.Node) {
  if (
    ts.isJsxAttribute(node) &&
    node.name.getText(source) === "onTransfer" &&
    node.initializer &&
    ts.isJsxExpression(node.initializer) &&
    node.initializer.expression
      ?.getText(source)
      .includes("const ok = await transferIn")
  )
    transferCallback = node.initializer.expression;
  ts.forEachChild(node, findTransfer);
}
findTransfer(app);
if (!transferCallback) throw new Error("Missing transfer completion action");
const reloadEffect = app.body!.statements.find(
  (node) =>
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(source) === "useEffect" &&
    node.expression.arguments[0]
      .getText(source)
      .includes("async function check()"),
) as ts.ExpressionStatement & { expression: ts.CallExpression };
const reloadBody = (reloadEffect.expression.arguments[0] as ts.ArrowFunction)
  .body as ts.Block;
const reloadCheck = reloadBody.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "check",
)!;
const actions = ts.transpileModule(
  `const { plans, active, gw, busy, tab, planHistory, forecastArgs,
    api, teamPoints, planValidationRequest, livePlanningRef, operationRef, operationVersionRef, renderedOperationVersion, data,
    settings, solveInFlightRef, solveRequestRef, forecastBaseline, uid, chipNames,
    solverSettingsForHorizon, quickSolveHorizon, planWithOptimisedSuffix, initRef, planFromSquad, setTeamBank, setTeamFT, setModal,
    loadPlanningState, archivePlanningInputs, dataRequestRef, loadedForecastArgsRef,
    applyForecastConfiguration, setSettings, setData, setWatch,
    setActiveId, setTab, setDetailId, setDeletedPlans, setPreviewingDraft,
    pitchExpanded, wideLayout, treeHidden, solveResult, solveContext,
    setSolveResult, setSolveContext, teamId, restoreDeletedRef, setEvalData,
    setPlans, setPlanHistory, setBusyStatus, setToast, setGw, setSelected, setProspective,
    lookup, selected, detailId, playerGW, detailInline, replacePlayer,
    transferView, liveTransferViewRef, busyStatus, toast, feedbackSurfaceRef
  } = scope;
  const notify = ${printer.printNode(ts.EmitHint.Expression, notify, source)};
  ${functions.map((node) => printer.printNode(ts.EmitHint.Unspecified, node, source)).join("\n")}
  const backgroundCheck = (() => {
    let alive = true;
    let checking = false;
    ${printer.printNode(ts.EmitHint.Unspecified, reloadCheck, source)}
    return check;
  })();
  const transferCallback = ${printer.printNode(ts.EmitHint.Expression, transferCallback, source)};
  return { loadForecasts: ${effectContaining("const serialized = JSON.stringify(forecastArgs)")}, rescore: ${effectContaining("const latest = new Map(data.players")}, backgroundCheck, pendingLabel: () => ${printer.printNode(ts.EmitHint.Expression, pendingLabel, source)},
    toastText: () => ${printer.printNode(ts.EmitHint.Expression, toastText, source)}, transferCallback, ${names.join(", ")}, initialise: ${initialEffect.expression.arguments[0].getText(source)}, cancelTransfer: ${cancelTransfer.getText(source)} };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const createActions = new Function("scope", actions) as (
  scope: object,
) => Record<
  | (typeof names)[number]
  | "initialise"
  | "cancelTransfer"
  | "transferCallback"
  | "backgroundCheck"
  | "loadForecasts"
  | "rescore",
  (...args: any[]) => any
> & {
  updatePlan: (
    plan: Plan,
    message?: string,
    remember?: boolean,
    pendingMessage?: string,
    atGW?: number | null,
  ) => Promise<Plan | boolean>;
  pendingLabel: () => string;
  toastText: () => string | undefined;
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
    busyStatus: { message: "" },
    prospective: null,
    selected: 3,
    tab: "projections",
    detailId: 2,
    detailGW: plans[0]?.weeks[0].gw ?? 7,
    detailInline: false,
    detailReadOnly: false,
    modal: null,
    deletedPlans: [],
    previewingDraft: false,
    planHistory: {},
    toast: { text: "Earlier message" },
  };
  let data = {
    loaded_at: "2026-11-05T12:00:00Z",
    next_gw: 7,
    gameweeks: [7, 8, 9],
    players: Array.from({ length: 16 }, (_, i) => i + 1).map((id, i) => ({
      name: `Player ${id}`,
      id,
      price: 6,
      position_id: i < 2 || id === 16 ? 1 : i < 7 ? 2 : i < 12 ? 3 : 4,
      pplay: 1,
      gw: Object.fromEntries([7, 8, 9].map((gw) => [String(gw), { points: 2, pplay: 1 }])),
    })),
  };
  let forecastArgs = structuredClone(defaultForecastConfiguration);
  const loadedForecastArgsRef = { current: JSON.stringify(forecastArgs) };
  const dataRequestRef = { current: 0 };
  const restoreDeletedRef = { current: (_plan: Plan) => Promise.resolve() };
  const initRef = { current: null as object | null };
  const solveInFlightRef = { current: false };
  const solveRequestRef = { current: 0 };
  const operationVersionRef = { current: 0 };
  const operationRef = { current: null as symbol | null };
  const livePlanningRef = {
    current: {
      ...state,
      data,
      forecastArgs,
      renderedOperationVersion: operationVersionRef.current,
    },
  };
  const liveTransferViewRef = { current: {} };
  const feedbackSurfaceRef = {
    current: null as { gw: number; readOnly: boolean } | null,
  };
  let viewKey = "";
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
    if (state.busy !== state.busyStatus.message)
      state.busyStatus = { message: state.busy };
    feedbackSurfaceRef.current =
      state.detailId === null
        ? null
        : { gw: state.detailGW || state.gw, readOnly: state.detailReadOnly };
    const nextKey = JSON.stringify([
      state.activeId,
      state.gw,
      state.tab,
      state.detailId,
      state.detailGW,
      state.detailInline,
      state.modal,
    ]);
    if (nextKey !== viewKey) {
      viewKey = nextKey;
      liveTransferViewRef.current = {};
    }

    livePlanningRef.current = {
      ...state,
      data,
      forecastArgs,
      renderedOperationVersion: operationVersionRef.current,
    };
    const actions = createActions({
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
      renderedOperationVersion: operationVersionRef.current,
      transferView: liveTransferViewRef.current,
      liveTransferViewRef,
      feedbackSurfaceRef,
      lookup: new Map(data.players.map((p) => [p.id, p])),
      playerGW: state.detailGW || state.gw,
      replacePlayer,
      api,
      data,
      settings: defaultSolverSettings,
      solverSettingsForHorizon,
      quickSolveHorizon,
      planWithOptimisedSuffix,
      initRef,
      restoreDeletedRef,
      planFromSquad,
      setTeamBank: vi.fn(),
      setTeamFT: vi.fn(),
      setModal: setter("modal"),
      solveResult: { weeks: plans[0]?.weeks ?? [] },
      solveContext: { fresh: false, sourcePlan: plans[0], prefix: [] },
      solveInFlightRef,
      solveRequestRef,
      forecastBaseline: () => api("/refresh", {}),
      archivePlanningInputs: vi.fn(),
      applyForecastConfiguration: vi.fn(),
      setSettings: vi.fn(),
      setWatch: vi.fn(),
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
      setEvalData: vi.fn(),
      setSolveResult: vi.fn(),
      setSolveContext: vi.fn(),
      planValidationRequest,
      setPlans: setter("plans"),
      setProspective: setter("prospective"),
      setPlanHistory: setter("planHistory"),
      setBusyStatus: (update: Update<State["busyStatus"]>) => {
        setter("busyStatus")(update);
        state.busy = state.busyStatus.message;
      },
      setToast: setter("toast"),
      setGw: setter("gw"),
      setSelected: setter("selected"),
      ...extra,
    });
    restoreDeletedRef.current = actions.restoreDeleted;
    return actions;
  };
  return { state, requests, api, render, operationRef, solveInFlightRef, loadedForecastArgsRef, livePlanningRef, get data() { return data; } };
}

describe("deferred plan validation", () => {
  it.each(["week", "draft preview"])(
    "keeps toast context when a player surface changes its %s",
    async (change) => {
      const h = harness();
      const pending = h.render().updatePlan(h.state.plans[0], "Updated.");
      h.requests[0].resolve({ weeks: h.state.plans[0].weeks });
      await pending;
      expect(h.render().toastText()).toBe("Updated.");
      const toast = h.state.toast;
      if (change === "week") h.state.detailGW = 8;
      else h.state.detailReadOnly = true;
      expect(h.render().toastText()).toBe("A · GW7: Updated.");
      h.state.detailId = null;
      expect(h.render().toastText()).toBe("Updated.");
      expect(h.state.toast).toBe(toast);
    },
  );
  it("keeps scoring global after a source-attributed edit blocks its stale callback", async () => {
    const h = harness();
    const stale = h.render();
    const edit = stale.updatePlan(h.state.plans[0], "Updated.");
    h.state.activeId = "B";
    h.state.gw = 13;
    await stale.scoreProspective();
    expect(h.requests).toHaveLength(1);
    expect(h.render().pendingLabel()).toBe("A · GW7: Updating plan…");
    h.requests[0].resolve({ weeks: h.state.plans[0].weeks });
    await edit;
    expect(h.render().toastText()).toBe("A · GW7: Updated.");
    const score = h.render().scoreProspective();
    expect(h.render().pendingLabel()).toBe("Scoring completed gameweeks…");
    expect(h.state.busyStatus.origin).toBeUndefined();
    expect(h.requests[1].path).toBe("/prospective/score");
    h.requests[1].resolve({ gameweeks: [] });
    await score;
    expect(h.render().toastText()).toBe(
      "No captured gameweek has finished yet. Your pre-deadline snapshots are preserved.",
    );
    expect(h.state.toast?.origin).toBeUndefined();
  });
  it.each(["success", "failure"])(
    "attributes a settled %s toast after later navigation",
    async (outcome) => {
      const h = harness();
      const pending = h.render().updatePlan(h.state.plans[0], "Updated.");
      if (outcome === "success")
        h.requests[0].resolve({ weeks: h.state.plans[0].weeks });
      else h.requests[0].reject(new Error("Validation unavailable"));
      await pending;
      const message =
        outcome === "success" ? "Updated." : "Validation unavailable";
      expect(h.render().toastText()).toBe(message);
      const toast = h.state.toast;
      h.state.activeId = "B";
      h.state.gw = 13;
      expect(h.render().toastText()).toBe(`A · GW7: ${message}`);
      h.state.plans[0].name = "Renamed A";
      expect(h.render().toastText()).toBe(`Renamed A · GW7: ${message}`);
      h.state.activeId = "A";
      h.state.gw = 7;
      expect(h.render().toastText()).toBe(message);
      expect(h.state.toast).toBe(toast);
    },
  );
  it("attributes pending and completed feedback to the renamed source after navigation", async () => {
    const h = harness();
    h.state.gw = h.state.detailGW = 9;
    const pending = h
      .render()
      .updatePlan(h.state.plans[0], "Updated.", true, "Updating lineup…");
    expect(h.render().pendingLabel()).toBe("Updating lineup…");
    h.state.activeId = "B";
    h.state.gw = 13;
    h.state.plans[0].name = "Renamed A";
    expect(h.render().pendingLabel()).toBe("Renamed A · GW9: Updating lineup…");
    h.requests[0].resolve({ weeks: h.state.plans[0].weeks });
    await pending;
    expect(h.render().toastText()).toBe("Renamed A · GW9: Updated.");
    expect(h.render().pendingLabel()).toBe("");
  });
  it("distinguishes another week while keeping same-view feedback short", async () => {
    const h = harness();
    const pending = h.render().updatePlan(h.state.plans[0], "Updated.");
    h.state.gw = 8;
    expect(h.render().pendingLabel()).toBe("A · GW7: Updating plan…");
    h.state.gw = 7;
    expect(h.render().pendingLabel()).toBe("Updating plan…");
    h.requests[0].resolve({ weeks: h.state.plans[0].weeks });
    await pending;
    expect(h.state.toast?.text).toBe("Updated.");
  });
  it("labels plan-wide history feedback without assigning it to an unrelated week", async () => {
    const h = harness();
    const target = branch("A", [7]);
    h.state.planHistory.A = { past: [], future: [target] };
    const pending = h.render().travelPlan("future");
    h.state.activeId = "B";
    h.state.gw = 13;
    expect(h.render().pendingLabel()).toBe("A: Redoing…");
    h.requests[0].resolve({ weeks: target.weeks });
    await pending;
    expect(h.render().toastText()).toBe("A: Change restored.");
    expect(h.state.gw).toBe(13);
  });
  it("keeps the source identity on a rejected operation after navigation", async () => {
    const h = harness();
    const pending = h.render().updatePlan(h.state.plans[0]);
    h.state.activeId = "B";
    h.state.gw = 13;
    h.render();
    h.requests[0].reject(new Error("Temporary failure"));
    expect(await pending).toBe(false);
    expect(h.render().toastText()).toBe("A · GW7: Temporary failure");
    expect(h.state.toast?.error).toBe(true);
    expect(h.render().pendingLabel()).toBe("");
    expect(h.state.planHistory).toEqual({});
  });
  it.each(["branch", "week", "player", "reopened player"])(
    "keeps newer %s navigation after an accepted transfer",
    async (navigation) => {
      const h = harness();
      h.state.gw = h.state.detailGW = 9;
      const beforeB = structuredClone(h.state.plans[1]);
      const pending = h.render().transferCallback(16);
      if (navigation === "branch") {
        h.state.activeId = "B";
        h.state.gw = 13;
      } else if (navigation === "week") h.state.gw = 8;
      else if (navigation === "player") h.state.detailId = 5;
      else {
        h.state.detailId = null;
        h.render();
        h.state.detailId = 2;
      }
      h.state.selected = 5;
      h.render();
      const view = {
        id: h.state.activeId,
        gw: h.state.gw,
        detail: h.state.detailId,
        tab: h.state.tab,
      };
      const request = h.requests[0].body as { weeks: Week[] };
      h.requests[0].resolve({ weeks: request.weeks });
      expect(await pending).toBe(true);
      expect({
        id: h.state.activeId,
        gw: h.state.gw,
        detail: h.state.detailId,
        tab: h.state.tab,
      }).toEqual(view);
      expect(h.state.selected).toBe(5);
      expect(h.state.plans[1]).toEqual(beforeB);
      expect(h.state.plans[0].weeks.find((w) => w.gw === 9)?.squad).toContain(
        16,
      );
      expect(h.state.planHistory.A.past).toHaveLength(1);
    },
  );
  it("closes the original transfer surface after success despite ordinary rerenders", async () => {
    const h = harness();
    h.state.detailGW = 9;
    const pending = h.render().transferCallback(16);
    h.state.plans[0].name = "New name";
    h.render();
    const request = h.requests[0].body as { weeks: Week[] };
    h.requests[0].resolve({ weeks: request.weeks });
    expect(await pending).toBe(true);
    expect(h.state.detailId).toBeNull();
    expect(h.state.tab).toBe("lineup");
    expect(h.state.gw).toBe(9);
    expect(h.state.selected).toBeNull();
    expect(h.state.plans[0].name).toBe("New name");
  });
  it("retains a failed transfer surface and permits retry", async () => {
    const h = harness();
    const before = structuredClone(h.state.plans);
    const pending = h.render().transferCallback(16);
    h.requests[0].reject(new Error("Temporary validation failure"));
    expect(await pending).toBe(false);
    expect(h.state.plans).toEqual(before);
    expect(h.state.detailId).toBe(2);
    expect(h.state.tab).toBe("projections");
    expect(h.state.planHistory).toEqual({});
    const retry = h.render().transferCallback(16);
    const request = h.requests[1].body as { weeks: Week[] };
    h.requests[1].resolve({ weeks: request.weeks });
    expect(await retry).toBe(true);
    expect(h.state.detailId).toBeNull();
    expect(h.state.planHistory.A.past).toHaveLength(1);
  });
  it("keeps a newer name while adopting server weeks and requested resources", async () => {
    const h = harness();
    const before = structuredClone(h.state.plans[0]);
    const candidate = { ...before, base_bank: 2, free_transfers: 4 };
    candidate.weeks = candidate.weeks.map((w) => ({
      ...w,
      captain: 2,
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
    expect(h.render().toastText()).toBe("Updated.");
    expect(h.state.toast?.error).toBe(false);
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
      expect(h.render().toastText()).toBe("Validation unavailable");
      expect(h.state.toast?.error).toBe(true);
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

  it("rejects callbacks from before an accepted edit even after its owner finishes", async () => {
    const h = harness();
    const original = structuredClone(h.state.plans);
    const stale = h.render();
    const candidate = structuredClone(original[0]);
    candidate.weeks[0].captain = 3;
    const edit = stale.updatePlan(candidate);
    h.requests[0].resolve({ weeks: candidate.weeks });
    await edit;
    // No intervening render: the ref alone is empty, but these closures
    // still carry decisions/history from before the accepted edit.
    expect(await stale.updatePlan(original[0])).toBe(false);
    stale.clonePlan();
    stale.deletePlan();
    stale.reorderPlan(1);
    await stale.refresh();
    await stale.scoreProspective();
    expect(h.requests).toHaveLength(1);
    expect(h.state.plans).toEqual([candidate, original[1]]);
    expect(h.state.planHistory.A).toEqual({ past: [original[0]], future: [] });
    expect(h.state.busyStatus).toEqual({ message: "", origin: undefined });
    // A fresh callback uses the accepted decisions and remains usable.
    const retry = h.render().updatePlan({ ...candidate, base_bank: 2 });
    h.requests[1].resolve({ weeks: candidate.weeks });
    await retry;
    expect(h.state.plans[0].base_bank).toBe(2);
  });

  it("invalidates same-render structural actions before they can restore deleted data", () => {
    const h = harness();
    const stale = h.render();
    stale.clonePlan();
    const accepted = structuredClone(h.state.plans);
    stale.deletePlan();
    stale.reorderPlan(1);
    expect(h.state.plans).toEqual(accepted);
    expect(h.state.deletedPlans).toEqual([]);
  });

  it("keeps current callbacks usable after an unavailable reorder", async () => {
    const h = harness();
    const actions = h.render();
    actions.reorderPlan(-1);
    const edit = actions.updatePlan(h.state.plans[0]);
    expect(h.requests).toHaveLength(1);
    h.requests[0].resolve({ weeks: h.state.plans[0].weeks });
    expect(await edit).toBeTruthy();
  });

  it("uses current ownership for a deleted-plan toast's later Undo action", async () => {
    const h = harness();
    const original = structuredClone(h.state.plans[0]);
    h.render().deletePlan();
    const undo = h.state.toast?.action;
    expect(undo?.label).toBe("Undo");
    h.render(); // React commits the deletion and refreshes the toast action's ref
    const restore = undo!.run();
    expect(h.requests[0].path).toBe("/plan/validate");
    expect(h.state.busy).toBe("Restoring plan…");
    h.requests[0].resolve({ weeks: original.weeks });
    await restore;
    expect(h.state.plans).toContainEqual(original);
    expect(h.state.deletedPlans).toEqual([]);
    expect(h.state.busy).toBe("");
  });

  it("keeps the source on a phase update and rejects an older owner's messages", async () => {
    const h = harness();
    const actions = h.render();
    const origin = { id: "A", name: "A", gw: 7 };
    const owner = actions.beginOperation("Checking…", origin);
    actions.operationMessage(owner, "Still checking…");
    h.state.activeId = "B";
    h.state.gw = 13;
    expect(h.render().pendingLabel()).toBe("A · GW7: Still checking…");
    actions.finishOperation(owner);
    const newer = h.render().updatePlan(h.state.plans[1]);
    actions.operationMessage(owner, "Old global message");
    actions.finishOperation(owner);
    expect(h.state.busyStatus.origin?.id).toBe("B");
    expect(h.state.busy).toBe("Updating plan…");
    h.requests[0].resolve({ weeks: h.state.plans[1].weeks });
    await newer;
    expect(h.state.busyStatus.origin).toBeUndefined();
  });

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
  it.each(["shared", "periodic"])(
    "does not start a %s reload from an old snapshot after an edit settles",
    async (kind) => {
      const h = harness();
      const load = vi.fn();
      const actions = h.render({ loadPlanningState: load });
      const candidate = { ...h.state.plans[0], base_bank: 3 };
      const edit = actions.updatePlan(candidate);
      h.requests[0].resolve({ weeks: candidate.weeks });
      await edit;
      // The accepted state has not reached livePlanningRef yet. Starting a
      // reload now would otherwise treat the old plan as the current one.
      if (kind === "shared")
        expect(
          await actions.adoptShared({ plans: [candidate] }, () => true),
        ).toBe(false);
      else await actions.backgroundCheck();
      expect(load).not.toHaveBeenCalled();
      expect(h.requests).toHaveLength(1);
      expect(h.state.plans[0].base_bank).toBe(3);
    },
  );

  it("invalidates prior callbacks when a clean shared reload adopts newer decisions", async () => {
    const h = harness();
    const original = structuredClone(h.state.plans);
    const candidate = { ...original[0], base_bank: 3 };
    const adopt = vi.fn();
    const actions = h.render({
      loadPlanningState: async () => ({
        plans: [candidate, original[1]],
        activeId: "A",
        gw: 7,
        forecast: h.data,
        configuration: defaultForecastConfiguration,
        solver: defaultSolverSettings,
      }),
      applyForecastConfiguration: adopt,
    });
    expect(
      await actions.adoptShared(
        { plans: [candidate, original[1]] },
        () => true,
      ),
    ).toBe(true);
    expect(adopt).toHaveBeenCalledOnce();
    const staleEdit = actions.updatePlan(original[0]);
    expect(h.requests).toHaveLength(0);
    expect(await staleEdit).toBe(false);
    expect(h.state.plans[0].base_bank).toBe(3);
    const edit = h.render().updatePlan({ ...candidate, base_bank: 4 });
    h.requests[0].resolve({ weeks: candidate.weeks });
    await edit;
    expect(h.state.plans[0].base_bank).toBe(4);
  });

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

describe("periodic reload ownership", () => {
  it.each(["pending", "success", "failure"])(
    "discards a periodic reload spanning a %s edit before another render",
    async (outcome) => {
      const h = harness();
      const original = structuredClone(h.state.plans);
      const reload = deferred<unknown>();
      const load = vi.fn(() => reload.promise);
      const adopt = vi.fn();
      const actions = h.render({
        loadPlanningState: load,
        dataRequestRef: { current: 0 },
        applyForecastConfiguration: adopt,
      });
      const background = actions.backgroundCheck();
      h.requests[0].resolve({ loaded_at: "2026-11-06T12:00:00Z" });
      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
      const candidate = { ...original[0], base_bank: 2 };
      const edit = actions.updatePlan(candidate);
      if (outcome === "success") {
        h.requests[1].resolve({ weeks: candidate.weeks });
        await edit;
      } else if (outcome === "failure") {
        h.requests[1].reject(new Error("Validation failed"));
        await edit;
      }
      reload.resolve({
        plans: original,
        activeId: "A",
        gw: 7,
        forecast: h.data,
        configuration: defaultForecastConfiguration,
        solver: defaultSolverSettings,
        notices: [],
      });
      await background;
      expect(adopt).not.toHaveBeenCalled();
      expect(h.state.plans[0].base_bank).toBe(outcome === "success" ? 2 : 1);
      if (outcome === "pending") {
        expect(h.state.busy).toBe("Updating plan…");
        h.requests[1].resolve({ weeks: candidate.weeks });
        await edit;
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
  it.each(["configuration", "same-config dataset"])(
    "rejects a transfer after %s drift and retries without losing names, views or ownership",
    async (drift) => {
      const h = harness();
      h.state.detailId = 1;
      h.state.selected = 1;
      const stale = h.render();
      const pending = stale.transferCallback(16);
      const original = structuredClone(h.state.plans);
      h.state.plans[0] = { ...h.state.plans[0], name: "Renamed source" };
      h.state.activeId = "B";
      h.state.gw = h.state.detailGW = 13;
      h.state.detailId = 9;
      h.state.selected = 10;
      h.state.tab = "market";
      const projections = {
        ...h.data,
        players: h.data.players.map((p) => ({
          ...p,
          gw: Object.fromEntries(
            [7, 8, 9].map((gw) => [String(gw), { points: 5, pplay: 1 }]),
          ),
        })),
      };
      const configuration = drift === "configuration"
        ? { ...defaultForecastConfiguration, provider_weight: 0.8 }
        : defaultForecastConfiguration;
      if (drift === "configuration") {
        h.render({ forecastArgs: configuration }).loadForecasts();
        h.requests[1].resolve(projections);
        await vi.waitFor(() => expect(h.data.players[0].gw["7"].points).toBe(5));
      } else h.render({ data: projections });
      h.render().rescore();
      const rescored = structuredClone(h.state.plans);
      const requestCount = h.requests.length;
      await h.render().scoreProspective();
      expect(h.requests).toHaveLength(requestCount);
      expect(h.render().pendingLabel()).toBe("Renamed source · GW7: Updating plan…");
      h.requests[0].resolve({ weeks: original[0].weeks });
      await pending;
      expect(h.state.plans).toEqual(rescored);
      expect(h.state.planHistory).toEqual({});
      expect(h.render().toastText()).toBe("Renamed source · GW7: Forecasts changed. Try again.");
      expect(h.state).toMatchObject({
        activeId: "B", gw: 13, detailId: 9, selected: 10, tab: "market", busy: "",
      });

      h.state.activeId = "A";
      h.state.gw = h.state.detailGW = 7;
      h.state.detailId = h.state.selected = 1;
      const beforeRetry = structuredClone(h.state.plans[0]);
      const retry = h.render().transferCallback(16);
      const candidate = replacePlayer(beforeRetry, 7, 1, 16);
      expect(h.requests[requestCount].body).toEqual(planValidationRequest(candidate, configuration));
      const canonical = candidate.weeks.map((w) => ({ ...w, bank: 0.7, points: 61, net_points: 57, hits: 4 }));
      h.state.plans[0] = { ...h.state.plans[0], name: "Latest source" };
      h.state.activeId = "B";
      h.state.gw = h.state.detailGW = 13;
      h.state.detailId = 9;
      h.state.selected = 10;
      h.render();
      h.requests[requestCount].resolve({ weeks: canonical });
      await retry;
      expect(h.state.plans[0]).toEqual({ ...candidate, name: "Latest source", weeks: canonical });
      expect(h.state.plans[1]).toEqual(rescored[1]);
      expect(h.state.planHistory.A).toEqual({ past: [beforeRetry], future: [] });
      expect(h.state).toMatchObject({
        activeId: "B", gw: 13, detailId: 9, selected: 10, tab: "market", busy: "",
      });
      expect(h.render().toastText()).toBe("Latest source · GW7: Player 1 → Player 16.");
      await stale.scoreProspective();
      expect(h.requests).toHaveLength(requestCount + 1);
    },
  );

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
      const edited = structuredClone(original[1]);
      edited.weeks[0].captain = 3;
      const accepted = h.render().updatePlan(edited, "Accepted edit");
      h.requests[1].resolve({ weeks: edited.weeks });
      expect(await accepted).toEqual(edited);
      const plans = structuredClone(h.state.plans);
      const history = structuredClone(h.state.planHistory);
      const newer = h.render().scoreProspective();
      const owner = h.operationRef.current;
      expect(owner).not.toBeNull();
      h.state.toast = { text: "New feedback" };
      if (outcome === "success")
        h.requests[0].resolve({ weeks: original[0].weeks });
      else h.requests[0].reject(new Error("Old failure"));
      expect(await pending).toBe(false);
      expect(h.state.plans).toEqual(plans);
      expect(h.state.planHistory).toEqual(history);
      expect(h.operationRef.current).toBe(owner);
      expect(h.state.busy).toBe("Scoring completed gameweeks…");
      expect(h.state.busyStatus.origin).toBeUndefined();
      expect(h.state.toast).toEqual({ text: "New feedback" });
      h.requests[2].resolve({ gameweeks: [] });
      await newer;
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
      origin: { id: "A", name: "A", gw: 7 },
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
  it.each(["success", "failure"])(
    "ignores an obsolete %s even when rapid reversion requests the same configuration again",
    async (outcome) => {
      const h = harness();
      const original = h.data;
      const changed = { ...defaultForecastConfiguration, provider_weight: 0.8 };
      h.render({ forecastArgs: changed }).loadForecasts();
      h.render({ forecastArgs: defaultForecastConfiguration }).loadForecasts();
      h.render({ forecastArgs: changed }).loadForecasts();
      expect(h.requests).toHaveLength(2);
      if (outcome === "success") h.requests[0].resolve({ ...original, players: [] });
      else h.requests[0].reject(new Error("Obsolete load failed"));
      await h.api.mock.results[0].value.catch(() => {});
      await Promise.resolve(); // flush the load's guarded error callback
      expect(h.data).toBe(original);
      expect(h.loadedForecastArgsRef.current).toBe(JSON.stringify(defaultForecastConfiguration));
      expect(h.state.toast?.text).toBe("Earlier message");
      const latest = { ...original, loaded_at: "2026-11-06T15:00:00Z" };
      h.requests[1].resolve(latest);
      await vi.waitFor(() => expect(h.data.loaded_at).toBe(latest.loaded_at));
      expect(h.loadedForecastArgsRef.current).toBe(JSON.stringify(changed));
      expect(h.data.players).toEqual(original.players);
    },
  );

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
    expect(h.data.players).toHaveLength(16);
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

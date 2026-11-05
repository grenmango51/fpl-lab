/// <reference types="vite/client" />
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import appSource from "./App.tsx?raw";
import {
  defaultForecastConfiguration,
  planValidationRequest,
} from "./planningPersistence";
import type { Plan, Week } from "./types";
import { replacePlayer } from "./plannerInteractions";

type History = Record<string, { past: Plan[]; future: Plan[] }>;
type State = {
  plans: Plan[];
  activeId: string;
  gw: number;
  busy: string;
  selected: number | null;
  planHistory: History;
  toast: { text: string; error?: boolean } | null;
  tab: string;
  detailId: number | null;
  detailGW: number;
  detailInline: boolean;
  modal: string | null;
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
const names = ["validatedPlan", "updatePlan", "travelPlan", "transferIn"];
const functions = app.body!.statements.filter(
  (node) => ts.isFunctionDeclaration(node) && names.includes(node.name!.text),
);
if (functions.length !== names.length) throw new Error("Missing plan actions");
const printer = ts.createPrinter();
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
const actions = ts.transpileModule(
  `const { plans, active, gw, busy, planHistory, forecastArgs,
    api, planValidationRequest, livePlanningRef,
    setPlans, setPlanHistory, setBusy, setToast, setGw, setSelected, notify,
    data, lookup, selected, detailId, playerGW, detailInline, replacePlayer,
    transferView, liveTransferViewRef, setDetailId, setTab
  } = scope;
  ${functions.map((node) => printer.printNode(ts.EmitHint.Unspecified, node, source)).join("\n")}
  const transferCallback = ${printer.printNode(ts.EmitHint.Expression, transferCallback, source)};
  return { updatePlan, travelPlan, transferIn, transferCallback };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const createActions = new Function("scope", actions) as (scope: object) => {
  updatePlan: (
    plan: Plan,
    message?: string,
    remember?: boolean,
    pendingMessage?: string,
  ) => Promise<Plan | boolean>;
  travelPlan: (direction: "past" | "future") => Promise<void>;
  transferCallback: (id: number) => Promise<boolean>;
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
      starters: squad.slice(0, 11),
      bench: squad.slice(11),
      captain: 1,
      vice: 2,
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
    activeId: plans[0].id,
    gw: plans[0].weeks[0].gw,
    busy: "",
    selected: 3,
    planHistory: {},
    toast: { text: "Earlier message" },
    tab: "projections",
    detailId: 2,
    detailGW: plans[0].weeks[0].gw,
    detailInline: false,
    modal: null,
  };
  const livePlanningRef = { current: { ...state } };
  const liveTransferViewRef = { current: {} };
  let viewKey = "";
  const players = Array.from({ length: 16 }, (_, i) => ({
    id: i + 1,
    name: `Player ${i + 1}`,
    position_id: 2,
  }));
  const requests: {
    path: string;
    body: unknown;
    resolve: (result: { weeks: Week[] }) => void;
    reject: (error: Error) => void;
  }[] = [];
  const api = vi.fn(
    (path: string, body: unknown) =>
      new Promise<{ weeks: Week[] }>((resolve, reject) => {
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
  const render = () => {
    livePlanningRef.current = { ...state };
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
    return createActions({
      ...state,
      active:
        state.plans.find((p) => p.id === state.activeId) ?? state.plans[0],
      forecastArgs: defaultForecastConfiguration,
      livePlanningRef,
      transferView: liveTransferViewRef.current,
      liveTransferViewRef,
      data: { players },
      lookup: new Map(players.map((p) => [p.id, p])),
      playerGW: state.detailGW || state.gw,
      replacePlayer,
      api,
      planValidationRequest,
      setPlans: setter("plans"),
      setPlanHistory: setter("planHistory"),
      setBusy: setter("busy"),
      setToast: setter("toast"),
      setGw: setter("gw"),
      setSelected: setter("selected"),
      setDetailId: setter("detailId"),
      setTab: setter("tab"),
      notify: (text: string, error = false) => {
        state.toast = { text, error };
      },
    });
  };
  return { state, requests, api, render };
}

describe("deferred plan validation", () => {
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

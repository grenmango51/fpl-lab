import { describe, expect, it, vi } from "vitest";
import type { Bootstrap, Plan, Week } from "./types";
import {
  createPlanExport, defaultForecastConfiguration, defaultSolverSettings,
  loadPlanningState, preparePlanImport, rebasePlan, restorePlanningState,
  sanitizeForecastConfiguration, sanitizeSolverSettings, solverSettingsForHorizon,
} from "./planningPersistence";

const squad = Array.from({ length: 15 }, (_, index) => index + 1);
const bootstrap = {
  next_gw: 7, gameweeks: Array.from({ length: 32 }, (_, index) => index + 7),
  players: [...squad, 16].map(id => ({ id, price: id === 16 ? 6.9 : 5 })),
} as unknown as Bootstrap;
function week(gw: number, owned = squad): Week {
  return {
    gw, squad: [...owned], starters: owned.slice(0, 11), bench: owned.slice(11), captain: owned[0], vice: owned[1],
    chip: "none", bank: 0.7, free_transfers: 3, next_free_transfers: 4,
    hits: 0, points: 70 + gw, net_points: 70 + gw, transfers_in: [], transfers_out: [],
  };
}
function plan(gws = [7, 8]): Plan {
  return {
    id: "source", name: "My branch", base_squad: [...squad], base_bank: 0.7, free_transfers: 3,
    purchase_prices: Object.fromEntries(squad.map(id => [String(id), id === 1 ? 4.6 : 5])),
    weeks: gws.map(gw => week(gw)), created_at: "2026-10-03T00:00:00Z",
  };
}
const config = () => structuredClone(defaultForecastConfiguration);
const solver = () => structuredClone(defaultSolverSettings);

describe("forecast settings across deadlines", () => {
  it("loads a safe baseline before pruning expired GWs and removed IDs from every input", async () => {
    const old = { ...config(),
      overrides: { "1": 70, "999": 90 },
      minutes_schedule: { "1": { "6": { conditional_minutes: 0 }, "7": { availability: 0 }, "38": { conditional_minutes: 85 } }, "999": { "7": { availability: 1 } } },
      stat_schedule: { "1": { "6": { xg: 1 }, "8": { xg: 0.4, expected_points: 0 } }, "999": { "9": { xa: 1 } } },
      custom_points: { "1": { "6": 5, "7": 6, "38": 3 }, "999": { "7": 4 } },
    };
    const original = structuredClone(old);
    const request = vi.fn(async () => bootstrap);
    const restored = await loadPlanningState([plan()], "source", old,
      { ...solver(), locked: [1, 999], captain_locks: { "6": 2, "9": 999, "8": 2 } }, request);
    expect(request.mock.calls[0]).toEqual([]);
    expect(request.mock.calls).toHaveLength(2);
    expect(restored.configuration.overrides).toEqual({ "1": 70 });
    expect(restored.configuration.minutes_schedule).toEqual({ "1": { "7": { availability: 0 }, "38": { conditional_minutes: 85 } } });
    expect(restored.configuration.stat_schedule).toEqual({ "1": { "8": { xg: 0.4, expected_points: 0 } } });
    expect(restored.configuration.custom_points).toEqual({ "1": { "7": 6, "38": 3 } });
    expect(restored.solver.locked).toEqual([1]);
    expect(restored.solver.captain_locks).toEqual({ "8": 2 });
    expect(old).toEqual(original);
    expect(restored.notices.length).toBeGreaterThan(0);
  });
  it("repairs malformed cached settings without sending them to the API", async () => {
    const restored = await loadPlanningState([plan()], "source", {
      minutes_schedule: [], stat_schedule: { "1": { "7": { xg: "not a number" } } },
      provider_weight: 10, overrides: { "1": -3 }, use_market: "yes",
    }, null, async () => bootstrap);
    expect(restored.configuration).toEqual(defaultForecastConfiguration);
    expect(restored.solver).toEqual(defaultSolverSettings);
  });
  it("rejects invalid current assumptions during explicit file import", () => {
    expect(() => sanitizeForecastConfiguration({ ...config(), stat_schedule: { "1": { "7": { xg: true } } } }, bootstrap, true)).toThrow("Invalid forecast setting");
    expect(() => sanitizeForecastConfiguration({ ...config(), provider_weight: 1.1 }, bootstrap, true)).toThrow("provider_weight");
  });
  it("uses only rules inside the requested solve while retaining other weeks in settings", () => {
    const settings = { ...solver(), transfer_limits: { "7": 0, "9": 2, "10": 3 }, locked_by_gw: { "7": [1], "9": [2] }, excluded_by_gw: { "10": [3] }, captain_locks: { "7": 1, "9": 2, "11": 3 } };
    const scoped = solverSettingsForHorizon(settings, 9, 2);
    expect(scoped.transfer_limits).toEqual({ "9": 2, "10": 3 });
    expect(scoped.locked_by_gw).toEqual({ "9": [2] });
    expect(scoped.excluded_by_gw).toEqual({ "10": [3] });
    expect(scoped.captain_locks).toEqual({ "9": 2 });
    expect(settings.captain_locks["7"]).toBe(1);
  });
  it("rejects contradictory or malformed exported optimiser rules", () => {
    expect(() => sanitizeSolverSettings({ ...solver(), captain_locks: { "7": 1 }, excluded: [1] }, bootstrap, true)).toThrow("contradictory");
    expect(() => sanitizeSolverSettings({ ...solver(), seconds: 46 }, bootstrap, true)).toThrow("seconds");
    expect(() => sanitizeSolverSettings({ ...solver(), transfer_limits: { "7": 1.5 } }, bootstrap, true)).toThrow("transfer_limits");
  });
});

describe("permanent holdings when saved decisions expire", () => {
  it("moves expired prefixes to history and preserves exact receipt bank, FT and acquisition prices", () => {
    const saved = plan([5, 6, 7, 8]);
    const permanent = [16, ...squad.slice(1)];
    const purchases: Record<string, number> = { ...saved.purchase_prices, "16": 5.6 };
    delete purchases["1"];
    saved.weeks[0] = { ...week(5, permanent), permanent_squad: permanent, permanent_bank: 0.7, purchase_prices: purchases, next_free_transfers: 4 };
    saved.weeks[1] = { ...week(6), chip: "freehit", bank: 0.2, next_free_transfers: 4, permanent_squad: permanent, permanent_bank: 0.7, purchase_prices: purchases };
    saved.weeks[2] = week(7, permanent);
    saved.weeks[3] = week(8, permanent);
    const before = structuredClone(saved);
    const restored = rebasePlan(saved, bootstrap);
    expect(restored.plan.base_squad).toEqual(permanent);
    expect(restored.plan.base_bank).toBe(0.7);
    expect(restored.plan.free_transfers).toBe(4);
    expect(restored.plan.purchase_prices["16"]).toBe(5.6);
    expect(restored.plan.purchase_prices["1"]).toBeUndefined();
    expect(restored.plan.used_chips).toEqual([{ chip: "freehit", gw: 6 }]);
    expect(restored.plan.weeks.map(row => row.gw)).toEqual([7, 8]);
    expect(restored.plan.history_weeks).toEqual(before.weeks.slice(0, 2));
    expect(restored.plan.history_weeks?.[0].points).toBe(75);
    expect(restored.notices).toEqual([]);
    expect(saved).toEqual(before);
    expect(rebasePlan(restored.plan, bootstrap).plan).toEqual(restored.plan);
  });
  it("restores permanent holdings after a legacy Free Hit, including removed temporary players", () => {
    const saved = plan([6, 7]);
    saved.weeks[0] = { ...week(6, [999, ...squad.slice(1)]), chip: "freehit", bank: 0.1, next_free_transfers: 3 };
    const { plan: restored, notices } = rebasePlan(saved, bootstrap);
    expect(restored.base_squad).toEqual(squad);
    expect(restored.base_bank).toBe(0.7);
    expect(restored.free_transfers).toBe(3);
    expect(restored.purchase_prices["1"]).toBe(4.6);
    expect(restored.history_weeks?.[0].squad[0]).toBe(999);
    expect(notices).toEqual([]);
  });
  it("retains existing purchase costs and discloses estimated legacy incoming prices", () => {
    const saved = plan([6, 7]);
    saved.weeks = [week(6, [16, ...squad.slice(1)]), week(7, [16, ...squad.slice(1)])];
    const restored = rebasePlan(saved, bootstrap);
    expect(restored.plan.purchase_prices["2"]).toBe(5);
    expect(restored.plan.purchase_prices["16"]).toBe(6.9);
    expect(restored.notices.join(" ")).toContain("current purchase prices");
  });
  it("allows a removed historical holding already sold before the planning window", () => {
    const saved = plan([6, 7]);
    saved.base_squad[0] = 999;
    saved.weeks[0] = { ...week(6), permanent_squad: [...squad], permanent_bank: 0.7,
      purchase_prices: Object.fromEntries(squad.map(id => [String(id), 5])) };
    expect(rebasePlan(saved, bootstrap).plan.base_squad).toEqual(squad);
  });
  it("rejects unavailable players in later weeks even when the base and first week survive", () => {
    const saved = plan([7, 8]);
    saved.weeks[1] = week(8, [999, ...squad.slice(1)]);
    expect(restorePlanningState([saved], saved.id, bootstrap).plans).toEqual([]);
  });
  it("does not fabricate missing historical FT state or accept damaged receipts", () => {
    const saved = plan([6, 7]);
    saved.weeks[0].next_free_transfers = Number.NaN;
    expect(() => rebasePlan(saved, bootstrap)).toThrow("free-transfer");
    saved.weeks[0].next_free_transfers = 4;
    saved.weeks[0].permanent_squad = [...squad];
    saved.weeks[0].permanent_bank = 0.7;
    saved.weeks[0].purchase_prices = {};
    expect(() => rebasePlan(saved, bootstrap)).toThrow("purchase-price");
  });
});

describe("transactional plan exports", () => {
  it("round-trips minutes, stats, CSV layers, provider settings and optimiser rules", async () => {
    const configuration = { ...config(), use_market: false, use_provider: false, provider_weight: 0.7, extrapolate: false, anchor_half_life: 4,
      custom_name: "My sourced CSV", blend_weight: 0.6, custom_points: { "1": { "8": 7 } }, overrides: { "2": 65 },
      minutes_schedule: { "1": { "7": { conditional_minutes: 80, availability: 1 } } }, stat_schedule: { "1": { "8": { xg: 0.6, xa: 0.2 } } },
    };
    const settings = { ...solver(), horizon: 20, seconds: 30, locked: [1], excluded: [2], transfer_limits: { "8": 0 }, captain_locks: { "8": 1 } };
    const validate = vi.fn(async (body: { weeks: Week[] }) => ({ weeks: body.weeks }));
    const projections = vi.fn(async () => bootstrap);
    const exported = JSON.parse(JSON.stringify(createPlanExport([plan()], configuration, settings)));
    const prepared = await preparePlanImport(exported, bootstrap, config(), solver(), { projections, validate }, () => "imported");
    expect(prepared.configuration).toEqual(configuration);
    expect(prepared.solver).toEqual(settings);
    expect(prepared.plans[0]).toEqual({ ...plan(), id: "imported" });
    expect(validate.mock.calls[0][0]).toMatchObject(configuration);
    expect(projections.mock.calls[0]).toEqual([configuration]);
  });
  it("keeps legacy exports compatible using current inputs", async () => {
    const current = { ...config(), provider_weight: 0.25 };
    const prepared = await preparePlanImport({ version: 1, plans: [plan()] }, bootstrap, current, solver(), {
      projections: async () => bootstrap, validate: async body => ({ weeks: body.weeks }),
    }, () => "new-id");
    expect(prepared.configuration).toEqual(current);
    expect(prepared.plans[0].id).toBe("new-id");
  });
  it("rebases expired file prefixes before sending them to server validation", async () => {
    const saved = plan([6, 7, 8]);
    const validate = vi.fn(async (body: { weeks: Week[] }) => ({ weeks: body.weeks }));
    const prepared = await preparePlanImport({ plans: [saved], configuration: { ...config(), minutes_schedule: { "1": { "6": { availability: 0 }, "7": { availability: 1 } } } } },
      bootstrap, config(), solver(), { projections: async () => bootstrap, validate }, () => "new");
    expect(validate.mock.calls[0][0].weeks.map(row => row.gw)).toEqual([7, 8]);
    expect(prepared.plans[0].history_weeks).toEqual([saved.weeks[0]]);
    expect(prepared.configuration.minutes_schedule).toEqual({ "1": { "7": { availability: 1 } } });
  });
  it("leaves plans and settings untouched if any server plan validation fails", async () => {
    const original = createPlanExport([plan(), { ...plan(), id: "second" }], { ...config(), provider_weight: 0.3 }, solver());
    const before = structuredClone(original);
    let committed = false;
    let calls = 0;
    await expect(preparePlanImport(original, bootstrap, config(), solver(), {
      projections: async () => bootstrap,
      validate: async body => { if (++calls === 2) throw new Error("Invalid squad"); return { weeks: body.weeks }; },
    }, () => "new").then(() => { committed = true; })).rejects.toThrow("Invalid squad");
    expect(committed).toBe(false);
    expect(original).toEqual(before);
  });
  it("validates proposed stat forecasts on the server before any plans", async () => {
    const validate = vi.fn();
    await expect(preparePlanImport({ plans: [plan()], configuration: { ...config(), stat_schedule: { "1": { "7": { expected_points: 10 } } } } },
      bootstrap, config(), solver(), { projections: async () => { throw new Error("Zero appearance"); }, validate }, () => "new")).rejects.toThrow("Zero appearance");
    expect(validate).not.toHaveBeenCalled();
  });
  it("does not silently ignore an explicitly invalid configuration or solver payload", async () => {
    const requests = { projections: async () => bootstrap, validate: async (body: { weeks: Week[] }) => ({ weeks: body.weeks }) };
    await expect(preparePlanImport({ plans: [plan()], configuration: null }, bootstrap, config(), solver(), requests, () => "new")).rejects.toThrow("configuration");
    await expect(preparePlanImport({ plans: [plan()], solver_settings: null }, bootstrap, config(), solver(), requests, () => "new")).rejects.toThrow("solver_settings");
  });
});

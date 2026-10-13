import type { Bootstrap, Chip, MinutesSchedule, Plan, Player, StatSchedule, Week } from "./types";
import type { SolverSettings } from "./Views";

export type PlanningForecast = {
  next_gw: number;
  gameweeks: number[];
  players: (Pick<Player, "id"> & Partial<Pick<Player, "price">>)[];
};
export type ForecastConfiguration = {
  overrides: Record<string, number>;
  minutes_schedule: MinutesSchedule;
  stat_schedule: StatSchedule;
  use_market: boolean;
  custom_points: Record<string, Record<string, number>>;
  blend_weight: number;
  use_provider: boolean;
  provider_weight: number;
  extrapolate: boolean;
  anchor_half_life: number;
  custom_name: string;
};
export const defaultForecastConfiguration: ForecastConfiguration = {
  overrides: {}, minutes_schedule: {}, stat_schedule: {}, use_market: true,
  custom_points: {}, blend_weight: 0, use_provider: true, provider_weight: 0.5,
  extrapolate: true, anchor_half_life: 6, custom_name: "Imported CSV",
};
export const defaultSolverSettings: SolverSettings = {
  horizon: 5, max_transfers: 2, decay: 0.9, ft_value: 1.5,
  bench_weight: 0.08, risk: 0, seconds: 15, locked: [], excluded: [],
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function numberIn(value: unknown, min: number, max: number, integer = false): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
}
function validKey(key: string, allowed: Set<number>) {
  return /^\d+$/.test(key) && key === String(Number(key)) && allowed.has(Number(key));
}

/** Local storage may outlive both the forecast window and the player pool. */
export function sanitizeForecastConfiguration(raw: unknown, forecast: PlanningForecast, strict = false) {
  const notices: string[] = [];
  const invalid = (field: string) => {
    if (strict) throw new Error(`Invalid forecast setting: ${field}.`);
    notices.push("Invalid saved forecast settings were reset.");
  };
  if (!record(raw)) {
    invalid("configuration");
    raw = {};
  }
  const source = raw as Record<string, unknown>;
  const output = structuredClone(defaultForecastConfiguration);
  const ids = new Set(forecast.players.map(player => player.id));
  const gws = new Set(forecast.gameweeks.filter(gw => gw >= forecast.next_gw));
  let pruned = false;
  const maps = (field: string) => {
    const value = source[field];
    if (value === undefined) return {};
    if (!record(value)) { invalid(field); return {}; }
    return value;
  };
  for (const field of ["use_market", "use_provider", "extrapolate"] as const) {
    if (source[field] !== undefined) {
      if (typeof source[field] === "boolean") output[field] = source[field];
      else invalid(field);
    }
  }
  for (const [field, low, high] of [["blend_weight", 0, 1], ["provider_weight", 0, 1], ["anchor_half_life", 1, 20]] as const) {
    if (source[field] !== undefined) {
      if (numberIn(source[field], low, high)) output[field] = source[field];
      else invalid(field);
    }
  }
  if (source.custom_name !== undefined) {
    if (typeof source.custom_name === "string" && source.custom_name.length <= 120) output.custom_name = source.custom_name;
    else invalid("custom_name");
  }
  for (const [pid, value] of Object.entries(maps("overrides"))) {
    if (!validKey(pid, ids)) { pruned = true; continue; }
    if (numberIn(value, 0, 90)) output.overrides[pid] = value;
    else invalid(`overrides.${pid}`);
  }
  const limits = {
    minutes_schedule: { conditional_minutes: [0, 90], availability: [0, 1] },
    stat_schedule: { expected_points: [-5, 60], xg: [0, 10], xa: [0, 10], clean_sheet_probability: [0, 1] },
  } as const;
  for (const field of ["minutes_schedule", "stat_schedule", "custom_points"] as const) {
    for (const [pid, weeks] of Object.entries(maps(field))) {
      if (!validKey(pid, ids)) { pruned = true; continue; }
      if (!record(weeks)) { invalid(`${field}.${pid}`); continue; }
      for (const [gw, value] of Object.entries(weeks)) {
        if (!validKey(gw, gws)) { pruned = true; continue; }
        if (field === "custom_points") {
          if (numberIn(value, -5, 60)) output.custom_points[pid] = { ...output.custom_points[pid], [gw]: value };
          else invalid(`${field}.${pid}.${gw}`);
          continue;
        }
        if (!record(value)) { invalid(`${field}.${pid}.${gw}`); continue; }
        const allowed = limits[field];
        const scenario: Record<string, number> = {};
        let bad = false;
        for (const [name, entry] of Object.entries(value)) {
          const range = (allowed as Record<string, readonly [number, number]>)[name];
          if (!range) { bad = true; continue; }
          if (entry === null || entry === undefined) continue;
          if (numberIn(entry, range[0], range[1])) scenario[name] = entry;
          else bad = true;
        }
        if (bad || !Object.keys(scenario).length) { invalid(`${field}.${pid}.${gw}`); continue; }
        output[field][pid] = { ...output[field][pid], [gw]: scenario };
      }
    }
  }
  if (pruned) notices.push("Expired forecasts and unavailable player settings were archived from planning inputs.");
  return { configuration: output, notices: [...new Set(notices)] };
}

export function sanitizeSolverSettings(raw: unknown, forecast: PlanningForecast, strict = false) {
  const invalid = (field: string) => { if (strict) throw new Error(`Invalid optimiser setting: ${field}.`); };
  if (!record(raw)) { invalid("solver_settings"); raw = {}; }
  const source = raw as Record<string, unknown>;
  const output = structuredClone(defaultSolverSettings);
  for (const [field, low, high, integer] of [
    ["horizon", 1, 38, true], ["max_transfers", 0, 15, true], ["decay", 0.5, 1, false],
    ["ft_value", 0, 3.9, false], ["bench_weight", 0, 1, false], ["risk", -0.5, 0.5, false], ["seconds", 2, 45, true],
  ] as const) {
    if (source[field] !== undefined) {
      if (numberIn(source[field], low, high, integer)) output[field] = source[field];
      else invalid(field);
    }
  }
  const ids = new Set(forecast.players.map(player => player.id));
  const gws = new Set(forecast.gameweeks.filter(gw => gw >= forecast.next_gw));
  const playerList = (value: unknown, field: string, max: number) => {
    if (!Array.isArray(value) || value.some(id => !numberIn(id, 1, Number.MAX_SAFE_INTEGER, true)) || value.length > max) { invalid(field); return []; }
    return [...new Set(value as number[])].filter(id => ids.has(id));
  };
  for (const field of ["locked", "excluded"] as const) {
    if (source[field] !== undefined) output[field] = playerList(source[field], field, field === "locked" ? 15 : 700);
  }
  for (const field of ["transfer_limits", "locked_by_gw", "excluded_by_gw", "captain_locks"] as const) {
    const values = source[field];
    if (values === undefined) continue;
    if (!record(values)) { invalid(field); continue; }
    for (const [gw, value] of Object.entries(values)) {
      if (!validKey(gw, gws)) continue;
      if (field === "locked_by_gw" || field === "excluded_by_gw") {
        const list = playerList(value, `${field}.${gw}`, field === "locked_by_gw" ? 15 : 700);
        if (list.length) output[field] = { ...output[field], [gw]: list };
      } else if (field === "captain_locks") {
        if (!numberIn(value, 1, Number.MAX_SAFE_INTEGER, true)) invalid(`${field}.${gw}`);
        else if (ids.has(value)) output[field] = { ...output[field], [gw]: value };
      } else if (numberIn(value, 0, 15, true)) output[field] = { ...output[field], [gw]: value };
      else invalid(`${field}.${gw}`);
    }
  }
  for (const gw of gws) {
    const excluded = new Set([...output.excluded, ...output.excluded_by_gw?.[String(gw)] ?? []]);
    const locked = [...output.locked, ...output.locked_by_gw?.[String(gw)] ?? []];
    const captain = output.captain_locks?.[String(gw)];
    if (locked.some(id => excluded.has(id)) || (captain !== undefined && excluded.has(captain))) {
      invalid(`contradictory rules for GW${gw}`);
      if (!strict) {
        output.excluded = output.excluded.filter(id => !locked.includes(id) && id !== captain);
        if (output.excluded_by_gw?.[String(gw)]) output.excluded_by_gw[String(gw)] = output.excluded_by_gw[String(gw)].filter(id => !locked.includes(id) && id !== captain);
      }
    }
  }
  return output;
}

const chips: Chip[] = ["none", "wildcard", "freehit", "benchboost", "triplecaptain"];
function uniqueSquad(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 15 && new Set(value).size === 15 && value.every(id => numberIn(id, 1, Number.MAX_SAFE_INTEGER, true));
}
function weekStructure(week: Week) {
  return record(week) && numberIn(week.gw, 1, 38, true) && uniqueSquad(week.squad)
    && Array.isArray(week.starters) && week.starters.length === 11 && new Set(week.starters).size === 11
    && Array.isArray(week.bench) && week.bench.length === 4 && new Set(week.bench).size === 4
    && [...week.starters, ...week.bench].every(id => week.squad.includes(id))
    && new Set([...week.starters, ...week.bench]).size === 15
    && week.starters.includes(week.captain) && week.starters.includes(week.vice) && week.captain !== week.vice
    && chips.includes(week.chip);
}

/** Advance the planning base once, retaining past decisions without rescoring them. */
export function rebasePlan(plan: Plan, forecast: PlanningForecast) {
  if (!record(plan) || !Array.isArray(plan.weeks) || !uniqueSquad(plan.base_squad) || !record(plan.purchase_prices)
    || typeof plan.name !== "string" || !numberIn(plan.base_bank, 0, 200) || !numberIn(plan.free_transfers, 0, 5, true)) {
    throw new Error("Invalid plan structure.");
  }
  const sorted = [...plan.weeks].sort((a, b) => a.gw - b.gw);
  if (!sorted.length || !sorted.every(weekStructure) || new Set(sorted.map(week => week.gw)).size !== sorted.length) throw new Error("Invalid plan gameweeks or squad.");
  const expired = sorted.filter(week => week.gw < forecast.next_gw);
  const future = sorted.filter(week => week.gw >= forecast.next_gw);
  if (!future.length) throw new Error("This plan has no remaining gameweeks.");
  const ids = new Set(forecast.players.map(player => player.id));
  const available = new Set(forecast.gameweeks);
  if (future.some(week => !available.has(week.gw) || week.squad.some(id => !ids.has(id)))) throw new Error("A remaining plan squad contains unavailable players or gameweeks.");
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index].gw !== sorted[index - 1].gw + 1) throw new Error("Planning weeks must be consecutive and distinct.");
  }
  let squad = [...plan.base_squad], bank = plan.base_bank, ft = plan.free_transfers;
  let purchases = { ...plan.purchase_prices };
  let estimatedPurchases = false;
  const prices = new Map(forecast.players.map(player => [player.id, player.price]));
  const used = [...plan.used_chips ?? []];
  for (const week of expired) {
    if (!numberIn(week.next_free_transfers, 0, 5, true)) throw new Error("An expired decision has no saved free-transfer allowance.");
    ft = week.next_free_transfers;
    if (week.chip !== "none" && !used.some(value => value.chip === week.chip && value.gw === week.gw)) used.push({ chip: week.chip, gw: week.gw });
    if (week.permanent_squad !== undefined || week.permanent_bank !== undefined) {
      if (!uniqueSquad(week.permanent_squad) || !numberIn(week.permanent_bank, 0, 200) || !record(week.purchase_prices)) throw new Error("Invalid saved permanent-squad receipt.");
      if (week.permanent_squad.some(id => !numberIn(week.purchase_prices?.[String(id)], 0, 200))) throw new Error("Invalid saved purchase-price receipt.");
      squad = [...week.permanent_squad]; bank = week.permanent_bank;
      purchases = { ...week.purchase_prices };
    } else if (week.chip !== "freehit") {
      if (!numberIn(week.bank, 0, 200)) throw new Error("An expired decision has no saved bank.");
      const nextPurchases: Record<string, number> = {};
      for (const id of week.squad) {
        const price = week.purchase_prices?.[String(id)] ?? (squad.includes(id) ? purchases[String(id)] : undefined);
        if (price !== undefined) nextPurchases[String(id)] = price;
        else {
          estimatedPurchases = true;
          const current = prices.get(id);
          if (current !== undefined) nextPurchases[String(id)] = current;
        }
      }
      purchases = nextPurchases;
      squad = [...week.squad]; bank = week.bank;
    }
  }
  if (squad.some(id => !ids.has(id))) throw new Error("The permanent squad contains an unavailable player.");
  const notices: string[] = [];
  if (!expired.length) return { plan, notices };
  for (const id of squad) {
    if (!numberIn(purchases[String(id)], 0, 200)) {
      const price = prices.get(id);
      if (!numberIn(price, 0, 200)) throw new Error("Cannot restore a purchase price for this historical squad.");
      purchases[String(id)] = price; estimatedPurchases = true;
    }
  }
  if (estimatedPurchases) notices.push("Older plans use current purchase prices where no saved receipt exists; originals are archived.");
  const history = [...plan.history_weeks ?? [], ...expired];
  return { plan: {
    ...plan, base_squad: squad, base_bank: bank, free_transfers: ft,
    purchase_prices: Object.fromEntries(squad.map(id => [String(id), purchases[String(id)]])),
    used_chips: used, weeks: future,
    history_weeks: [...new Map(history.map(week => [week.gw, week])).values()].sort((a, b) => a.gw - b.gw),
  }, notices };
}

export function restorePlanningState(saved: Plan[], activeId: string, forecast: PlanningForecast) {
  const plans: Plan[] = [], notices: string[] = [];
  for (const plan of Array.isArray(saved) ? saved : []) {
    try { const restored = rebasePlan(plan, forecast); plans.push(restored.plan); notices.push(...restored.notices); }
    catch { notices.push("Unavailable saved branches are archived; remaining branches were restored."); }
  }
  const active = plans.find(plan => plan.id === activeId) ?? plans[0];
  const gw = active?.weeks.some(week => week.gw === forecast.next_gw) ? forecast.next_gw : active?.weeks[0]?.gw ?? forecast.next_gw;
  return { plans, activeId: active?.id ?? "", gw, notices: [...new Set(notices)] };
}

export function planValidationRequest(plan: Plan, configuration: ForecastConfiguration) {
  return { ...configuration, base_squad: plan.base_squad, bank: plan.base_bank,
    free_transfers: plan.free_transfers, purchase_prices: plan.purchase_prices,
    weeks: plan.weeks, used_chips: plan.used_chips ?? [] };
}
export function solverSettingsForHorizon(settings: SolverSettings, startGW: number, horizon: number): SolverSettings {
  const output = { ...settings };
  for (const field of ["transfer_limits", "locked_by_gw", "excluded_by_gw", "captain_locks"] as const) {
    const scoped = Object.fromEntries(Object.entries(settings[field] ?? {}).filter(([gw]) => Number(gw) >= startGW && Number(gw) < startGW + horizon));
    Object.assign(output, { [field]: scoped });
  }
  return output;
}
type ProjectionRequest = (configuration?: ForecastConfiguration) => Promise<Bootstrap>;
export async function loadPlanningState(saved: Plan[], activeId: string, configuration: unknown, solver: unknown,
  request: ProjectionRequest) {
  // Never send persisted settings until the current pool/window is known.
  const baseline = await request();
  const sanitized = sanitizeForecastConfiguration(configuration, baseline);
  const forecast = await request(sanitized.configuration);
  const restored = restorePlanningState(saved, activeId, forecast);
  return { ...restored, forecast, configuration: sanitized.configuration,
    solver: sanitizeSolverSettings(solver, forecast),
    notices: [...new Set([...sanitized.notices, ...restored.notices])],
  };
}

export function createPlanExport(plans: Plan[], configuration: ForecastConfiguration, settings: SolverSettings) {
  return { version: 2, exported_at: new Date().toISOString(), plans, configuration, solver_settings: settings };
}

/** No caller state is changed until every proposed input has passed validation. */
export async function preparePlanImport(raw: unknown, forecast: Bootstrap, currentConfiguration: ForecastConfiguration,
  currentSolver: SolverSettings, requests: { projections: ProjectionRequest; validate: (body: ReturnType<typeof planValidationRequest>) => Promise<{ weeks: Week[] }> },
  newId: () => string) {
  if (!record(raw) || !Array.isArray(raw.plans) || !raw.plans.length || raw.plans.length > 30 || (raw.version !== undefined && raw.version !== 1 && raw.version !== 2)) throw new Error("Choose an Open FPL plan export.");
  const proposed = sanitizeForecastConfiguration(raw.configuration === undefined ? currentConfiguration : raw.configuration, forecast, true);
  const checkedForecast = await requests.projections(proposed.configuration);
  const solver = sanitizeSolverSettings(raw.solver_settings === undefined ? currentSolver : raw.solver_settings, checkedForecast, true);
  const checked: Plan[] = [], notices = [...proposed.notices];
  for (const source of raw.plans) {
    const restored = rebasePlan(source as Plan, checkedForecast);
    notices.push(...restored.notices);
    const result = await requests.validate(planValidationRequest(restored.plan, proposed.configuration));
    checked.push({ ...restored.plan, id: newId(), name: restored.plan.name.slice(0, 100), weeks: result.weeks });
  }
  return { plans: checked, forecast: checkedForecast, configuration: proposed.configuration, solver,
    notices: [...new Set(notices)] };
}

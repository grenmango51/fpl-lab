import type { Plan, Player, Week } from "./types";
import { optimalLineup } from "./lib";

/** Reuse only unchanged, already validated decisions when revealing them again. */
export function reuseValidatedHorizon(
  plan: Plan,
  saved: Plan | undefined,
  count: number,
): Plan | null {
  if (!Number.isInteger(count) || count < 1 || !saved) return null;
  const source = saved;
  if (count > source.weeks.length || plan.weeks.length > source.weeks.length)
    return null;
  const inputs = (p: Plan) => ({
    id: p.id,
    base_squad: p.base_squad,
    base_bank: p.base_bank,
    free_transfers: p.free_transfers,
    purchase_prices: p.purchase_prices,
    used_chips: p.used_chips,
    history_weeks: p.history_weeks,
    weeks: p.weeks.slice(0, plan.weeks.length),
  });
  if (JSON.stringify(inputs(source)) !== JSON.stringify(inputs(plan)))
    return null;
  return {
    ...structuredClone(plan),
    weeks: structuredClone(source.weeks.slice(0, count)),
  };
}

/** Extend permanent holdings, including when the final visible week is a Free Hit. */
export function resizePlanHorizon(
  plan: Plan,
  count: number,
  gameweeks: number[],
  players: Player[],
): Plan {
  const next = structuredClone(plan);
  const first = next.weeks[0]?.gw;
  if (first === undefined || !Number.isInteger(count) || count < 1) return next;
  const calendar = gameweeks.filter((gw) => gw >= first).slice(0, count);
  const existing = new Map(next.weeks.map((week) => [week.gw, week]));
  const weeks: Week[] = [];
  for (const gw of calendar) {
    const saved = existing.get(gw);
    if (saved) {
      weeks.push(saved);
      continue;
    }
    const previous = weeks.at(-1);
    const permanent = [...weeks]
      .reverse()
      .find((week) => week.chip !== "freehit");
    const squad =
      previous?.permanent_squad ?? permanent?.squad ?? next.base_squad;
    const bank = previous?.permanent_bank ?? permanent?.bank ?? next.base_bank;
    const ft = previous?.next_free_transfers ?? next.free_transfers;
    weeks.push({
      gw,
      squad: [...squad],
      ...optimalLineup(squad, players, gw),
      chip: "none",
      bank,
      free_transfers: ft,
      next_free_transfers: Math.min(5, ft + 1),
      hits: 0,
      net_points: 0,
      transfers_in: [],
      transfers_out: [],
    });
  }
  next.weeks = weeks;
  return next;
}

// Mirror FPL's £0.1m price steps. The server remains the authority on every move.
export function sellingPrice(current: number, purchase: number): number {
  const now = Math.round(current * 10),
    paid = Math.round(purchase * 10);
  return (now > paid ? paid + Math.floor((now - paid) / 2) : now) / 10;
}

export function transferAllowance(plan: Plan, week: Week, player: Player) {
  const index = plan.weeks.findIndex((row) => row.gw === week.gw);
  const previous = plan.weeks[index - 1];
  const purchases =
    week.purchase_prices ?? previous?.purchase_prices ?? plan.purchase_prices;
  const sale = sellingPrice(
    player.price,
    purchases[String(player.id)] ?? player.price,
  );
  return { sale, budget: Math.round((week.bank + sale) * 10) / 10 };
}

export function canSwap(
  week: Week,
  from: Player,
  to: Player,
  players: Player[],
): boolean {
  if (
    from.id === to.id ||
    !week.squad.includes(from.id) ||
    !week.squad.includes(to.id)
  )
    return false;
  if (week.starters.includes(from.id) === week.starters.includes(to.id))
    return false;
  if (from.position_id === 1 || to.position_id === 1)
    return from.position_id === to.position_id;
  const xi = week.starters.map((id) =>
    id === from.id ? to.id : id === to.id ? from.id : id,
  );
  const lookup = new Map(players.map((player) => [player.id, player]));
  const counts = [1, 2, 3, 4].map(
    (pos) => xi.filter((id) => lookup.get(id)?.position_id === pos).length,
  );
  return (
    counts[0] === 1 &&
    counts[1] >= 3 &&
    counts[1] <= 5 &&
    counts[2] >= 2 &&
    counts[2] <= 5 &&
    counts[3] >= 1 &&
    counts[3] <= 3
  );
}

export function replacePlayer(
  plan: Plan,
  gw: number,
  outgoing: number,
  incoming: number,
): Plan {
  const next = structuredClone(plan);
  const temporary = next.weeks.find((row) => row.gw === gw)?.chip === "freehit";
  for (const week of next.weeks) {
    if (week.gw < gw || (temporary && week.gw !== gw)) continue;
    if (week.gw !== gw && week.chip === "freehit") continue;
    // Keep later explicit transfers/rebuys and temporary FH selections independent.
    if (!week.squad.includes(outgoing) || week.squad.includes(incoming)) break;
    week.squad = week.squad.map((id) => (id === outgoing ? incoming : id));
    week.starters = week.starters.map((id) =>
      id === outgoing ? incoming : id,
    );
    week.bench = week.bench.map((id) => (id === outgoing ? incoming : id));
    if (week.captain === outgoing) week.captain = incoming;
    if (week.vice === outgoing) week.vice = incoming;
  }
  return next;
}

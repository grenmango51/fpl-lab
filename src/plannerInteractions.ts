import type { Plan, Player, Week } from "./types";

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

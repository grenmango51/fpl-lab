import type { Plan, Player, Week } from "./types";

// Match Python round(value * 10), including accepted off-step inputs.
function moneyUnits(value: number): number {
  const scaled = value * 10;
  const lower = Math.floor(scaled);
  return scaled - lower === 0.5
    ? lower % 2 === 0 ? lower : lower + 1
    : Math.round(scaled);
}

// Mirror FPL's £0.1m price steps. The server remains the authority on every move.
export function sellingPrice(current: number, purchase: number): number {
  const now = moneyUnits(current),
    paid = moneyUnits(purchase);
  return (now > paid ? paid + Math.floor((now - paid) / 2) : now) / 10;
}

export function transferAllowance(
  plan: Plan,
  week: Week,
  player: Player,
  players: Player[],
) {
  const prices = new Map(players.map((p) => [p.id, moneyUnits(p.price)]));
  let squad = new Set(plan.base_squad),
    bank = moneyUnits(plan.base_bank);
  const purchases = new Map(
    plan.base_squad.map((id) => [
      id,
      moneyUnits(plan.purchase_prices[String(id)] ?? prices.get(id)! / 10),
    ]),
  );
  const salePrice = (id: number) =>
    Math.round(
      sellingPrice(prices.get(id)! / 10, purchases.get(id)! / 10) * 10,
    );
  const bankFor = (next: Set<number>) =>
    bank +
    [...squad].reduce(
      (sum, id) => sum + (next.has(id) ? 0 : salePrice(id)),
      0,
    ) -
    [...next].reduce(
      (sum, id) => sum + (squad.has(id) ? 0 : prices.get(id)!),
      0,
    );

  // Reconstruct the entering permanent resources just as /plan/validate does.
  // Post-decision receipts have already removed this week's sold players.
  for (const previous of plan.weeks
    .filter((row) => row.gw < week.gw)
    .sort((a, b) => a.gw - b.gw)) {
    if (previous.chip === "freehit") continue;
    const next = new Set(previous.squad);
    bank = bankFor(next);
    for (const id of squad) if (!next.has(id)) purchases.delete(id);
    for (const id of next)
      if (!squad.has(id)) purchases.set(id, prices.get(id)!);
    squad = next;
  }
  const current = new Set(week.squad);
  const currentBank = bankFor(current);
  const cancelsBuy = !squad.has(player.id);
  const sale = cancelsBuy ? prices.get(player.id)! : salePrice(player.id);
  // Count the final net buys, not clicks or the displayed transfer slots.
  // week.free_transfers is the validator's canonical entering allowance.
  const hitsFor = (final: Set<number>) =>
    week.chip === "wildcard" || week.chip === "freehit"
      ? 0
      : Math.max(
          0,
          [...final].filter((id) => !squad.has(id)).length - week.free_transfers,
        ) * 4;
  return {
    bank: currentBank / 10,
    sale: sale / 10,
    budget: (currentBank + sale) / 10,
    cancelsBuy,
    hits: hitsFor(current),
    forTarget(target: Player) {
      const final = new Set(current);
      final.delete(player.id);
      final.add(target.id);
      const cancelsSale = squad.has(target.id);
      return {
        cost:
          (cancelsSale ? salePrice(target.id) : prices.get(target.id)!) / 10,
        bankAfter: bankFor(final) / 10,
        cancelsSale,
        hits: hitsFor(final),
      };
    },
  };
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

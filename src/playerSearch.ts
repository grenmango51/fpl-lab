import type { Player } from "./types";

export function playerSearchTerms(query: string): string[] {
  return query
    .split(/[,|]/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

export function matchesPlayerQuery(
  player: Pick<Player, "name" | "full_name" | "team_name" | "team_short">,
  query: string | readonly string[],
): boolean {
  const terms = typeof query === "string" ? playerSearchTerms(query) : query;
  if (!terms.length) return true;
  const text =
    `${player.name} ${player.full_name} ${player.team_name} ${player.team_short}`.toLowerCase();
  return terms.some((term) => text.includes(term));
}

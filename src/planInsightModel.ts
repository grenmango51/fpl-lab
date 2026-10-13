import { optimalLineup } from "./lib";
import { teamPoints } from "./scoring";
import type { Bootstrap, Forecast, Plan, Player, Week } from "./types";

export type InsightScope = "horizon" | "gameweek";
export type WeekInsight = {
  week: Week;
  complete: boolean;
  missing: number[];
  components: Record<string, number>;
  directPoints: number | null;
  points: number | null;
  netPoints: number | null;
  autosubs: number | null;
  vice: number | null;
  anyStarterAbsent: number | null;
  expectedMissing: number | null;
  expectedReserves: number | null;
  holdingPoints: number | null;
};
export type PlayerExposure = {
  player: Player;
  weeks: number;
  captainWeeks: number;
  copies: number;
  points: number | null;
  ownership: number | null;
};
export type Alternative = {
  player: Player;
  replacement: Player;
  gameweeks: number[];
  originalPoints: number;
  alternativePoints: number;
  gain: number;
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const boundedProbability = (value: number) => Math.min(1, Math.max(0, value));
const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

/** Keep the actual plan weeks; selected-GW mode never substitutes another GW. */
export function insightWeeks(plan: Plan, selectedGW: number, scope: InsightScope) {
  const byGW = new Map<number, Week>();
  for (const week of plan.weeks) {
    if (scope === "horizon" || week.gw === selectedGW) byGW.set(week.gw, week);
  }
  return [...byGW.values()].sort((a, b) => a.gw - b.gw);
}

export function forecastRow(player: Player | undefined, gw: number): Forecast | null {
  const row = player?.gw[String(gw)];
  return row && finite(row.points) && Array.isArray(row.fixtures) ? row : null;
}

/** A blank is a known zero; an absent forecast/probability is unknown. */
export function insightAppearance(player: Player | undefined, gw: number): number | null {
  const row = forecastRow(player, gw);
  if (!row) return null;
  if (!row.fixtures.length) return 0;
  if (finite(row.pplay)) return boundedProbability(row.pplay);
  if (!row.fixtures.every((fixture) => finite(fixture.pplay))) return null;
  return 1 - row.fixtures.reduce((absent, fixture) => absent * (1 - boundedProbability(fixture.pplay)), 1);
}

/** Sum both fixtures of a double, then reconcile GW-only provider/import layers. */
export function forecastComponents(row: Forecast): Record<string, number> {
  const parts: Record<string, number> = {};
  for (const fixture of row.fixtures) {
    for (const [name, value] of Object.entries(fixture.components ?? {})) {
      if (finite(value)) parts[name] = (parts[name] ?? 0) + value;
    }
  }
  for (const [name, value] of Object.entries(row.components ?? {})) {
    if (finite(value)) parts[name] = value;
  }
  const residual = row.points - total(Object.values(parts));
  if (Math.abs(residual) > 1e-8) parts.unassigned_forecast = residual;
  return parts;
}

export function scoringCopies(week: Week) {
  const copies = new Map<number, number>();
  const scoring = week.chip === "benchboost" ? [...week.starters, ...week.bench] : week.starters;
  for (const id of scoring) copies.set(id, (copies.get(id) ?? 0) + 1);
  copies.set(week.captain, (copies.get(week.captain) ?? 0) + (week.chip === "triplecaptain" ? 2 : 1));
  return copies;
}

function validOriginalSquad(squad: number[], lookup: Map<number, Player>) {
  if (squad.length !== 15 || new Set(squad).size !== 15 || squad.some((id) => !lookup.has(id))) return false;
  if (squad.some((id) => squad.filter((other) => lookup.get(other)!.team === lookup.get(id)!.team).length > 3)) return false;
  return [2, 5, 5, 3].every((count, index) => squad.filter((id) => lookup.get(id)!.position_id === index + 1).length === count);
}

function legalWeek(week: Week, lookup: Map<number, Player>) {
  if (!validOriginalSquad(week.squad, lookup) || week.starters.length !== 11 || week.bench.length !== 4) return false;
  const all = [...week.starters, ...week.bench];
  if (new Set(all).size !== 15 || all.some((id) => !week.squad.includes(id))) return false;
  if (!week.starters.includes(week.captain) || !week.starters.includes(week.vice) || week.captain === week.vice) return false;
  const counts = [1, 2, 3, 4].map((pos) => week.starters.filter((id) => lookup.get(id)?.position_id === pos).length);
  return counts[0] === 1 && counts[1] >= 3 && counts[1] <= 5 && counts[2] >= 2 && counts[2] <= 5 && counts[3] >= 1 && counts[3] <= 3;
}

export function analyseWeek(week: Week, originalSquad: number[], players: Player[]): WeekInsight {
  const lookup = new Map(players.map((player) => [player.id, player]));
  const missing = [...new Set([...week.squad, ...week.starters, ...week.bench, week.captain, week.vice])]
    .filter((id) => !forecastRow(lookup.get(id), week.gw) || insightAppearance(lookup.get(id), week.gw) === null);
  const complete = !missing.length && legalWeek(week, lookup);
  const components: Record<string, number> = {};
  let directPoints: number | null = null;
  let points: number | null = null;
  let autosubs: number | null = null;
  let vice: number | null = null;
  if (complete) {
    directPoints = 0;
    for (const [id, copies] of scoringCopies(week)) {
      const row = forecastRow(lookup.get(id), week.gw)!;
      directPoints += row.points * copies;
      for (const [name, value] of Object.entries(forecastComponents(row))) {
        components[name] = (components[name] ?? 0) + value * copies;
      }
    }
    const score = teamPoints(week.starters, week.bench, week.captain, week.vice, lookup, week.gw, week.chip);
    points = score.points;
    autosubs = score.autosub_points;
    vice = score.vice_points;
  }
  const chances = week.starters.map((id) => insightAppearance(lookup.get(id), week.gw));
  const benchChances = week.bench.map((id) => insightAppearance(lookup.get(id), week.gw));
  const knownStarters = week.starters.length === 11 && chances.every((chance) => chance !== null);
  let holdingPoints: number | null = null;
  if (validOriginalSquad(originalSquad, lookup) && originalSquad.every((id) => forecastRow(lookup.get(id), week.gw) && insightAppearance(lookup.get(id), week.gw) !== null)) {
    // Use the existing formation/bench shortcut with the same chip and current forecasts.
    holdingPoints = optimalLineup(originalSquad, players, week.gw, week.chip).points;
  }
  return {
    week, complete, missing, components, directPoints, points,
    netPoints: points === null ? null : points - (finite(week.hits) ? week.hits : 0),
    autosubs, vice, holdingPoints,
    anyStarterAbsent: knownStarters ? 1 - chances.reduce<number>((product, chance) => product * chance!, 1) : null,
    expectedMissing: knownStarters ? total(chances.map((chance) => 1 - chance!)) : null,
    expectedReserves: week.bench.length === 4 && benchChances.every((chance) => chance !== null) ? total(benchChances as number[]) : null,
  };
}

/** Single-player screen, not a budget/hits/FT-valid multiweek transfer solution. */
export function weakStarterAlternatives(weeks: Week[], players: Player[], minimumGain = 0.5): Alternative[] {
  const lookup = new Map(players.map((player) => [player.id, player]));
  const held = new Set(weeks.flatMap((week) => week.squad));
  const suggestions: Alternative[] = [];
  const starters = [...new Set(weeks.flatMap((week) => week.starters))];
  for (const id of starters) {
    const replacement = lookup.get(id);
    if (!replacement || !finite(replacement.price)) continue;
    const starts = weeks.filter((week) => week.starters.includes(id));
    const rows = starts.map((week) => forecastRow(replacement, week.gw));
    if (rows.some((row) => row === null)) continue;
    const originalPoints = total(rows.map((row) => row!.points));
    const alternatives = players.flatMap((player): Alternative[] => {
      if (held.has(player.id) || player.position_id !== replacement.position_id || !finite(player.price) || player.price > replacement.price + 1e-8) return [];
      if (starts.some((week) => week.squad.filter((squadId) => squadId !== id && lookup.get(squadId)?.team === player.team).length >= 3)) return [];
      const candidateRows = starts.map((week) => forecastRow(player, week.gw));
      if (candidateRows.some((row) => row === null)) return [];
      const alternativePoints = total(candidateRows.map((row) => row!.points));
      const gain = alternativePoints - originalPoints;
      return gain > minimumGain ? [{ player, replacement, gameweeks: starts.map((week) => week.gw), originalPoints, alternativePoints, gain }] : [];
    });
    alternatives.sort((a, b) => b.gain - a.gain || a.player.price - b.player.price || a.player.id - b.player.id);
    if (alternatives[0]) suggestions.push(alternatives[0]);
  }
  return suggestions.sort((a, b) => b.gain - a.gain || a.replacement.id - b.replacement.id).slice(0, 5);
}

export function playerExposures(weeks: Week[], players: Player[]): PlayerExposure[] {
  const lookup = new Map(players.map((player) => [player.id, player]));
  const exposure = new Map<number, PlayerExposure>();
  for (const week of weeks) {
    for (const [id, copies] of scoringCopies(week)) {
      const player = lookup.get(id);
      if (!player) continue;
      const current = exposure.get(id) ?? {
        player, weeks: 0, captainWeeks: 0, copies: 0, points: 0,
        ownership: finite(player.ownership) ? Math.min(100, Math.max(0, player.ownership)) : null,
      };
      current.weeks++;
      current.captainWeeks += Number(id === week.captain);
      current.copies += copies;
      const row = forecastRow(player, week.gw);
      current.points = current.points === null || !row ? null : current.points + copies * row.points;
      exposure.set(id, current);
    }
  }
  return [...exposure.values()].sort((a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity) || a.player.id - b.player.id);
}

export function planInsights(data: Bootstrap, plan: Plan, selectedGW: number, scope: InsightScope = "horizon") {
  const weeks = insightWeeks(plan, selectedGW, scope);
  const rows = weeks.map((week) => analyseWeek(week, plan.base_squad, data.players));
  const completeRows = rows.filter((row) => row.complete);
  const matched = rows.filter((row) => row.netPoints !== null && row.holdingPoints !== null);
  const components: Record<string, number> = {};
  for (const row of completeRows) {
    for (const [name, value] of Object.entries(row.components)) components[name] = (components[name] ?? 0) + value;
  }
  const exposures = playerExposures(weeks, data.players);
  const teamMap = new Map<number, { id: number; name: string; short: string; players: number; copies: number; points: number | null }>();
  for (const exposure of exposures) {
    const { player } = exposure;
    const team = teamMap.get(player.team) ?? { id: player.team, name: player.team_name, short: player.team_short, players: 0, copies: 0, points: 0 };
    team.players++;
    team.copies += exposure.copies;
    team.points = team.points === null || exposure.points === null ? null : team.points + exposure.points;
    teamMap.set(player.team, team);
  }
  return {
    weeks, rows, completeRows, matched, components, exposures,
    teams: [...teamMap.values()].sort((a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity)),
    // Never display an incomplete horizon's partial sum as its complete total.
    points: rows.length && rows.every((row) => row.points !== null) ? total(rows.map((row) => row.points!)) : null,
    netPoints: rows.length && rows.every((row) => row.netPoints !== null) ? total(rows.map((row) => row.netPoints!)) : null,
    componentPoints: completeRows.length ? total(completeRows.map((row) => row.points!)) : null,
    autosubs: total(completeRows.map((row) => row.autosubs!)),
    vice: total(completeRows.map((row) => row.vice!)),
    hits: total(weeks.map((week) => finite(week.hits) ? week.hits : 0)),
    matchedHits: total(matched.map((row) => row.week.hits)),
    transferGain: matched.length ? total(matched.map((row) => row.netPoints! - row.holdingPoints!)) : null,
    holdingPoints: matched.length ? total(matched.map((row) => row.holdingPoints!)) : null,
    alternatives: weakStarterAlternatives(weeks, data.players),
  };
}

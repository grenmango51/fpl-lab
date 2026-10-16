import type { Bootstrap, Forecast, Player } from "./types";

export type FixtureMetric = "difficulty" | "goals" | "cs" | "gd";
export type FixtureSort = {
  column: "club" | "total" | number;
  direction: "ascending" | "descending";
};
export type FixtureRow = {
  team: Bootstrap["teams"][number];
  forecasts: Record<string, Forecast | undefined>;
  total: number | null;
};

export function fixtureSourceWeeks(available: readonly number[]): number[] {
  return [...new Set(available)]
    .filter((week) => Number.isInteger(week) && week >= 1 && week <= 38)
    .sort((a, b) => a - b);
}

export function fixtureHorizonWeeks(
  available: readonly number[],
  start: number,
  horizon: number,
): number[] {
  return fixtureSourceWeeks(available)
    .filter((week) => week >= start)
    .slice(0, Math.max(0, horizon));
}

export function fixtureRangeWeeks(
  available: readonly number[],
  from: number,
  to: number,
): number[] {
  return fixtureSourceWeeks(available).filter(
    (week) => week >= Math.min(from, to) && week <= Math.max(from, to),
  );
}

// Explicit selections use source GW numbers, independent of the selected pitch GW.
// An empty selection remains empty; unavailable/expired weeks never become columns.
export function fixtureSelectedWeeks(
  available: readonly number[],
  selected: readonly number[] | null,
  gw: number,
  horizon: number,
): number[] {
  return selected === null
    ? fixtureHorizonWeeks(available, gw, horizon)
    : fixtureSourceWeeks(available).filter((week) => selected.includes(week));
}

export function fixtureTeamForecast(
  players: readonly Player[],
  team: number,
  gw: number,
): Forecast | undefined {
  return (
    players.find(
      (player) =>
        player.team === team &&
        player.position_id === 1 &&
        player.gw[String(gw)],
    ) ?? players.find((player) => player.team === team && player.gw[String(gw)])
  )?.gw[String(gw)];
}

export function fixtureMetricValue(
  forecast: Forecast,
  index: number,
  metric: FixtureMetric,
): number {
  const fixture = forecast.fixtures[index];
  if (metric === "cs")
    return (
      forecast.stat_scenario?.base.clean_sheet_probabilities[index] ??
      fixture.cs
    );
  if (metric === "goals") return fixture.team_goals;
  if (metric === "gd") return fixture.team_goals - fixture.conceded;
  return fixture.difficulty;
}

export function fixtureTotal(
  forecasts: readonly (Forecast | undefined)[],
  metric: FixtureMetric,
): number | null {
  if (forecasts.some((forecast) => forecast === undefined)) return null;
  const values = forecasts.flatMap(
    (forecast) =>
      forecast?.fixtures.map((_, index) =>
        fixtureMetricValue(forecast, index, metric),
      ) ?? [],
  );
  if (metric === "difficulty")
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  // Additive totals include every fixture in doubles; CS is an expected count.
  return values.reduce((sum, value) => sum + value, 0);
}

export function fixtureSortForWeeks(
  sort: FixtureSort,
  weeks: readonly number[],
): FixtureSort {
  return typeof sort.column === "number" && !weeks.includes(sort.column)
    ? { ...sort, column: "total" }
    : sort;
}

export function fixtureRows(
  data: Pick<Bootstrap, "teams" | "players">,
  weeks: readonly number[],
  metric: FixtureMetric,
  selectedTeams: readonly number[] | null,
  sort: FixtureSort,
): FixtureRow[] {
  const effectiveSort = fixtureSortForWeeks(sort, weeks);
  const rows = data.teams
    .filter((team) => selectedTeams === null || selectedTeams.includes(team.id))
    .map((team) => {
      const forecasts = Object.fromEntries(
        weeks.map((week) => [
          String(week),
          fixtureTeamForecast(data.players, team.id, week),
        ]),
      );
      return {
        team,
        forecasts,
        total: fixtureTotal(Object.values(forecasts), metric),
      };
    });
  return rows.sort((a, b) => {
    if (effectiveSort.column === "club")
      return (
        a.team.name.localeCompare(b.team.name) *
        (effectiveSort.direction === "ascending" ? 1 : -1)
      );
    const value = (row: FixtureRow) =>
      effectiveSort.column === "total"
        ? row.total
        : fixtureTotal([row.forecasts[String(effectiveSort.column)]], metric);
    const av = value(a),
      bv = value(b);
    if (av === null || bv === null)
      return av === bv
        ? a.team.name.localeCompare(b.team.name)
        : av === null
          ? 1
          : -1;
    return (
      (av - bv) * (effectiveSort.direction === "ascending" ? 1 : -1) ||
      a.team.name.localeCompare(b.team.name)
    );
  });
}

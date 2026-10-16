import { matchesPlayerQuery, playerSearchTerms } from "./playerSearch";
import type { Bootstrap, Source } from "./types";

export type StatsMode = "players" | "teams";
export type StatsGroup =
  "All" | "FPL" | "Attacking" | "Defending" | "Goalkeeping";
export type StatRow = {
  id: number;
  code: number;
  name: string;
  full_name: string;
  position: string;
  team: number;
  team_code: number;
  team_name: string;
  team_short: string;
  stats: Record<string, number | null>;
};
export type SeasonTeam = {
  id: number;
  code: number;
  name: string;
  short_name: string;
  stats: Record<string, number | null>;
};
export type SeasonStats = {
  season: string;
  source: Source;
  fixture_source?: Source | null;
  players: StatRow[];
  teams: SeasonTeam[];
  maps?: { available: boolean; reason: string };
  coverage?: Record<string, unknown>;
};
export type StatsMetric = {
  key: string;
  label: string;
  group: Exclude<StatsGroup, "All">;
  per90?: boolean;
  decimals?: number;
  description?: string;
};
export const PLAYER_METRICS: readonly StatsMetric[] = [
  { key: "minutes", label: "Minutes", group: "FPL" },
  { key: "total_points", label: "FPL pts", group: "FPL", per90: true },
  { key: "price", label: "Price £m", group: "FPL", decimals: 1 },
  { key: "ownership", label: "Owned %", group: "FPL", decimals: 1 },
  { key: "starts", label: "Starts", group: "FPL" },
  { key: "bonus", label: "Bonus", group: "FPL", per90: true },
  { key: "bps", label: "BPS", group: "FPL", per90: true },
  { key: "goals_scored", label: "Goals", group: "Attacking", per90: true },
  { key: "assists", label: "Assists", group: "Attacking", per90: true },
  {
    key: "expected_goals",
    label: "xG",
    group: "Attacking",
    per90: true,
    decimals: 2,
    description:
      "Official FPL underlying xG from matches played; not a forecast.",
  },
  {
    key: "expected_assists",
    label: "xA",
    group: "Attacking",
    per90: true,
    decimals: 2,
    description:
      "Official FPL underlying xA from matches played; not a forecast.",
  },
  {
    key: "expected_goal_involvements",
    label: "xGI",
    group: "Attacking",
    per90: true,
    decimals: 2,
  },
  {
    key: "penalties_missed",
    label: "Pens missed",
    group: "Attacking",
    per90: true,
  },
  { key: "influence", label: "Influence", group: "Attacking", decimals: 1 },
  { key: "creativity", label: "Creativity", group: "Attacking", decimals: 1 },
  { key: "threat", label: "Threat", group: "Attacking", decimals: 1 },
  { key: "ict_index", label: "ICT", group: "Attacking", decimals: 1 },
  {
    key: "clean_sheets",
    label: "CS",
    group: "Defending",
    per90: true,
    description: "Player FPL clean sheets; these are not team clean sheets.",
  },
  { key: "goals_conceded", label: "Conceded", group: "Defending", per90: true },
  {
    key: "expected_goals_conceded",
    label: "xGC",
    group: "Defending",
    per90: true,
    decimals: 2,
  },
  {
    key: "defensive_contribution",
    label: "DefCon",
    group: "Defending",
    per90: true,
  },
  { key: "tackles", label: "Tackles", group: "Defending", per90: true },
  { key: "recoveries", label: "Recoveries", group: "Defending", per90: true },
  {
    key: "clearances_blocks_interceptions",
    label: "CBI",
    group: "Defending",
    per90: true,
  },
  { key: "own_goals", label: "Own goals", group: "Defending", per90: true },
  { key: "yellow_cards", label: "Yellow", group: "Defending", per90: true },
  { key: "red_cards", label: "Red", group: "Defending", per90: true },
  { key: "saves", label: "Saves", group: "Goalkeeping", per90: true },
  {
    key: "penalties_saved",
    label: "Pens saved",
    group: "Goalkeeping",
    per90: true,
  },
];
export const TEAM_METRICS: readonly StatsMetric[] = [
  { key: "games", label: "Played", group: "FPL" },
  {
    key: "points",
    label: "Result pts",
    group: "FPL",
    description:
      "Three points per win and one per draw from completed fixtures; excludes points deductions.",
  },
  { key: "wins", label: "Wins", group: "FPL" },
  { key: "draws", label: "Draws", group: "FPL" },
  { key: "losses", label: "Losses", group: "FPL" },
  { key: "goals_scored", label: "Goals", group: "Attacking", per90: true },
  { key: "goal_difference", label: "GD", group: "Attacking", per90: true },
  { key: "goals_conceded", label: "Conceded", group: "Defending", per90: true },
  { key: "clean_sheets", label: "CS", group: "Defending", per90: true },
];
export const DEFAULT_PLAYER_COLUMNS = [
  "minutes",
  "total_points",
  "goals_scored",
  "assists",
  "expected_goals",
  "expected_assists",
  "clean_sheets",
];
export const DEFAULT_TEAM_COLUMNS = TEAM_METRICS.map((metric) => metric.key);
export const STATS_GROUPS: readonly StatsGroup[] = [
  "All",
  "FPL",
  "Attacking",
  "Defending",
  "Goalkeeping",
];

export function statValue(
  row: StatRow,
  metric: StatsMetric,
  per90: boolean,
): number | null {
  const value = row.stats[metric.key];
  if (value == null || !Number.isFinite(value)) return null;
  if (!per90 || !metric.per90) return value;
  const minutes = row.stats.minutes;
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  return (value * 90) / minutes;
}

export function statLabel(metric: StatsMetric, per90: boolean): string {
  return metric.label + (per90 && metric.per90 ? " /90" : "");
}

export function formatStat(
  value: number | null,
  metric: StatsMetric,
  per90: boolean,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-GB", {
    minimumFractionDigits: per90 && metric.per90 ? 2 : (metric.decimals ?? 0),
    maximumFractionDigits: per90 && metric.per90 ? 2 : (metric.decimals ?? 0),
  });
}

export function sortStatRows(
  rows: readonly StatRow[],
  metric: StatsMetric | null,
  direction: "asc" | "desc",
  per90: boolean,
): StatRow[] {
  return [...rows].sort((a, b) => {
    if (!metric)
      return (
        (direction === "asc" ? 1 : -1) * a.name.localeCompare(b.name) ||
        a.id - b.id
      );
    const av = statValue(a, metric, per90),
      bv = statValue(b, metric, per90);
    // Missing data stays last in both sort directions.
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    return (
      (av == null || bv == null
        ? 0
        : direction === "asc"
          ? av - bv
          : bv - av) ||
      a.name.localeCompare(b.name) ||
      a.id - b.id
    );
  });
}

export function filterStatRows(
  rows: readonly StatRow[],
  filters: {
    query: string;
    position: string;
    team: string;
    minMinutes: number;
  },
): StatRow[] {
  const terms = playerSearchTerms(filters.query);
  return rows.filter(
    (row) =>
      matchesPlayerQuery(row, terms) &&
      (!filters.position || row.position === filters.position) &&
      (!filters.team || row.team === Number(filters.team)) &&
      (filters.minMinutes <= 0 ||
        (row.stats.minutes != null && row.stats.minutes >= filters.minMinutes)),
  );
}

export function teamStatRows(teams: readonly SeasonTeam[]): StatRow[] {
  return teams.map((team) => ({
    id: team.id,
    code: team.code,
    name: team.name,
    full_name: team.name,
    position: "",
    team: team.id,
    team_code: team.code,
    team_name: team.name,
    team_short: team.short_name,
    stats: {
      ...team.stats,
      // A team match is one 90-minute exposure, rather than eleven player
      // exposures. No stoppage-time or event data is inferred.
      minutes:
        team.stats.games != null && Number.isFinite(team.stats.games)
          ? team.stats.games * 90
          : null,
    },
  }));
}

// This fallback only uses explicit official fields in Bootstrap. Its model xg90,
// xa90, xmins and all player.gw values must never enter the season stats tool.
export function bootstrapSeasonStats(data: Bootstrap): SeasonStats {
  return {
    season: data.season,
    source: data.sources.fpl_bootstrap ?? {
      url: "https://fantasy.premierleague.com/api/bootstrap-static/",
      status: "unavailable",
      fetched_at: null,
    },
    players: data.players.map((player) => ({
      id: player.id,
      code: player.code,
      name: player.name,
      full_name: player.full_name,
      position: player.position,
      team: player.team,
      team_code: player.team_code,
      team_name: player.team_name,
      team_short: player.team_short,
      stats: {
        minutes: player.minutes,
        total_points: player.total_points,
        price: player.price,
        ownership: player.ownership,
      },
    })),
    teams: data.teams.map((team) => ({ ...team, stats: {} })),
  };
}

export type SavedStatsView = {
  id: string;
  name: string;
  mode: StatsMode;
  columns: string[];
};
export function sanitiseStatsViews(value: unknown): SavedStatsView[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item): SavedStatsView[] => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !item.id ||
      seen.has(item.id) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      !["players", "teams"].includes(item.mode) ||
      !Array.isArray(item.columns)
    )
      return [];
    const keys = new Set(
      (item.mode === "players" ? PLAYER_METRICS : TEAM_METRICS).map(
        (metric) => metric.key,
      ),
    );
    const columns = [
      ...new Set<string>(
        item.columns.filter(
          (key: unknown) => typeof key === "string" && keys.has(key),
        ),
      ),
    ];
    if (!columns.length) return [];
    seen.add(item.id);
    return [
      {
        id: item.id,
        name: item.name.trim().slice(0, 48),
        mode: item.mode,
        columns,
      },
    ];
  });
}

export function moveStatsColumn(
  columns: readonly string[],
  key: string,
  direction: -1 | 1,
): string[] {
  const result = [...columns],
    index = result.indexOf(key),
    target = index + direction;
  if (index >= 0 && target >= 0 && target < result.length)
    [result[index], result[target]] = [result[target], result[index]];
  return result;
}

export function scatterStats(
  rows: readonly StatRow[],
  xMetric: StatsMetric,
  yMetric: StatsMetric,
  per90: boolean,
) {
  const points = rows.flatMap((row) => {
    const x = statValue(row, xMetric, per90),
      y = statValue(row, yMetric, per90);
    return x == null || y == null ? [] : [{ row, x, y }];
  });
  const domain = (values: number[]) => {
    const low = Math.min(0, ...values),
      high = Math.max(0, ...values);
    return { min: low, max: low === high ? high + 1 : high };
  };
  return {
    points,
    missing: rows.length - points.length,
    x: domain(points.map((point) => point.x)),
    y: domain(points.map((point) => point.y)),
  };
}

import { describe, expect, it } from "vitest";
import {
  bootstrapSeasonStats,
  filterStatRows,
  formatStat,
  moveStatsColumn,
  PLAYER_METRICS,
  sanitiseStatsViews,
  scatterStats,
  sortStatRows,
  statValue,
  teamStatRows,
  type StatRow,
} from "./seasonDataModel";
import type { Bootstrap } from "./types";

const goals = PLAYER_METRICS.find((metric) => metric.key === "goals_scored")!;
const price = PLAYER_METRICS.find((metric) => metric.key === "price")!;
const minutes = PLAYER_METRICS.find((metric) => metric.key === "minutes")!;
const row = (
  id: number,
  name: string,
  stats: StatRow["stats"],
  extra: Partial<StatRow> = {},
): StatRow => ({
  id,
  code: id + 1000,
  name,
  full_name: name,
  position: "FWD",
  team: 1,
  team_code: 3,
  team_name: "Arsenal",
  team_short: "ARS",
  stats,
  ...extra,
});

describe("observed season stats", () => {
  it("normalises only eligible counting totals and preserves missingness", () => {
    const player = row(1, "A", { goals_scored: 3, minutes: 180, price: 9.5 });
    expect(statValue(player, goals, true)).toBe(1.5);
    expect(statValue(player, goals, false)).toBe(3);
    expect(statValue(player, minutes, true)).toBe(180);
    expect(statValue(player, price, true)).toBe(9.5);
    expect(
      statValue(row(2, "B", { goals_scored: 0, minutes: 0 }), goals, true),
    ).toBeNull();
    expect(
      statValue(row(2, "B", { goals_scored: null, minutes: 90 }), goals, true),
    ).toBeNull();
    expect(
      statValue(row(2, "B", { goals_scored: 0, minutes: 90 }), goals, true),
    ).toBe(0);
    expect(
      statValue(
        row(2, "B", { goals_scored: Infinity, minutes: 90 }),
        goals,
        false,
      ),
    ).toBeNull();
    expect(formatStat(null, goals, true)).toBe("—");
    expect(formatStat(1.5, goals, true)).toBe("1.50");
  });
  it("keeps unknowns last in either sort direction and sorts actual per90 values", () => {
    const rows = [
      row(1, "A", { goals_scored: 3, minutes: 900 }),
      row(2, "B", { goals_scored: 2, minutes: 90 }),
      row(3, "C", {}),
    ];
    expect(
      sortStatRows(rows, goals, "desc", false).map((item) => item.id),
    ).toEqual([1, 2, 3]);
    expect(
      sortStatRows(rows, goals, "desc", true).map((item) => item.id),
    ).toEqual([2, 1, 3]);
    expect(
      sortStatRows(rows, goals, "asc", true).map((item) => item.id),
    ).toEqual([1, 2, 3]);
    expect(rows.map((item) => item.id)).toEqual([1, 2, 3]);
  });
  it("ORs comma and pipe searches while retaining position, team and minutes filters", () => {
    const rows = [
      row(1, "Haaland", { minutes: 540 }, { team: 2 }),
      row(2, "Saka", { minutes: 450 }, { position: "MID" }),
      row(3, "Saka reserve", { minutes: 0 }, { position: "MID" }),
      row(4, "Other", { minutes: 500 }),
    ];
    const filters = {
      query: " Haaland, Saka ",
      position: "",
      team: "",
      minMinutes: 1,
    };
    expect(filterStatRows(rows, filters).map((item) => item.id)).toEqual([
      1, 2,
    ]);
    expect(
      filterStatRows(rows, { ...filters, query: "Haaland | Saka" }),
    ).toEqual(filterStatRows(rows, filters));
    expect(
      filterStatRows(rows, { ...filters, position: "MID", team: "1" }).map(
        (item) => item.id,
      ),
    ).toEqual([2]);
    expect(
      filterStatRows([row(5, "Unknown mins", {})], {
        ...filters,
        query: "",
        minMinutes: 1,
      }),
    ).toEqual([]);
  });
  it("plots only paired observations without replacing absent coordinates with zeros", () => {
    const rows = [
      row(1, "A", { minutes: 90, goals_scored: 0 }),
      row(2, "B", { minutes: 180, goals_scored: 3 }),
      row(3, "C", { minutes: 20 }),
    ];
    const plot = scatterStats(rows, minutes, goals, false);
    expect(
      plot.points.map((point) => [point.row.id, point.x, point.y]),
    ).toEqual([
      [1, 90, 0],
      [2, 180, 3],
    ]);
    expect(plot.missing).toBe(1);
    expect(plot.x).toEqual({ min: 0, max: 180 });
    expect(scatterStats([], minutes, goals, false).y).toEqual({
      min: 0,
      max: 1,
    });
  });
  it("uses explicit Bootstrap observed fields only, never model rates or predictions", () => {
    const data = {
      season: "2026-27",
      sources: {
        fpl_bootstrap: {
          status: "cached",
          fetched_at: "2026-10-15T16:32:51Z",
          url: "https://fantasy.premierleague.com/api/bootstrap-static/",
        },
      },
      teams: [{ id: 1, code: 3, name: "Arsenal", short_name: "ARS" }],
      players: [
        {
          ...row(1, "A", {}),
          minutes: 540,
          total_points: 30,
          price: 8.0,
          ownership: 5.0,
          xg90: 99,
          xa90: 99,
          gw: { "7": { points: 123 } },
        },
      ],
    } as unknown as Bootstrap;
    const fallback = bootstrapSeasonStats(data);
    expect(fallback.players[0].stats).toEqual({
      minutes: 540,
      total_points: 30,
      price: 8.0,
      ownership: 5.0,
    });
    expect(fallback.players[0].code).toBe(1001);
    expect(fallback.source).toBe(data.sources.fpl_bootstrap);
    expect(teamStatRows(fallback.teams)[0].stats).toEqual({ minutes: null });
  });
  it("validates local saved columns, preserves order and separates entity types", () => {
    const saved = sanitiseStatsViews([
      {
        id: "p",
        name: " Attack ",
        mode: "players",
        columns: ["goals_scored", "minutes", "goals_scored", "gw", "xg90", 42],
      },
      { id: "p", name: "Duplicate", mode: "players", columns: ["minutes"] },
      {
        id: "t",
        name: "Teams",
        mode: "teams",
        columns: ["goals_scored", "price"],
      },
      { id: "bad", name: "", mode: "players", columns: ["minutes"] },
    ]);
    expect(saved).toEqual([
      {
        id: "p",
        name: "Attack",
        mode: "players",
        columns: ["goals_scored", "minutes"],
      },
      { id: "t", name: "Teams", mode: "teams", columns: ["goals_scored"] },
    ]);
    expect(sanitiseStatsViews("invalid")).toEqual([]);
    expect(moveStatsColumn(saved[0].columns, "minutes", -1)).toEqual([
      "minutes",
      "goals_scored",
    ]);
    expect(moveStatsColumn(saved[0].columns, "goals_scored", -1)).toEqual(
      saved[0].columns,
    );
  });
});

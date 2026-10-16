import { describe, expect, it } from "vitest";
import {
  fixtureMetricValue,
  fixtureRangeWeeks,
  fixtureRows,
  fixtureSelectedWeeks,
  fixtureSortForWeeks,
  fixtureSourceWeeks,
  fixtureTeamForecast,
  fixtureTotal,
} from "./fixtureData";
import type { Bootstrap, Fixture, Forecast, Player } from "./types";
import type { FixtureSort } from "./fixtureData";

const fixture = (
  team_goals: number,
  conceded: number,
  cs: number,
  difficulty = 3,
) => ({ team_goals, conceded, cs, difficulty }) as Fixture;
const forecast = (...fixtures: Fixture[]) => ({ fixtures }) as Forecast;
const available = Array.from({ length: 32 }, (_, i) => i + 7);
const clubs = [
  { id: 1, name: "Alpha", short_name: "ALP", code: 1 },
  { id: 2, name: "Beta", short_name: "BET", code: 2 },
];
const data = {
  teams: clubs,
  players: [
    {
      id: 1,
      team: 1,
      position_id: 1,
      gw: { 7: forecast(fixture(2, 1, 0.4)), 8: forecast(fixture(1, 2, 0.3)) },
    },
    {
      id: 2,
      team: 2,
      position_id: 1,
      gw: { 7: forecast(fixture(1, 2, 0.3)), 8: forecast(fixture(3, 1, 0.5)) },
    },
  ] as unknown as Player[],
} satisfies Pick<Bootstrap, "teams" | "players">;

describe("sourced fixture ticker", () => {
  it("covers every remaining GW through 38 and never invents unavailable weeks", () => {
    expect(fixtureSourceWeeks([...available, 38, 0, 39, 7.5])).toEqual(
      available,
    );
    expect(fixtureSelectedWeeks(available, null, 7, 32)).toEqual(available);
    expect(fixtureSelectedWeeks(available, null, 38, 10)).toEqual([38]);
    expect(fixtureRangeWeeks([7, 9, 11], 11, 7)).toEqual([7, 9, 11]);
  });
  it("keeps explicit selections independent of the pitch and respects clearing", () => {
    expect(fixtureSelectedWeeks(available, [7, 9, 38], 20, 5)).toEqual([
      7, 9, 38,
    ]);
    expect(fixtureSelectedWeeks(available, [], 7, 5)).toEqual([]);
    expect(fixtureSelectedWeeks(available, [6, 7, 39], 7, 5)).toEqual([7]);
  });
  it("counts both fixtures in doubles and distinguishes a blank from missing data", () => {
    const double = forecast(fixture(2, 0.5, 0.6, 2), fixture(1, 2, 0.2, 4));
    expect(fixtureTotal([double, forecast()], "goals")).toBe(3);
    expect(fixtureTotal([double], "gd")).toBe(0.5);
    expect(fixtureTotal([double], "cs")).toBeCloseTo(0.8);
    expect(fixtureTotal([double, forecast()], "difficulty")).toBe(3);
    expect(fixtureTotal([forecast()], "goals")).toBe(0);
    expect(fixtureTotal([forecast()], "difficulty")).toBeNull();
    expect(fixtureTotal([double, undefined], "goals")).toBeNull();
  });
  it("does not turn a player's manual CS scenario into sourced team odds", () => {
    const edited = {
      ...forecast(fixture(2, 1, 0.99)),
      stat_scenario: { base: { clean_sheet_probabilities: [0.4] } },
    } as Forecast;
    expect(fixtureMetricValue(edited, 0, "cs")).toBe(0.4);
    expect(fixtureTotal([edited], "cs")).toBe(0.4);
  });
  it("sorts the chosen GW independently of the horizon and toggles direction", () => {
    expect(
      fixtureRows(data, [7, 8], "goals", null, {
        column: 7,
        direction: "descending",
      }).map((row) => row.team.id),
    ).toEqual([1, 2]);
    expect(
      fixtureRows(data, [7, 8], "goals", null, {
        column: "total",
        direction: "descending",
      }).map((row) => row.team.id),
    ).toEqual([2, 1]);
    expect(
      fixtureRows(data, [7, 8], "goals", null, {
        column: 7,
        direction: "ascending",
      }).map((row) => row.team.id),
    ).toEqual([2, 1]);
  });
  it("filters clubs without changing forecasts and falls back when a sorted GW is removed", () => {
    expect(
      fixtureRows(data, [8], "goals", [1], {
        column: 7,
        direction: "descending",
      }).map((row) => row.team.id),
    ).toEqual([1]);
    expect(
      fixtureRows(data, [7], "goals", [], {
        column: "total",
        direction: "descending",
      }),
    ).toEqual([]);
    expect(
      fixtureSortForWeeks({ column: 7, direction: "descending" }, [8]),
    ).toEqual({ column: "total", direction: "descending" });
    expect(data.players[0].gw["7"].fixtures[0].team_goals).toBe(2);
  });
  it("recomputes totals and ranking when an interior Free Hit week is excluded", () => {
    const withThirdWeek = {
      ...data,
      players: data.players.map((player) => ({
        ...player,
        gw: { ...player.gw, 9: forecast() },
      })),
    };
    const sort = { column: "total", direction: "descending" } as const;
    expect(
      fixtureRows(withThirdWeek, [7, 8, 9], "goals", null, sort).map((row) => [
        row.team.id,
        row.total,
      ]),
    ).toEqual([
      [2, 4],
      [1, 3],
    ]);
    const selected = fixtureSelectedWeeks([7, 8, 9], [7, 9], 7, 3);
    expect(
      fixtureRows(withThirdWeek, selected, "goals", null, sort).map((row) => [
        row.team.id,
        row.total,
      ]),
    ).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });
  it.each(["goals", "cs", "gd"] as const)(
    "sorts selected-horizon %s totals in both directions",
    (metric) => {
      const ranked = (direction: FixtureSort["direction"]) =>
        fixtureRows(data, [7, 8], metric, null, {
          column: "total",
          direction,
        }).map((row) => row.team.id);
      expect(ranked("descending")).toEqual([2, 1]);
      expect(ranked("ascending")).toEqual([1, 2]);
    },
  );
  it("preserves sourced metrics when the representative keeper has manual player edits", () => {
    const changed = {
      ...data,
      players: data.players.map((player) =>
        player.id === 1
          ? {
              ...player,
              gw: {
                ...player.gw,
                7: {
                  ...player.gw["7"],
                  fixtures: [
                    {
                      ...player.gw["7"].fixtures[0],
                      cs: 0.99,
                      xg: 9,
                      points: 30,
                    },
                  ],
                  stat_scenario: { base: { clean_sheet_probabilities: [0.4] } },
                } as Forecast,
              },
            }
          : player,
      ),
    };
    for (const metric of ["goals", "cs", "gd"] as const) {
      const sort = { column: "total", direction: "descending" } as const;
      expect(fixtureRows(changed, [7, 8], metric, null, sort)).toMatchObject(
        fixtureRows(data, [7, 8], metric, null, sort).map(
          ({ team, total }) => ({ team, total }),
        ),
      );
    }
    expect(changed.players[0].gw["7"].fixtures[0].cs).toBe(0.99);
  });
  it("uses a player with the requested GW and leaves missing clubs unavailable", () => {
    const players = [
      { ...data.players[0], gw: {} },
      { ...data.players[0], id: 3, position_id: 2 },
    ];
    expect(fixtureTeamForecast(players, 1, 7)).toBe(data.players[0].gw["7"]);
    expect(fixtureTeamForecast(players, 1, 38)).toBeUndefined();
    expect(fixtureTeamForecast(players, 2, 7)).toBeUndefined();
    for (const direction of ["ascending", "descending"] as const) {
      const rows = fixtureRows({ teams: clubs, players }, [7], "goals", null, {
        column: "total",
        direction,
      });
      expect(rows.map((row) => row.total)).toEqual([2, null]);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  assumedFixtureGW,
  fixtureKey,
  movableFixtures,
  moveFixture,
  normalizeFixtureMoves,
  parseFixtureCatalog,
  resetFixture,
  scheduleWindow,
} from "./fixtureScheduleModel";
import type { FixtureCatalog } from "./fixtureScheduleModel";

const catalog: FixtureCatalog = {
  season: "2026-27",
  next_gw: 7,
  gameweeks: Array.from({ length: 32 }, (_, index) => index + 7),
  fixtures: [
    {
      id: 71,
      event: 7,
      team_h: 1,
      team_a: 2,
      kickoff_time: "2026-10-17T12:00:00Z",
    },
    { id: 72, event: 8, team_h: 2, team_a: 1, kickoff_time: null },
    { id: 73, event: null, team_h: 1, team_a: 2, kickoff_time: null },
    { id: 74, event: 9, team_h: 1, team_a: 999, kickoff_time: null },
  ],
};
const fixtures = movableFixtures(catalog, [1, 2]);

describe("official fixture scenario configuration", () => {
  it("preserves canonical fixture identity, both clubs, kickoff and official GW", () => {
    const before = structuredClone(catalog);
    const moves = moveFixture({}, "71", 38, fixtures, catalog.gameweeks)!;
    expect(moves).toEqual({ "71": 38 });
    expect(assumedFixtureGW(catalog.fixtures[0], moves)).toBe(38);
    expect(catalog).toEqual(before);
    expect(fixtureKey(71)).toBe("71");
    for (const value of [
      "071",
      "71.0",
      " 71",
      "7e1",
      "0",
      "-1",
      "Infinity",
      NaN,
      Infinity,
      true,
      1.5,
    ]) {
      expect(fixtureKey(value)).toBeNull();
    }
  });
  it("retains Unset fixtures independently of forecast membership and restores them", () => {
    const moves = moveFixture({}, "71", null, fixtures, catalog.gameweeks)!;
    expect(assumedFixtureGW(catalog.fixtures[0], moves)).toBeNull();
    expect(assumedFixtureGW(catalog.fixtures[2], {})).toBeNull();
    expect(moveFixture(moves, "73", 25, fixtures, catalog.gameweeks)).toEqual({
      "71": null,
      "73": 25,
    });
    expect(moveFixture(moves, "71", 7, fixtures, catalog.gameweeks)).toEqual(
      {},
    );
  });
  it("allows arbitrary remaining GWs including GW38, regardless of the display window", () => {
    expect(scheduleWindow(catalog.gameweeks, 7, 5)).toEqual([7, 8, 9, 10, 11]);
    expect(moveFixture({}, "71", 37, fixtures, catalog.gameweeks)).toEqual({
      "71": 37,
    });
    expect(scheduleWindow(catalog.gameweeks, 38, 10)).toEqual([38]);
    expect(scheduleWindow(catalog.gameweeks, 38, 38)).toEqual(
      catalog.gameweeks,
    );
  });
  it("rejects unknown IDs/clubs, past weeks and nonnumeric/nonfinite targets", () => {
    expect(fixtures.map((row) => row.id)).toEqual([71, 72, 73]);
    expect(catalog.fixtures.find((row) => row.id === 74)?.team_a).toBe(999);
    for (const id of ["74", "999", "071", "__proto__", "constructor"]) {
      expect(moveFixture({}, id, 10, fixtures, catalog.gameweeks)).toBeNull();
    }
    for (const value of [
      "10",
      "",
      true,
      false,
      NaN,
      Infinity,
      9.5,
      6,
      39,
      undefined,
    ]) {
      expect(
        moveFixture({}, "71", value, fixtures, catalog.gameweeks),
      ).toBeNull();
    }
  });
  it("normalizes identity moves and invalid entries without mutating saved configuration", () => {
    const raw = Object.freeze({
      "71": 7,
      "72": null,
      "73": null,
      "74": 10,
      "999": 10,
      "071": 12,
    });
    expect(normalizeFixtureMoves(raw, fixtures, catalog.gameweeks)).toEqual({
      "72": null,
    });
    expect(raw["71"]).toBe(7);
    expect(
      normalizeFixtureMoves(
        { "71": "12", "72": NaN },
        fixtures,
        catalog.gameweeks,
      ),
    ).toEqual({});
  });
  it("reset restores official schedule and preserves other valid moves immutably", () => {
    const moves = Object.freeze({ "71": null, "72": 38 });
    expect(resetFixture(moves, "71", fixtures, catalog.gameweeks)).toEqual({
      "72": 38,
    });
    expect(moves).toEqual({ "71": null, "72": 38 });
    const resetAll = {};
    expect(assumedFixtureGW(catalog.fixtures[0], resetAll)).toBe(7);
    expect(assumedFixtureGW(catalog.fixtures[2], resetAll)).toBeNull();
  });
  it("validates catalog without inventing fixtures or hiding unknown numeric clubs", () => {
    expect(parseFixtureCatalog(catalog)).toBe(catalog);
    expect(parseFixtureCatalog(catalog).fixtures).toHaveLength(4);
    for (const patch of [
      { fixtures: [...catalog.fixtures, catalog.fixtures[0]] },
      { fixtures: [{ ...catalog.fixtures[0], id: "71" }] },
      { fixtures: [{ ...catalog.fixtures[0], team_h: "1" }] },
      { fixtures: [{ ...catalog.fixtures[0], event: 6 }] },
      { gameweeks: [7, 7] },
      { next_gw: NaN },
      { fixtures: null },
    ])
      expect(() => parseFixtureCatalog({ ...catalog, ...patch })).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { parseCSV, optimalLineup, projectionCSV } from "./lib";
import type { Player } from "./types";
describe("CSV interoperability", () => {
  it("handles quoted commas, CRLF, BOM and escaped quotes", () =>
    expect(
      parseCSV(
        '\uFEFFplayer_id,name,expected_points\r\n1,"Smith, \"\"John\"\"",5.2\r\n',
      ),
    ).toEqual([
      { player_id: "1", name: 'Smith, "John"', expected_points: "5.2" },
    ]));
  it("rejects unclosed quoted cells", () =>
    expect(() => parseCSV('id,name\n1,"Smith')).toThrow());
});
describe("provider exports", () => {
  it("accepts FPL Review wide gameweek columns", () => {
    const parsed = projectionCSV(
      "ID,Name,6_Pts,7_Pts,6_xMins\n12,Saka,5.4,6.1,78",
      new Set([12]),
      [6, 7, 8],
    );
    expect(parsed.points).toEqual({ "12": { "6": 5.4, "7": 6.1 } });
    expect(parsed.minutes).toEqual({});
  });
  it("uses unconditional FPL Form points", () => {
    const parsed = projectionCSV(
      "ID,6_pts_no_prob,6_prob,6_with_prob\n12,7,.5,3.5",
      new Set([12]),
      [6, 7],
    );
    expect(parsed.points).toEqual({ "12": { "6": 3.5 } });
  });
  it("rejects duplicated fixture rows rather than losing double points", () => {
    expect(() =>
      projectionCSV(
        "player_id,gameweek,expected_points\n12,6,3\n12,6,4",
        new Set([12]),
        [6],
      ),
    ).toThrow("Duplicate forecast");
  });
});
describe("weekly minutes imports", () => {
  it("keeps different GW assumptions distinct and preserves availability zero", () => {
    const result = projectionCSV(
      "player_id,gameweek,conditional_minutes,availability\n12,6,0,0\n12,8,90,1",
      new Set([12]),
      [6, 7, 8],
    );
    expect(result.minutes).toEqual({});
    expect(result.schedules).toEqual({
      "12": {
        "6": { conditional_minutes: 0, availability: 0 },
        "8": { conditional_minutes: 90, availability: 1 },
      },
    });
  });
  it("retains legacy global duration imports", () => {
    expect(
      projectionCSV("player_id,conditional_minutes\n12,75", new Set([12]), [6])
        .minutes,
    ).toEqual({ "12": 75 });
  });
  it("rejects repeated GW assumptions, missing GW for availability and percentage units", () => {
    expect(() =>
      projectionCSV(
        "player_id,gameweek,conditional_minutes\n12,6,70\n12,6,80",
        new Set([12]),
        [6],
      ),
    ).toThrow("Duplicate minutes");
    expect(() =>
      projectionCSV("player_id,availability\n12,1", new Set([12]), [6]),
    ).toThrow("require a gameweek");
    expect(() =>
      projectionCSV(
        "player_id,gameweek,availability\n12,6,50",
        new Set([12]),
        [6],
      ),
    ).toThrow("between 0 and 1");
  });
});
describe("lineup selection", () => {
  it("keeps a legal formation even when all midfielders dominate", () => {
    let id = 1;
    const players: Player[] = [];
    for (const [pos, n] of [
      [1, 2],
      [2, 5],
      [3, 5],
      [4, 3],
    ])
      for (let j = 0; j < n; j++)
        players.push({
          id: id++,
          position_id: pos,
          gw: { "6": { points: pos === 3 ? 10 : 3 + j / 10 } },
        } as unknown as Player);
    const l = optimalLineup(
      players.map((p) => p.id),
      players,
      6,
    );
    expect(l.starters).toHaveLength(11);
    expect(l.bench).toHaveLength(4);
    expect(new Set(l.starters).size).toBe(11);
    expect(
      l.starters.filter(
        (i) => players.find((p) => p.id === i)!.position_id === 2,
      ).length,
    ).toBeGreaterThanOrEqual(3);
    expect(l.starters).toContain(l.captain);
    expect(l.captain).not.toBe(l.vice);
    expect(players.find((p) => p.id === l.bench[0])!.position_id).toBe(1);
  });
});

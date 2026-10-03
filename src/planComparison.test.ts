import { describe, expect, it } from "vitest";
import { alignPlanGameweeks } from "./planComparison";
import type { Plan, Week } from "./types";

function plan(id: string, rows: [number, number, number][]): Plan {
  return {
    id,
    name: id,
    weeks: rows.map(
      ([gw, net_points, hits]) =>
        ({
          gw,
          points: net_points + hits,
          net_points,
          hits,
        }) as Week,
    ),
    base_squad: [],
    base_bank: 0,
    free_transfers: 1,
    purchase_prices: {},
    created_at: "2026-10-03T00:00:00Z",
  };
}

describe("plan comparisons", () => {
  it("aligns future-start and longer plans by actual GW, including hit deductions", () => {
    const result = alignPlanGameweeks([
      plan("current", [
        [6, 50, 0],
        [7, 60, 0],
        [8, 70, 4],
        [9, 80, 0],
      ]),
      plan("future", [
        [10, 100, 0],
        [9, 90, 0],
        [8, 75, 8],
      ]),
    ]);
    expect(result.gameweeks).toEqual([8, 9]);
    expect(
      result.plans.map((row) => row.weeks.map((week) => week.net_points)),
    ).toEqual([
      [70, 80],
      [75, 90],
    ]);
    expect(result.plans.map((row) => [row.points, row.hits])).toEqual([
      [150, 4],
      [165, 8],
    ]);
  });

  it("compares only shared weeks when an intermediate GW is absent", () => {
    const result = alignPlanGameweeks([
      plan("continuous", [
        [6, 50, 0],
        [7, 60, 0],
        [8, 70, 0],
      ]),
      plan("sparse", [
        [6, 55, 0],
        [8, 0, 0],
      ]),
    ]);
    expect(result.gameweeks).toEqual([6, 8]);
    expect(result.plans.map((row) => row.points)).toEqual([120, 55]);
  });

  it("returns no comparable weeks for disjoint horizons", () => {
    const result = alignPlanGameweeks([
      plan("early", [[6, 50, 0]]),
      plan("late", [[9, 90, 0]]),
    ]);
    expect(result.gameweeks).toEqual([]);
    expect(result.plans.every((row) => row.weeks.length === 0)).toBe(true);
  });

  it("ignores empty branches and orders a single branch's GWs", () => {
    expect(alignPlanGameweeks([])).toEqual({ gameweeks: [], plans: [] });
    const result = alignPlanGameweeks([
      plan("empty", []),
      plan("single", [
        [8, 70, 0],
        [6, 50, 0],
      ]),
    ]);
    expect(result.gameweeks).toEqual([6, 8]);
    expect(result.plans.map((row) => row.plan.id)).toEqual(["single"]);
    expect(result.plans[0].points).toBe(120);
  });
});

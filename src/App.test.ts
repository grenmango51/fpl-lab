import { describe, expect, it } from "vitest";
import { restorePlanningState } from "./App";
import type { Plan, Week } from "./types";

const squad = Array.from({ length: 15 }, (_, index) => index + 1);
const forecast = {
  next_gw: 6,
  gameweeks: [6, 7, 8, 9, 10, 11, 12],
  players: squad.map((id) => ({ id })),
};

function branch(id: string, gameweeks: number[]): Plan {
  const weeks: Week[] = gameweeks.map((gw) => ({
    gw,
    squad: squad.slice(),
    starters: squad.slice(0, 11),
    bench: squad.slice(11),
    captain: 1,
    vice: 2,
    chip: "none",
    bank: 0,
    free_transfers: 1,
    next_free_transfers: 2,
    hits: 0,
    points: 0,
    net_points: 0,
    transfers_in: [],
    transfers_out: [],
  }));
  return {
    id,
    name: id,
    weeks,
    base_squad: squad.slice(),
    base_bank: 0,
    free_transfers: 1,
    purchase_prices: {},
    created_at: "2026-10-03T00:00:00Z",
  };
}

describe("saved planning branches", () => {
  it("keeps a fresh future-start branch and selects its first week on reload", () => {
    const original = branch("current", [6, 7, 8]);
    const fresh = branch("fresh-GW9", [9, 10, 11]);
    const saved = [original, fresh];
    const restored = restorePlanningState(saved, fresh.id, forecast);
    expect(restored.plans).toEqual(saved);
    expect(restored.activeId).toBe(fresh.id);
    expect(restored.gw).toBe(9);
    expect(fresh.weeks.map((week) => week.gw)).toEqual([9, 10, 11]);
  });

  it("selects the upcoming week when the active branch contains it", () => {
    const current = branch("current", [6, 7, 8]);
    const restored = restorePlanningState(
      [branch("future", [10, 11]), current],
      current.id,
      forecast,
    );
    expect(restored.activeId).toBe(current.id);
    expect(restored.gw).toBe(6);
  });

  it("falls back to a surviving future branch when the selected branch expires", () => {
    const expired = branch("expired", [3, 4, 5]);
    const future = branch("future", [10, 11]);
    const restored = restorePlanningState(
      [expired, future],
      expired.id,
      forecast,
    );
    expect(restored.plans).toEqual([future]);
    expect(restored.activeId).toBe(future.id);
    expect(restored.gw).toBe(10);
  });

  it("does not restore a branch with unavailable players or a duplicate squad", () => {
    const missing = branch("old-pool", [9, 10]);
    missing.base_squad[0] = 99;
    const duplicate = branch("duplicate", [9, 10]);
    duplicate.base_squad[0] = duplicate.base_squad[1];
    expect(
      restorePlanningState([missing, duplicate], missing.id, forecast),
    ).toEqual({
      plans: [],
      activeId: "",
      gw: 6,
    });
  });
});

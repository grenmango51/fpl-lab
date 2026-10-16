import { describe, expect, it } from "vitest";
import { planWithOptimisedSuffix, quickSolveHorizon } from "./quickOptimise";
import type { Plan, Week } from "./types";

const week = (gw: number) => ({ gw, squad: [gw], captain: gw }) as Week;
const plan = {
  id: "saved-branch",
  name: "Season plan",
  weeks: Array.from({ length: 32 }, (_, i) => week(i + 7)),
  base_squad: [1],
  base_bank: 1.5,
  purchase_prices: { "1": 5.2 },
} as unknown as Plan;

describe("in-place optimisation", () => {
  it("keeps all future weeks of a saved season plan when settings request five", () => {
    expect(quickSolveHorizon(plan, 9, 5, 38)).toBe(30);
    expect(quickSolveHorizon(plan, 38, 5, 38)).toBe(1);
    const short = { ...plan, weeks: plan.weeks.slice(0, 5) };
    expect(quickSolveHorizon(short, 9, 5, 38)).toBe(3);
  });

  it("retains branch identity, permanent resources and earlier decisions", () => {
    const prefix = plan.weeks.slice(0, 2);
    const solved = plan.weeks.slice(2).map((w) => ({ ...w, captain: 99 }));
    const updated = planWithOptimisedSuffix(plan, prefix, solved, 9, 30);
    expect(updated.id).toBe(plan.id);
    expect(updated.name).toBe(plan.name);
    expect(updated.base_bank).toBe(plan.base_bank);
    expect(updated.purchase_prices).toEqual(plan.purchase_prices);
    expect(updated.weeks.slice(0, 2)).toEqual(prefix);
    expect(updated.weeks.at(-1)?.gw).toBe(38);
    expect(updated.weeks.at(-1)?.captain).toBe(99);
    expect(plan.weeks.at(-1)?.captain).toBe(38);
  });

  it("rejects missing, duplicate and out-of-order forecast weeks", () => {
    const suffix = plan.weeks.slice(2);
    for (const broken of [
      suffix.slice(1),
      [...suffix.slice(1), week(38)],
      [...suffix].reverse(),
    ])
      expect(() =>
        planWithOptimisedSuffix(plan, plan.weeks.slice(0, 2), broken, 9, 30),
      ).toThrow("Incomplete");
  });

  it("cannot truncate a saved suffix", () => {
    expect(() =>
      planWithOptimisedSuffix(plan, [], plan.weeks.slice(0, 5), 7, 5),
    ).toThrow("Incomplete");
    expect(() =>
      planWithOptimisedSuffix(plan, [], plan.weeks.slice(2), 9, 30),
    ).toThrow("Incomplete");
  });
});

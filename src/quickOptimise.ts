import type { Plan, Week } from "./types";

/** A quick solve must cover the existing suffix instead of silently dropping it. */
export function quickSolveHorizon(
  plan: Plan,
  startGW: number,
  configured: number,
  finalGW: number,
) {
  const plannedEnd = Math.max(startGW, ...plan.weeks.map((week) => week.gw));
  return Math.max(
    1,
    Math.min(
      plan.weeks.length ? plannedEnd - startGW + 1 : configured,
      finalGW - startGW + 1,
    ),
  );
}

export function planWithOptimisedSuffix(
  plan: Plan,
  prefix: Week[],
  solved: Week[],
  startGW: number,
  horizon: number,
): Plan {
  const expected = Array.from(
    { length: horizon },
    (_, index) => startGW + index,
  );
  const actual = solved.map((week) => week.gw);
  const earlier = plan.weeks
    .filter((week) => week.gw < startGW)
    .map((week) => week.gw)
    .sort((a, b) => a - b);
  if (
    actual.length !== expected.length ||
    expected.some((gw, index) => actual[index] !== gw) ||
    prefix.some((week) => week.gw >= startGW) ||
    prefix.length !== earlier.length ||
    earlier.some((gw, index) => prefix[index]?.gw !== gw) ||
    plan.weeks.some((week) => week.gw >= startGW + horizon)
  )
    throw new Error("Incomplete optimiser result. Your plan was kept.");
  return {
    ...structuredClone(plan),
    weeks: structuredClone([...prefix, ...solved]),
  };
}

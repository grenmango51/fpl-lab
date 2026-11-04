import type { Plan } from "./types";

// Compare branches on the selected plan's complete calendar, including weeks
// beyond any provider's observed window. Forecast provenance lives in the data.
export function treeGameweeks(plans: Plan[], active: Plan | null): number[] {
  return [
    ...new Set(
      (active ? [active] : plans).flatMap((plan) =>
        plan.weeks.map((week) => week.gw),
      ),
    ),
  ].sort((a, b) => a - b);
}

export function fitTreeZoom(
  viewWidth: number,
  viewHeight: number,
  width: number,
  height: number,
): number {
  return Math.max(
    0.02,
    Math.min(0.65, (viewWidth - 48) / width, (viewHeight - 180) / height),
  );
}

import type { Plan } from "./types";

export function alignPlanGameweeks(plans: Plan[]) {
  const populated = plans.filter((plan) => plan.weeks.length > 0);
  const byGameweek = populated.map(
    (plan) => new Map(plan.weeks.map((week) => [week.gw, week])),
  );
  const gameweeks = [...(byGameweek[0]?.keys() ?? [])]
    .filter((gw) => byGameweek.every((weeks) => weeks.has(gw)))
    .sort((a, b) => a - b);

  return {
    gameweeks,
    plans: populated.map((plan, index) => {
      const weeks = gameweeks.map((gw) => byGameweek[index].get(gw)!);
      return {
        plan,
        weeks,
        points: weeks.reduce(
          (sum, week) => sum + (week.net_points ?? week.points),
          0,
        ),
        hits: weeks.reduce((sum, week) => sum + week.hits, 0),
      };
    }),
  };
}

import type { Bootstrap, Fixture } from "./types";

export type TeamStrengthsSchedule = Record<
  string,
  { attack: number; defence: number }
>;
export const DEFAULT_STRENGTH = { attack: 1, defence: 1 };
export const validStrength = (value: number) =>
  Number.isFinite(value) && value >= 0.5 && value <= 2;
export const roundStrength = (value: number) =>
  Math.round(Math.min(2, Math.max(0.5, value)) * 100) / 100;

export type StrengthRates = { goals: number; conceded: number };
export type RateDomain = { goals: number; conceded: number };

// Freeze the domain and starting rates for a gesture. Opponent factors stay fixed,
// so goals are linear in own attack and conceded is inverse in own defence.
export function strengthDrag(
  start: { attack: number; defence: number },
  rates: StrengthRates,
  domain: RateDomain,
  dx: number,
  dy: number,
  width: number,
  height: number,
  viewboxWidth = 640,
) {
  const goals = rates.goals - (((dy / height) * 300) / 218) * domain.goals;
  const conceded =
    rates.conceded -
    (((dx / width) * viewboxWidth) / (viewboxWidth - 116)) * domain.conceded;
  return {
    attack:
      rates.goals > 0 && dy !== 0
        ? roundStrength((start.attack * goals) / rates.goals)
        : start.attack,
    defence:
      rates.conceded > 0 && dx !== 0
        ? roundStrength(
            (start.defence * rates.conceded) / Math.max(0.000001, conceded),
          )
        : start.defence,
  };
}

export function strengthDomain(rates: StrengthRates[]): RateDomain {
  const maximum = (values: number[]) =>
    Math.max(0.5, Math.ceil(Math.max(0, ...values) * 1.2 * 2) / 2);
  return {
    goals: maximum(rates.map((row) => row.goals)),
    conceded: maximum(rates.map((row) => row.conceded)),
  };
}

export function withTeamStrength(
  strengths: TeamStrengthsSchedule,
  code: string,
  factor: { attack: number; defence: number },
): TeamStrengthsSchedule {
  const next = { ...strengths };
  if (factor.attack === 1 && factor.defence === 1) delete next[code];
  else next[code] = { ...factor };
  return next;
}

// Fixture metadata is shared across a club's players. Use one representative
// keeper per week, never average player xG, CS exposure or availability.
export function teamStrengthBaseline(
  data: Bootstrap,
  teamId: number,
  strengths: TeamStrengthsSchedule = {},
) {
  const players = data.players
    .filter((player) => player.team === teamId)
    .sort(
      (a, b) =>
        Number(b.position_id === 1) - Number(a.position_id === 1) ||
        a.id - b.id,
    );
  const fixtures = new Map<number | string, Fixture>();
  const missingWeeks: number[] = [];
  for (const week of data.gameweeks.filter((gw) => gw >= data.next_gw)) {
    const forecast = players.find((player) => player.gw[String(week)])?.gw[
      String(week)
    ];
    if (!forecast) missingWeeks.push(week);
    forecast?.fixtures.forEach((fixture, index) =>
      fixtures.set(fixture.id ?? `${week}:${index}`, fixture),
    );
  }
  const rows = [...fixtures.values()];
  // TEAM_SCENARIOS.md: these are the exact pre-adjustment source inputs.
  const originals = rows.map(
    (fixture) => fixture.team_strength_scenario?.base ?? fixture,
  );
  const valid = originals.filter(
    (fixture) =>
      typeof fixture.team_goals === "number" &&
      Number.isFinite(fixture.team_goals) &&
      fixture.team_goals >= 0 &&
      typeof fixture.conceded === "number" &&
      Number.isFinite(fixture.conceded) &&
      fixture.conceded >= 0,
  );
  const ownCode = data.teams?.find((team) => team.id === teamId)?.code;
  const own = strengths[String(ownCode)] ?? DEFAULT_STRENGTH;
  const derived = rows.flatMap((fixture, index) => {
    const base = originals[index];
    if (!valid.includes(base)) return [];
    const opponentCode = data.teams?.find(
      (team) => team.id === fixture.opponent_id,
    )?.code;
    if (opponentCode === undefined || ownCode === undefined) return [];
    const opponent = strengths[String(opponentCode)] ?? DEFAULT_STRENGTH;
    return [
      {
        goals: (base.team_goals * own.attack) / opponent.defence,
        conceded: (base.conceded * opponent.attack) / own.defence,
      },
    ];
  });
  // Never plot a partial schedule or guess an unknown opponent's factor.
  const complete =
    !missingWeeks.length &&
    valid.length === rows.length &&
    derived.length === rows.length &&
    rows.length > 0;

  return {
    fixtures: valid.length,
    missingWeeks,
    goals: valid.length
      ? valid.reduce((sum, fixture) => sum + fixture.team_goals, 0) /
        valid.length
      : null,
    conceded: valid.length
      ? valid.reduce((sum, fixture) => sum + fixture.conceded, 0) / valid.length
      : null,
    sources: [
      ...new Set(valid.map((fixture) => fixture.source).filter(Boolean)),
    ],
    derivedGoals: complete
      ? derived.reduce((sum, row) => sum + row.goals, 0) / derived.length
      : null,
    derivedConceded: complete
      ? derived.reduce((sum, row) => sum + row.conceded, 0) / derived.length
      : null,
    unavailableFixtures: rows.length - derived.length,
    sourceTimes: [
      ...new Set(
        valid
          .flatMap((row) => [row.source_at, row.source_extracted_at])
          .filter(Boolean),
      ),
    ],
  };
}

export const strengthPosition = (
  rates: StrengthRates,
  domain: RateDomain,
  width = 640,
) => ({
  x: 58 + (1 - rates.conceded / domain.conceded) * (width - 116),
  y: 254 - (rates.goals / domain.goals) * 218,
});

// Spread coincident labels while retaining a leader to the exact rate point.
// Points retain their sourced rate coordinates even when labels overlap.
export function strengthLabels(
  points: { x: number; y: number }[],
  width = 640,
) {
  const slots: { x: number; y: number }[] = [];
  for (let y = 30; y <= 254; y += 28) {
    for (let x = 40; x <= width - 40; x += 52) slots.push({ x, y });
  }
  const labels: { x: number; y: number }[] = [];
  for (const point of points) {
    const nearest = [...slots]
      .sort(
        (a, b) =>
          Math.hypot(a.x - point.x, a.y - point.y) -
          Math.hypot(b.x - point.x, b.y - point.y),
      )
      .find(
        (slot) =>
          !labels.some((label) => label.x === slot.x && label.y === slot.y),
      );
    labels.push(nearest ?? point);
  }
  return labels;
}

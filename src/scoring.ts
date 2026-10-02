import type { Chip, Player } from "./types";

export function appearance(p: Player, gw: number) {
  const override = p.gw[String(gw)]?.pplay;
  if (override !== undefined) return Math.min(1, Math.max(0, override));
  const fixtures = p.gw[String(gw)]?.fixtures;
  if (fixtures === undefined) return Math.min(1, Math.max(0, p.pplay ?? 1));
  return (
    1 -
    fixtures.reduce(
      (absent, f) => absent * (1 - Math.min(1, Math.max(0, f.pplay))),
      1,
    )
  );
}

function missingDistribution(probabilities: number[]) {
  let weights = [1];
  for (const p of probabilities) {
    const next = Array(weights.length + 1).fill(0) as number[];
    weights.forEach((w, n) => {
      next[n] += w * p;
      next[n + 1] += w * (1 - p);
    });
    weights = next;
  }
  return weights;
}

const choices = new Map<string, number>();
const countBits = (n: number) =>
  Number(Boolean(n & 4)) + Number(Boolean(n & 2)) + Number(Boolean(n & 1));
function selectedBench(
  formation: number[],
  missing: number[],
  positions: number[],
  present: number,
) {
  const key = `${formation}|${missing}|${positions}|${present}`;
  const cached = choices.get(key);
  if (cached !== undefined) return cached;
  for (let mask = 7; mask >= 0; mask--) {
    const count = countBits(mask);
    if ((mask & present) !== mask || count > missing.reduce((a, b) => a + b, 0))
      continue;
    const added = [2, 3, 4].map((pos) =>
      positions.reduce(
        (n, p, j) => n + Number(Boolean(mask & (4 >> j)) && p === pos),
        0,
      ),
    );
    for (let d = 0; d <= missing[0]; d++)
      for (let m = 0; m <= missing[1]; m++) {
        const f = count - d - m;
        if (f < 0 || f > missing[2]) continue;
        const final = formation.map((n, j) => n - [d, m, f][j] + added[j]);
        if (
          final[0] >= 3 &&
          final[0] <= 5 &&
          final[1] >= 2 &&
          final[1] <= 5 &&
          final[2] >= 1 &&
          final[2] <= 3
        ) {
          choices.set(key, mask);
          return mask;
        }
      }
  }
  choices.set(key, 0);
  return 0;
}

export function teamPoints(
  starters: number[],
  bench: number[],
  captain: number,
  vice: number,
  lookup: Map<number, Player>,
  gw: number,
  chip: Chip = "none",
) {
  const xp = (i: number) => lookup.get(i)?.gw[String(gw)]?.points ?? 0;
  const probabilities = new Map(
    [...starters, ...bench].map((i) => [
      i,
      lookup.has(i) ? appearance(lookup.get(i)!, gw) : 0,
    ]),
  );
  const chance = (i: number) => probabilities.get(i) ?? 0;
  const copies = chip === "triplecaptain" ? 2 : 1;
  const vice_points = (1 - chance(captain)) * xp(vice) * copies;
  let autosub_points = 0;
  if (chip !== "benchboost") {
    const keeper = starters.find((i) => lookup.get(i)?.position_id === 1);
    const reserve = bench.find((i) => lookup.get(i)?.position_id === 1);
    if (keeper !== undefined && reserve !== undefined)
      autosub_points += (1 - chance(keeper)) * xp(reserve);
    const outfield = bench.filter((i) => lookup.get(i)?.position_id !== 1);
    if (outfield.length === 3) {
      const positions = outfield.map((i) => lookup.get(i)?.position_id ?? 0);
      const groups = [2, 3, 4].map((pos) =>
        starters.filter((i) => lookup.get(i)?.position_id === pos),
      );
      const formation = groups.map((g) => g.length);
      const missing = groups.map((g) => missingDistribution(g.map(chance)));
      const selected = [0, 0, 0];
      for (let d = 0; d < missing[0].length; d++)
        for (let m = 0; m < missing[1].length; m++)
          for (let f = 0; f < missing[2].length; f++) {
            const weight = missing[0][d] * missing[1][m] * missing[2][f];
            if (weight === 0 || d + m + f === 0) continue;
            for (let present = 0; present < 8; present++) {
              let scenario = weight;
              outfield.forEach((i, j) => {
                scenario *= present & (4 >> j) ? chance(i) : 1 - chance(i);
              });
              if (scenario === 0) continue;
              const chosen = selectedBench(
                formation,
                [d, m, f],
                positions,
                present,
              );
              for (let j = 0; j < 3; j++)
                if (chosen & (4 >> j)) selected[j] += scenario;
            }
          }
      outfield.forEach((i, j) => {
        if (chance(i) > 0) autosub_points += (selected[j] * xp(i)) / chance(i);
      });
    }
  }
  const scoring = chip === "benchboost" ? [...starters, ...bench] : starters;
  const points =
    scoring.reduce((n, i) => n + xp(i), 0) +
    copies * xp(captain) +
    vice_points +
    autosub_points;
  return { points, autosub_points, vice_points };
}

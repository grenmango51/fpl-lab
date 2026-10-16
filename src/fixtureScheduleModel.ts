export type FixtureMoves = Record<string, number | null>;
export type ScheduleFixture = {
  id: number;
  event: number | null;
  kickoff_time: string | null;
  team_h: number;
  team_a: number;
};
export type FixtureCatalog = {
  next_gw: number;
  gameweeks: number[];
  season: string;
  fixtures: ScheduleFixture[];
  sources?: Record<
    string,
    { url?: string; fetched_at?: string; status?: string }
  >;
};

export function validScheduleGW(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 38
  );
}

export function fixtureKey(value: unknown): string | null {
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return typeof value === "string" &&
    /^[1-9]\d*$/.test(value) &&
    Number.isSafeInteger(Number(value))
    ? value
    : null;
}

export function parseFixtureCatalog(value: unknown): FixtureCatalog {
  if (!value || typeof value !== "object")
    throw new Error("Invalid fixture catalog.");
  const catalog = value as FixtureCatalog;
  if (
    !validScheduleGW(catalog.next_gw) ||
    typeof catalog.season !== "string" ||
    !Array.isArray(catalog.gameweeks) ||
    !catalog.gameweeks.every(
      (week) => validScheduleGW(week) && week >= catalog.next_gw,
    ) ||
    new Set(catalog.gameweeks).size !== catalog.gameweeks.length ||
    !Array.isArray(catalog.fixtures)
  ) {
    throw new Error("Invalid fixture catalog.");
  }
  const seen = new Set<string>();
  for (const row of catalog.fixtures) {
    const key = row && fixtureKey(row.id);
    if (
      !key ||
      typeof row.id !== "number" ||
      seen.has(key) ||
      !(row.event === null || catalog.gameweeks.includes(row.event)) ||
      !(row.kickoff_time === null || typeof row.kickoff_time === "string") ||
      typeof row.team_h !== "number" ||
      typeof row.team_a !== "number" ||
      !fixtureKey(row.team_h) ||
      !fixtureKey(row.team_a) ||
      row.team_h === row.team_a
    ) {
      throw new Error("Invalid fixture identity or schedule in catalog.");
    }
    seen.add(key);
  }
  return catalog;
}

export function movableFixtures(
  catalog: FixtureCatalog,
  teamIds: readonly number[],
): ScheduleFixture[] {
  const teams = new Set(teamIds);
  return catalog.fixtures.filter(
    (row) => teams.has(row.team_h) && teams.has(row.team_a),
  );
}

/** Canonical official IDs only; identity moves disappear. Never mutate input/catalog. */
export function normalizeFixtureMoves(
  moves: unknown,
  fixtures: readonly ScheduleFixture[],
  gameweeks: readonly number[],
): FixtureMoves {
  const result: FixtureMoves = {};
  if (!moves || typeof moves !== "object" || Array.isArray(moves))
    return result;
  const byId = new Map(fixtures.map((row) => [String(row.id), row]));
  for (const [key, target] of Object.entries(moves)) {
    const row = fixtureKey(key) === key ? byId.get(key) : undefined;
    if (
      row &&
      (target === null ||
        (validScheduleGW(target) && gameweeks.includes(target))) &&
      target !== row.event
    ) {
      result[key] = target;
    }
  }
  return result;
}

export function assumedFixtureGW(
  row: ScheduleFixture,
  moves: FixtureMoves,
): number | null {
  return Object.hasOwn(moves, String(row.id))
    ? moves[String(row.id)]
    : row.event;
}

export function moveFixture(
  moves: FixtureMoves,
  id: unknown,
  target: unknown,
  fixtures: readonly ScheduleFixture[],
  gameweeks: readonly number[],
): FixtureMoves | null {
  const key = fixtureKey(id);
  if (
    !key ||
    !fixtures.some((row) => String(row.id) === key) ||
    !(
      target === null ||
      (validScheduleGW(target) && gameweeks.includes(target))
    )
  )
    return null;
  return normalizeFixtureMoves(
    { ...moves, [key]: target },
    fixtures,
    gameweeks,
  );
}

export function resetFixture(
  moves: FixtureMoves,
  id: unknown,
  fixtures: readonly ScheduleFixture[],
  gameweeks: readonly number[],
): FixtureMoves {
  const next = { ...moves };
  const key = fixtureKey(id);
  if (key) delete next[key];
  return normalizeFixtureMoves(next, fixtures, gameweeks);
}

export function scheduleWindow(
  gameweeks: readonly number[],
  start: number,
  size: number,
): number[] {
  const sorted = [...new Set(gameweeks.filter(validScheduleGW))].sort(
    (a, b) => a - b,
  );
  return size === 38
    ? sorted
    : sorted.filter((week) => week >= start).slice(0, size);
}

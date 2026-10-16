import { describe, expect, it } from "vitest";
import type { Bootstrap, Fixture, Player } from "./types";
import {
  strengthDrag,
  strengthDomain,
  strengthLabels,
  strengthPosition,
  teamStrengthBaseline,
  validStrength,
  withTeamStrength,
} from "./teamStrengthsModel";

const fixture = (id: number, goals: number, conceded: number) =>
  ({
    id,
    opponent_id: 10,
    team_goals: goals,
    conceded,
    source: "Sourced fixture",
  }) as Fixture;
const player = (
  id: number,
  position: number,
  fixtures: Record<string, Fixture[]>,
) =>
  ({
    id,
    team: 9,
    position_id: position,
    chance: 0,
    gw: Object.fromEntries(
      Object.entries(fixtures).map(([gw, rows]) => [gw, { fixtures: rows }]),
    ),
  }) as Player;
const data = (players: Player[]) =>
  ({
    players,
    teams: [
      { id: 9, code: 100 },
      { id: 10, code: 200 },
      { id: 11, code: 300 },
    ],
    gameweeks: [6, 7, 8, 38],
    next_gw: 7,
  }) as Bootstrap;

describe("manual team strength inputs", () => {
  it("accepts only finite factors inside the declared bounds", () => {
    for (const value of [0.5, 1, 2]) expect(validStrength(value)).toBe(true);
    for (const value of [NaN, Infinity, 0.49, 2.01])
      expect(validStrength(value)).toBe(false);
  });
  it("keys changes by stable club code, preserves other clubs and removes identity edits", () => {
    const original = {
      "100": { attack: 1.1, defence: 0.8 },
      "200": { attack: 1.2, defence: 1 },
    };
    const changed = withTeamStrength(original, "100", {
      attack: 1,
      defence: 1,
    });
    expect(changed).toEqual({ "200": original["200"] });
    expect(original["100"].attack).toBe(1.1);
    expect(
      withTeamStrength(changed, "100", { attack: 1.2, defence: 1.3 })["100"],
    ).toEqual({ attack: 1.2, defence: 1.3 });
  });
  it("uses a representative keeper's fixture means independently of player chance", () => {
    const result = teamStrengthBaseline(
      data([
        player(1, 2, { 7: [fixture(1, 99, 99)] }),
        player(2, 1, {
          6: [fixture(99, 50, 50)],
          7: [fixture(1, 2, 1)],
          8: [],
          38: [fixture(2, 4, 2), fixture(3, 3, 3)],
        }),
        player(3, 1, { 7: [fixture(1, 88, 88)] }),
      ]),
      9,
    );
    expect(result).toMatchObject({
      fixtures: 3,
      goals: 3,
      conceded: 2,
      sources: ["Sourced fixture"],
    });
  });
  it("reads original source metadata after team assumptions and exposes applied means separately", () => {
    const adjusted = {
      ...fixture(1, 4, 0.5),
      team_strength_scenario: {
        label: "Human assumption",
        source: "user-assumed",
        adjusted_at: "2026-10-16T00:00:00Z",
        attack_factor: 2,
        conceded_factor: 0.5,
        base: {
          team_goals: 2,
          conceded: 1,
          cs: 0.4,
          source: "Original source",
        },
      },
    };
    const result = teamStrengthBaseline(
      data([player(1, 1, { 7: [adjusted] })]),
      9,
    );
    expect(result).toMatchObject({
      goals: 2,
      conceded: 1,
      derivedGoals: null,
      derivedConceded: null,
      sources: ["Original source"],
    });
    expect(adjusted.team_goals).toBe(4);
  });
  it("falls back per week when the keeper's week is absent, without inventing missing clubs", () => {
    const result = teamStrengthBaseline(
      data([player(1, 1, {}), player(2, 2, { 38: [fixture(1, 2, 1)] })]),
      9,
    );
    expect(result).toMatchObject({ fixtures: 1, goals: 2 });
    expect(teamStrengthBaseline(data([]), 9)).toMatchObject({
      fixtures: 0,
      goals: null,
      conceded: null,
    });
  });
  it("derives every double fixture with stable opponent codes and all active factors, then resets from source", () => {
    const second = { ...fixture(2, 4, 3), opponent_id: 11 };
    const input = data([
      player(1, 1, {
        7: [fixture(1, 2, 1), second],
        8: [],
        38: [fixture(3, 3, 2)],
      }),
    ]);
    const factors = {
      "100": { attack: 1.5, defence: 2 },
      "200": { attack: 2, defence: 0.5 },
      "300": { attack: 0.5, defence: 2 },
    };
    const derived = teamStrengthBaseline(input, 9, factors);
    expect(derived.derivedGoals).toBeCloseTo((6 + 3 + 9) / 3);
    expect(derived.derivedConceded).toBeCloseTo((1 + 0.75 + 2) / 3);
    const reset = teamStrengthBaseline(input, 9, {});
    expect(reset.derivedGoals).toBe(3);
    expect(reset.derivedConceded).toBe(2);
    expect(input.players[0].gw["7"].fixtures[0].team_goals).toBe(2);
  });
  it("previews opponent changes and uses scenario.base rather than compounding returned rates", () => {
    const base = fixture(1, 2, 1);
    const adjusted = {
      ...base,
      team_goals: 99,
      conceded: 99,
      team_strength_scenario: {
        label: "Human",
        source: "user",
        adjusted_at: "now",
        attack_factor: 2,
        conceded_factor: 2,
        base: { ...base, cs: 0.4 },
      },
    };
    const input = data([player(1, 1, { 7: [adjusted], 8: [], 38: [] })]);
    expect(
      teamStrengthBaseline(input, 9, { "200": { attack: 1.5, defence: 2 } }),
    ).toMatchObject({
      goals: 2,
      conceded: 1,
      derivedGoals: 1,
      derivedConceded: 1.5,
    });
    expect(teamStrengthBaseline(input, 9)).toMatchObject({
      derivedGoals: 2,
      derivedConceded: 1,
    });
  });
  it("leaves missing weeks, real rates and unknown opponents unavailable", () => {
    const missingWeek = data([player(1, 1, { 7: [fixture(1, 2, 1)] })]);
    expect(teamStrengthBaseline(missingWeek, 9).derivedGoals).toBeNull();
    for (const row of [
      { ...fixture(1, 2, 1), opponent_id: 999 },
      { ...fixture(1, 2, 1), team_goals: NaN },
    ]) {
      expect(
        teamStrengthBaseline(
          data([player(1, 1, { 7: [row], 8: [], 38: [] })]),
          9,
        ).derivedGoals,
      ).toBeNull();
    }
  });
  it("plots distinct default source rates with reversed conceded and maps drag back to factors", () => {
    const domain = { goals: 4, conceded: 4 };
    const start = { attack: 1, defence: 1 };
    const rates = { goals: 2, conceded: 2 };
    const p = strengthPosition(rates, domain);
    expect(
      strengthPosition({ goals: 3, conceded: 1 }, domain).x,
    ).toBeGreaterThan(p.x);
    expect(strengthPosition({ goals: 3, conceded: 1 }, domain).y).toBeLessThan(
      p.y,
    );
    const next = strengthDrag(start, rates, domain, 65.5, -27.25, 640, 300);
    expect(next).toEqual({ attack: 1.25, defence: 1.33 });
    const moved = strengthPosition(
      {
        goals: rates.goals * next.attack,
        conceded: rates.conceded / next.defence,
      },
      domain,
    );
    expect(moved.x - p.x).toBeCloseTo(65.5, -1);
    expect(moved.y - p.y).toBeCloseTo(-27.25);
    expect(strengthDrag(start, rates, domain, 0, 0, 320, 150)).toEqual(start);
    expect(strengthDrag(start, rates, domain, -10000, 10000, 640, 300)).toEqual(
      { attack: 0.5, defence: 0.5 },
    );
    expect(strengthDrag(start, rates, domain, 10000, -10000, 640, 300)).toEqual(
      { attack: 2, defence: 2 },
    );
    expect(
      strengthDrag(start, { goals: 0, conceded: 0 }, domain, 10, -10, 640, 300),
    ).toEqual(start);
  });
  it("uses a finite shared domain independently of search and preserves responsive drag scale", () => {
    expect(strengthDomain([])).toEqual({ goals: 0.5, conceded: 0.5 });
    expect(strengthDomain([{ goals: 2, conceded: 1 }])).toEqual({
      goals: 2.5,
      conceded: 1.5,
    });
    expect(
      strengthDrag(
        { attack: 1, defence: 1 },
        { goals: 2, conceded: 2 },
        { goals: 4, conceded: 4 },
        25.5,
        -27.25,
        320,
        300,
        320,
      ),
    ).toEqual({ attack: 1.25, defence: 1.33 });
  });
  it("keeps twenty coincident labels apart at mobile and desktop widths", () => {
    for (const width of [280, 320, 640, 1000]) {
      for (const factor of [0.5, 1, 2]) {
        const points = Array.from({ length: 20 }, () =>
          strengthPosition(
            { goals: factor, conceded: factor },
            { goals: 2, conceded: 2 },
            width,
          ),
        );
        const labels = strengthLabels(points, width);
        expect(new Set(labels.map((p) => `${p.x}:${p.y}`)).size).toBe(20);
        for (const [i, label] of labels.entries()) {
          expect(label.x).toBeGreaterThanOrEqual(40);
          expect(label.x).toBeLessThanOrEqual(width - 40);
          expect(label.y).toBeGreaterThanOrEqual(24);
          expect(label.y).toBeLessThanOrEqual(264);
          for (const other of labels.slice(i + 1)) {
            expect(
              Math.abs(label.x - other.x) >= 48 ||
                Math.abs(label.y - other.y) >= 25,
            ).toBe(true);
          }
        }
      }
    }
  });
});

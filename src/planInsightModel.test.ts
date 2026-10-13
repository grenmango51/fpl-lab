import { describe, expect, it } from "vitest";
import { analyseWeek, forecastComponents, insightAppearance, insightWeeks, planInsights, playerExposures, weakStarterAlternatives } from "./planInsightModel";
import type { Bootstrap, Fixture, Forecast, Plan, Player, Week } from "./types";

function forecast(points = 2): Forecast {
  return {
    points, xmins: 90, pplay: 1,
    components: { appearance: 1, goals: points - 1 },
    fixtures: [{ id: 1, points, xmins: 90, pplay: 1, components: { appearance: 1, goals: points - 1 } } as unknown as Fixture],
  };
}

function player(id: number, position: number, points = 2): Player {
  return {
    id, code: id, name: `Player ${id}`, position_id: position,
    position: ["GKP", "DEF", "MID", "FWD"][position - 1],
    team: Math.ceil(id / 3), team_short: `T${Math.ceil(id / 3)}`, team_name: `Team ${Math.ceil(id / 3)}`,
    team_code: Math.ceil(id / 3), price: 5, ownership: 10, pplay: 1,
    gw: { "6": forecast(points), "8": forecast(points) },
  } as unknown as Player;
}

function setup() {
  const positions = [1, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 1, 2, 2, 3];
  const players = positions.map((position, index) => player(index + 1, position));
  const week: Week = {
    gw: 6, squad: players.map((row) => row.id), starters: players.slice(0, 11).map((row) => row.id),
    bench: [12, 13, 14, 15], captain: 5, vice: 6, chip: "none", bank: 0.2,
    free_transfers: 1, next_free_transfers: 2, hits: 0, points: 24, net_points: 24,
    transfers_in: [], transfers_out: [],
  };
  const plan: Plan = { id: "test", name: "Test", weeks: [week], base_squad: [...week.squad], base_bank: 0.2, free_transfers: 1, purchase_prices: {}, created_at: "2026-10-12T00:00:00Z" };
  const data = { players, gameweeks: [6, 7, 8] } as Bootstrap;
  return { players, week, plan, data };
}

describe("plan insight scoring", () => {
  it("counts double fixtures, GW provider adjustments and Triple Captain once each", () => {
    const { players, week, plan } = setup();
    players[4].gw["6"] = {
      points: 10, xmins: 180, pplay: 1,
      components: { appearance: 2, goals: 2, assists: 3, provider_adjustment: 3 },
      fixtures: [
        { id: 1, pplay: 1, components: { appearance: 1, goals: 2 } } as unknown as Fixture,
        { id: 2, pplay: 1, components: { appearance: 1, assists: 3 } } as unknown as Fixture,
      ],
    };
    week.chip = "triplecaptain";
    const row = analyseWeek(week, plan.base_squad, players);
    expect(row.points).toBe(50);
    expect(row.components.appearance).toBe(16);
    expect(row.components.goals).toBe(16);
    expect(row.components.assists).toBe(9);
    expect(row.components.provider_adjustment).toBe(9);
    expect(Object.values(row.components).reduce((sum, value) => sum + value, 0)).toBe(row.points);
  });

  it("counts Bench Boost reserves directly without adding autosubs", () => {
    const { players, week, plan } = setup();
    week.chip = "benchboost";
    const row = analyseWeek(week, plan.base_squad, players);
    expect(row.points).toBe(32);
    expect(row.directPoints).toBe(32);
    expect(row.autosubs).toBe(0);
    expect(row.components.appearance).toBe(16);
    const exposure = playerExposures([week], players);
    expect(exposure).toHaveLength(15);
    expect(exposure.find((item) => item.player.id === week.captain)!.copies).toBe(2);
    expect(exposure.reduce((sum, item) => sum + item.points!, 0)).toBe(32);
  });

  it("keeps vice and autosub expectations separate from event DNA and transfer hits", () => {
    const { players, week, plan } = setup();
    players[4].gw["6"].pplay = 0.5;
    week.chip = "triplecaptain";
    week.hits = 4;
    const row = analyseWeek(week, plan.base_squad, players);
    expect(row.anyStarterAbsent).toBeCloseTo(0.5);
    expect(row.expectedMissing).toBeCloseTo(0.5);
    expect(row.vice).toBe(2);
    expect(row.autosubs).toBeCloseTo(1);
    expect(row.points).toBeCloseTo(29);
    expect(row.netPoints).toBeCloseTo(25);
    expect(Object.values(row.components).reduce((sum, value) => sum + value, 0) + row.vice! + row.autosubs!).toBeCloseTo(row.points!);
  });

  it("does not double an adjustment already distributed to fixture components", () => {
    const row = forecast(7);
    row.components = { appearance: 1, goals: 2, user_points_adjustment: 4 };
    row.fixtures[0].components = { ...row.components };
    expect(forecastComponents(row)).toEqual(row.components);
  });

  it("discloses any point residual without inventing a goal or clean-sheet component", () => {
    const row = forecast(7);
    row.components = { appearance: 1, goals: 2 };
    row.fixtures[0].components = { appearance: 1, goals: 2 };
    expect(forecastComponents(row)).toEqual({ appearance: 1, goals: 2, unassigned_forecast: 4 });
  });

  it("distinguishes a double/blank from an unavailable forecast", () => {
    const row = player(1, 1);
    delete row.gw["6"].pplay;
    row.gw["6"].fixtures = [{ pplay: 0.5 } as Fixture, { pplay: 0.4 } as Fixture];
    row.gw["8"] = { points: 0, xmins: 0, fixtures: [], components: {}, pplay: 0 };
    expect(insightAppearance(row, 6)).toBeCloseTo(0.7);
    expect(insightAppearance(row, 8)).toBe(0);
    expect(insightAppearance(row, 7)).toBeNull();
    expect(insightAppearance(undefined, 6)).toBeNull();
  });

  it("keeps incomplete plan totals unavailable even when all starter forecasts exist", () => {
    const { players, plan, data } = setup();
    delete players[14].gw["6"];
    const insight = planInsights(data, plan, 6);
    expect(insight.points).toBeNull();
    expect(insight.netPoints).toBeNull();
    expect(insight.componentPoints).toBeNull();
    expect(insight.transferGain).toBeNull();
    expect(insight.rows[0].missing).toEqual([15]);
    expect(insight.rows[0].anyStarterAbsent).toBe(0);
  });
});

describe("plan insight periods and comparisons", () => {
  it("uses actual sparse weeks and never substitutes an absent selected week", () => {
    const { plan, week, data } = setup();
    plan.weeks = [{ ...week, gw: 8 }, week];
    expect(insightWeeks(plan, 7, "horizon").map((row) => row.gw)).toEqual([6, 8]);
    expect(insightWeeks(plan, 7, "gameweek")).toEqual([]);
    const insight = planInsights(data, plan, 7, "gameweek");
    expect(insight.points).toBeNull();
    expect(insight.transferGain).toBeNull();
  });

  it("compares only weeks with both plan and original-squad coverage, including matching-week hits", () => {
    const { players, plan, week, data } = setup();
    const replacement = player(16, 3);
    players.push(replacement);
    delete players[14].gw["8"];
    plan.weeks.push({ ...week, gw: 8, squad: week.squad.map((id) => id === 15 ? 16 : id), bench: [12, 13, 14, 16], hits: 4, transfers_in: [16], transfers_out: [15] });
    const insight = planInsights(data, plan, 8);
    expect(insight.completeRows).toHaveLength(2);
    expect(insight.matched.map((row) => row.week.gw)).toEqual([6]);
    expect(insight.points).toBe(48);
    expect(insight.netPoints).toBe(44);
    expect(insight.transferGain).toBe(0);
    expect(insight.matchedHits).toBe(0);
    expect(insight.hits).toBe(4);
  });

  it("rescores current forecasts rather than trusting stored plan points", () => {
    const { plan, data } = setup();
    plan.weeks[0].points = 900;
    plan.weeks[0].net_points = 900;
    const insight = planInsights(data, plan, 6);
    expect(insight.points).toBe(24);
    expect(insight.netPoints).toBe(24);
    expect(insight.transferGain).toBe(0);
    expect(plan.weeks[0].points).toBe(900);
  });
});

describe("single-player alternatives and exposure", () => {
  it("screens price, position, existing squads and the club limit after removing the starter", () => {
    const { players, week } = setup();
    const cheaper = { ...player(16, 2, 5), team: 1, price: 4.9 };
    const expensive = { ...player(17, 2, 20), team: 10, price: 5.1 };
    const clubBlocked = { ...player(18, 2, 30), team: 2, price: 4.8 };
    const missing = { ...player(19, 2, 50), team: 20, gw: {} };
    players.push(cheaper, expensive, clubBlocked, missing);
    const suggestions = weakStarterAlternatives([week], players);
    const replaceDefender = suggestions.find((item) => item.replacement.id === 2)!;
    expect(replaceDefender.player.id).toBe(16);
    expect(replaceDefender.gain).toBe(3);
    expect(suggestions.every((item) => ![17, 19].includes(item.player.id))).toBe(true);
    expect(suggestions.every((item) => item.player.position_id === item.replacement.position_id)).toBe(true);
  });

  it("limits a candidate comparison to the replaced player's actual starting weeks", () => {
    const { players, week } = setup();
    const candidate = { ...player(16, 2, 4), team: 20 };
    candidate.gw["8"] = forecast(50);
    players.push(candidate);
    const otherWeek = { ...week, gw: 8, starters: week.starters.map((id) => id === 2 ? 13 : id), bench: [12, 2, 14, 15] };
    const suggestion = weakStarterAlternatives([week, otherWeek], players).find((item) => item.replacement.id === 2)!;
    expect(suggestion.gameweeks).toEqual([6]);
    expect(suggestion.gain).toBe(2);
  });

  it("reports current ownership and captain copies without inventing effective ownership", () => {
    const { players, week } = setup();
    week.chip = "triplecaptain";
    players[4].ownership = 42.5;
    const captain = playerExposures([week], players).find((item) => item.player.id === week.captain)!;
    expect(captain.ownership).toBe(42.5);
    expect(captain.copies).toBe(3);
    expect(captain.points).toBe(6);
    expect(captain.captainWeeks).toBe(1);
  });
});

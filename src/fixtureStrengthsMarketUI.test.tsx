import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FixtureExplorer,
  FixtureTrend,
  fixtureTrendScale,
  formatTrendPoint,
} from "./FixtureExplorer";
import { FixtureMarkets } from "./FixtureMarkets";
import { FixtureSchedule } from "./FixtureSchedule";
import { FixtureDetail } from "./FixtureDetail";
import { TeamStrengths, formatSourceTimes } from "./TeamStrengths";
import { MarketMovement } from "./MarketMovement";
import { Badge, LineChart, Modal, PlayerName } from "./components";
import { TabStrip } from "./TabStrip";
import type { Bootstrap, Fixture, Forecast, Player } from "./types";
import type { FixtureCatalog } from "./fixtureScheduleModel";

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as {
    deps: readonly unknown[] | undefined;
    cleanup?: () => void;
  }[],
  stateCursor: 0,
  refCursor: 0,
  effectCursor: 0,
  pendingEffects: [] as (() => void)[],
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useMemo: (calculate: () => unknown) => calculate(),
  useRef: (initial: unknown) => {
    const slot = hooks.refCursor++;
    if (!(slot in hooks.refs)) hooks.refs[slot] = { current: initial };
    return hooks.refs[slot];
  },
  useState: (initial: unknown) => {
    const slot = hooks.stateCursor++;
    if (!(slot in hooks.values)) {
      hooks.values[slot] =
        typeof initial === "function" ? (initial as () => unknown)() : initial;
    }
    return [
      hooks.values[slot],
      (value: unknown) => {
        hooks.values[slot] =
          typeof value === "function"
            ? (value as (prev: unknown) => unknown)(hooks.values[slot])
            : value;
      },
    ];
  },
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const slot = hooks.effectCursor++;
    const prev = hooks.effects[slot];
    const changed =
      !prev ||
      !deps ||
      !prev.deps ||
      deps.length !== prev.deps.length ||
      deps.some((dep, i) => !Object.is(dep, prev.deps![i]));
    if (changed) {
      hooks.pendingEffects.push(() => {
        prev?.cleanup?.();
        const cleanup = effect();
        hooks.effects[slot] = {
          deps,
          cleanup: typeof cleanup === "function" ? cleanup : undefined,
        };
      });
    }
  },
}));

function flushEffects() {
  const queue = hooks.pendingEffects.splice(0);
  for (const run of queue) run();
}

function resetHooks() {
  for (const entry of hooks.effects) entry?.cleanup?.();
  hooks.values = [];
  hooks.refs = [];
  hooks.effects = [];
  hooks.stateCursor = 0;
  hooks.refCursor = 0;
  hooks.effectCursor = 0;
  hooks.pendingEffects = [];
}

function renderWithHooks<T>(fn: () => T): T {
  hooks.stateCursor = 0;
  hooks.refCursor = 0;
  hooks.effectCursor = 0;
  const out = fn();
  flushEffects();
  return out;
}

type Node = ReactElement<Record<string, any>>;
const passthroughComponents = new Set<unknown>([
  Badge,
  LineChart,
  Modal,
  PlayerName,
  FixtureDetail,
]);
function nodes(tree: ReactNode): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement(tree)) return [];
  const node = tree as Node;
  const rendered =
    typeof node.type === "function" && !passthroughComponents.has(node.type)
      ? (node.type as any)(node.props)
      : node.props.children;
  return [node, ...nodes(rendered)];
}

function textContent(value: ReactNode): string {
  if (value === null || value === undefined || typeof value === "boolean")
    return "";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (isValidElement(value)) return textContent((value as Node).props.children);
  return "";
}

const makeFixture = (patch: Partial<Fixture> = {}): Fixture =>
  ({
    id: 101,
    opponent: "BET",
    opponent_id: 2,
    home: true,
    difficulty: 2,
    kickoff: "2026-10-17T14:00:00Z",
    source: "FPL Joe",
    source_at: "2026-10-16T14:23:09.847392+00:00",
    source_extracted_at: "2026-10-16T14:23:41.102938Z",
    points: 5,
    xmins: 90,
    xg: 0.4,
    xa: 0.2,
    cs: 0.42,
    pplay: 1,
    p60: 0.9,
    team_goals: 1.85,
    conceded: 0.95,
    components: {},
    ...patch,
  }) as Fixture;

const makeForecast = (fixtures: Fixture[], points = 5): Forecast =>
  ({
    points,
    xmins: 90,
    fixtures,
    components: {},
  }) as Forecast;

function makeBootstrap(overrides: Partial<Bootstrap> = {}): Bootstrap {
  return {
    season: "2026-27",
    next_gw: 7,
    gameweeks: [7, 8, 9],
    events: [],
    teams: [
      { id: 1, name: "Alpha", short_name: "ALP", code: 10 },
      { id: 2, name: "Beta", short_name: "BET", code: 20 },
    ],
    players: [
      {
        id: 11,
        code: 11,
        name: "KeeperOne",
        full_name: "Keeper One",
        position: "GKP",
        position_id: 1,
        team: 1,
        team_name: "Alpha",
        team_short: "ALP",
        team_code: 10,
        price: 5,
        gw: {
          "7": makeForecast(
            [makeFixture({ id: 101, difficulty: 2, cs: 0.42 })],
            5.4,
          ),
          "8": makeForecast([], 0),
        },
      } as unknown as Player,
      {
        id: 22,
        code: 22,
        name: "KeeperTwo",
        full_name: "Keeper Two",
        position: "GKP",
        position_id: 1,
        team: 2,
        team_name: "Beta",
        team_short: "BET",
        team_code: 20,
        price: 4.5,
        gw: {
          "7": makeForecast(
            [
              makeFixture({
                id: 101,
                home: false,
                opponent: "ALP",
                opponent_id: 1,
                difficulty: 5,
                cs: 0.18,
                team_goals: 0.95,
                conceded: 1.85,
              }),
            ],
            3.1,
          ),
          "8": makeForecast(
            [
              makeFixture({
                id: 102,
                home: true,
                opponent: "ALP",
                opponent_id: 1,
                difficulty: 3,
                cs: 0.31,
              }),
            ],
            4.2,
          ),
        },
      } as unknown as Player,
    ],
    loaded_at: "2026-10-16T15:00:00Z",
    model_version: "1",
    history_rows: 0,
    sources: {},
    limitations: [],
    parameters: {},
    ...overrides,
  };
}

beforeEach(() => {
  resetHooks();
  vi.stubGlobal("sessionStorage", {
    getItem: () => null,
    setItem: () => undefined,
  });
});

describe("FixtureExplorer & FixtureTrend UI fixes", () => {
  it("controls Teams and Filter GWs popovers mutually exclusively and closes on Escape", () => {
    const listeners = new Map<string, EventListener>();
    vi.stubGlobal("document", {
      addEventListener: (type: string, fn: EventListener) =>
        listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    const data = makeBootstrap({
      fixture_scenario: {
        source: "user-assumed",
        label: "Custom",
        adjusted_at: "",
        moves: { "101": 8 },
        receipts: [],
        scope: "global",
      },
      team_strength_scenario: {
        source: "user-assumed",
        label: "Custom",
        adjusted_at: "",
        adjustments: {},
        affected_player_fixtures: 2,
        scope: "global",
      },
    });
    const render = () =>
      renderWithHooks(() =>
        FixtureExplorer({ data, gw: 7, onDetail: vi.fn() }),
      );

    let tree = render();
    // Scenario disclosures render as inline <span> pills, never block <p> bars.
    const scenarioPills = nodes(tree).filter(
      (n) => n.props.className === "subtle-tag",
    );
    expect(scenarioPills).toHaveLength(2);
    expect(scenarioPills.every((n) => n.type === "span")).toBe(true);

    const detailsList = () =>
      nodes(tree).filter(
        (n) =>
          n.type === "details" &&
          String(n.props.className ?? "").includes("fixture-filter"),
      );
    expect(textContent(detailsList()[1].props.children[0])).toContain(
      "Filter GWs",
    );
    expect(detailsList().map((d) => d.props.open)).toEqual([false, false]);

    // Opening Teams opens Teams only.
    detailsList()[0].props.children[0].props.onClick({
      preventDefault: vi.fn(),
    });
    tree = render();
    expect(detailsList().map((d) => d.props.open)).toEqual([true, false]);

    // Opening Filter GWs closes Teams.
    detailsList()[1].props.children[0].props.onClick({
      preventDefault: vi.fn(),
    });
    tree = render();
    expect(detailsList().map((d) => d.props.open)).toEqual([false, true]);

    // Escape inside an open popover stops propagation and restores focus to <summary>.
    const focusSummary = vi.fn();
    const stopPropagation = vi.fn();
    detailsList()[1].props.onKeyDown({
      key: "Escape",
      preventDefault: vi.fn(),
      stopPropagation,
      currentTarget: { querySelector: () => ({ focus: focusSummary }) },
    });
    tree = render();
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(focusSummary).toHaveBeenCalledTimes(1);
    expect(detailsList().map((d) => d.props.open)).toEqual([false, false]);

    // Sources & totals <details> never carries flex .source-caption class.
    const sourcesDetails = nodes(tree).find(
      (n) =>
        n.type === "details" &&
        textContent(n.props.children[0]) === "Sources & totals",
    )!;
    expect(sourcesDetails.props.className).toBe("compact-details");

    // Outside pointerdown closes the open popover; inside pointerdown keeps it open.
    detailsList()[0].props.children[0].props.onClick({
      preventDefault: vi.fn(),
    });
    tree = render();
    const insideNode = {};
    const outsideNode = {};
    hooks.refs[0].current = {
      contains: (target: unknown) => target === insideNode,
    };
    hooks.refs[1].current = { contains: () => false };
    listeners.get("pointerdown")?.({
      target: insideNode,
    } as unknown as Event);
    tree = render();
    expect(detailsList().map((d) => d.props.open)).toEqual([true, false]);

    listeners.get("pointerdown")?.({
      target: outsideNode,
    } as unknown as Event);
    tree = render();
    expect(detailsList().map((d) => d.props.open)).toEqual([false, false]);

    // Fixture chips carry club + GW + aria-haspopup="dialog".
    const chip = nodes(tree).find((n) =>
      String(n.props.className ?? "").includes("fixture-chip"),
    )!;
    expect(chip.props["aria-haspopup"]).toBe("dialog");
    expect(chip.props["aria-label"]).toContain("Alpha GW7");
  });

  it("scales CS sparkline with 0.5 min span, clamps all-negative GD high >= 0, distinguishes Blank vs unavailable, and inverts difficulty y", () => {
    expect(fixtureTrendScale([0.18, 0.42], "cs")).toEqual({
      low: 0,
      high: 0.5,
      baseline: 0,
    });
    expect(fixtureTrendScale([-1.8, -1.3], "gd")).toEqual({
      low: -1.8,
      high: 0,
      baseline: 0,
    });
    expect(formatTrendPoint({ week: 7, value: 0.42, blank: false }, "cs")).toBe(
      "42%",
    );
    expect(formatTrendPoint({ week: 8, value: 0, blank: true }, "cs")).toBe(
      "Blank",
    );
    expect(formatTrendPoint({ week: 9, value: null, blank: false }, "cs")).toBe(
      "unavailable",
    );

    const csSvg = FixtureTrend({
      club: "Alpha",
      metric: "cs",
      points: [
        { week: 7, value: 0.42, blank: false },
        { week: 8, value: 0, blank: true },
        { week: 9, value: null, blank: false },
      ],
      low: 0,
      high: 0.5,
      baseline: 0,
    });
    const csTitle = textContent(
      nodes(csSvg).find((n) => n.type === "title")!.props.children,
    );
    expect(csTitle).toBe("GW7: 42%; GW8: Blank; GW9: unavailable");

    const fdrSvg = FixtureTrend({
      club: "Alpha",
      metric: "difficulty",
      points: [
        { week: 7, value: 2, blank: false },
        { week: 8, value: null, blank: true },
        { week: 9, value: 5, blank: false },
      ],
      low: 1,
      high: 5,
      baseline: 3,
    });
    const circles = nodes(fdrSvg).filter((n) => n.type === "circle");
    // Inverted y: FDR 2 (easy) has smaller cy (higher on chart) than FDR 5 (hard).
    expect(circles[0].props.cy).toBeLessThan(circles[1].props.cy);
    const fdrTitle = textContent(
      nodes(fdrSvg).find((n) => n.type === "title")!.props.children,
    );
    expect(fdrTitle).toContain("GW8: Blank");
    expect(fdrTitle).toContain("higher = easier");
  });
});

describe("FixtureSchedule live rollover, badges, club notices & window action", () => {
  const catalogFor = (next_gw: number): FixtureCatalog => ({
    season: "2026-27",
    next_gw,
    gameweeks: Array.from({ length: 39 - next_gw }, (_, i) => i + next_gw),
    fixtures: [
      { id: 71, event: next_gw, team_h: 1, team_a: 2, kickoff_time: null },
      { id: 72, event: 38, team_h: 2, team_a: 1, kickoff_time: null },
    ],
  });

  it("re-fetches catalog when data.next_gw advances", async () => {
    let currentNextGW = 7;
    const fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => catalogFor(currentNextGW),
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    let data = makeBootstrap({ next_gw: 7 });
    const render = () =>
      renderWithHooks(() =>
        FixtureSchedule({
          data,
          gw: data.next_gw,
          moves: {},
          onChange: vi.fn(),
        }),
      );

    render();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    currentNextGW = 8;
    data = makeBootstrap({ next_gw: 8, gameweeks: [8, 9] });
    render();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("shows Moved badge only on changed cards, uses club names in notices, and expands span from inline button", () => {
    const data = makeBootstrap();
    const catalog = catalogFor(7);
    let moves: Record<string, number | null> = {};
    const onChange = vi.fn((next: Record<string, number | null>) => {
      moves = next;
    });
    const render = () =>
      renderWithHooks(() =>
        FixtureSchedule({ data, gw: 7, moves, onChange, catalog }),
      );

    let tree = render();
    expect(
      nodes(tree).filter(
        (n) => n.props.className === "fixture-schedule-assumption",
      ),
    ).toHaveLength(0);

    // Move fixture 71 (Alpha v Beta) to GW38 (outside default 5-GW span).
    const select = nodes(tree).find((n) =>
      String(n.props["aria-label"] ?? "").includes("fixture 71"),
    )!;
    select.props.onChange({ target: { value: "38" } });
    tree = render();

    const notice = nodes(tree).find(
      (n) => n.props.className === "fixture-schedule-notice",
    )!;
    expect(textContent(notice)).toBe("Alpha v Beta moved to GW38.");

    // Inline button expands window to all remaining GWs so GW38 card is visible.
    const showAllBtn = nodes(tree).find(
      (n) =>
        n.type === "button" &&
        textContent(n.props.children) === "Show all remaining GWs",
    )!;
    showAllBtn.props.onClick();
    tree = render();

    const badges = nodes(tree).filter(
      (n) => n.props.className === "fixture-schedule-assumption",
    );
    expect(badges).toHaveLength(1);
    expect(textContent(badges[0])).toBe("Moved → GW38");
  });
});

describe("FixtureMarkets & FixtureDetail guards and deadline clamping", () => {
  it("guards keeper missing gw, marks moved fixtures Moved, shows scenario pills, and filters 0 GWs", () => {
    const base = makeBootstrap({
      fixture_scenario: {
        source: "user-assumed",
        label: "Custom",
        adjusted_at: "",
        moves: { "101": 8 },
        receipts: [],
        scope: "global",
      },
    });
    // First keeper on team 1 has empty gw; outfield fallback has moved fixture in GW7.
    const movedFixture = makeFixture({
      id: 101,
      kickoff: null,
      original_event: 9,
      target_event: 7,
    });
    const data: Bootstrap = {
      ...base,
      players: [
        { ...base.players[0], gw: {} },
        {
          ...base.players[0],
          id: 12,
          position_id: 2,
          position: "DEF",
          gw: { "7": makeForecast([movedFixture], 5) },
        },
      ],
    };
    const tree = renderWithHooks(() =>
      FixtureMarkets({ data, gw: 7, onDetail: vi.fn() }),
    );
    const card = nodes(tree).find(
      (n) => n.props.className === "market-fixture-card",
    )!;
    expect(textContent(card)).toContain("Moved");
    expect(textContent(card)).not.toContain("TBC");
    expect(
      nodes(tree).some(
        (n) =>
          n.type === "span" &&
          n.props.className === "subtle-tag" &&
          textContent(n).includes("Custom schedule"),
      ),
    ).toBe(true);

    // When gw exceeds all remaining gameweeks, Horizon never renders "0 GWs".
    resetHooks();
    const emptyTree = renderWithHooks(() =>
      FixtureMarkets({ data, gw: 39, onDetail: vi.fn() }),
    );
    const horizonSelect = nodes(emptyTree).find(
      (n) => n.props["aria-label"] === "Fixture market horizon",
    )!;
    expect(nodes(horizonSelect.props.children)).toHaveLength(0);
    // Graph view passes 4 distinct colors and returns null for missing GW forecasts (0 for scheduled blanks).
    resetHooks();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) =>
        key === "open-fpl-view:market.fixtures.view" ? '"graph"' : null,
      setItem: () => undefined,
    });
    const graphData = makeBootstrap();
    // Team 1 has GW7 fixture, GW8 blank (fixtures: []), and GW9 missing (undefined).
    const graphTree = renderWithHooks(() =>
      FixtureMarkets({ data: graphData, gw: 7, onDetail: vi.fn() }),
    );
    const chart = nodes(graphTree).find((n) => n.type === LineChart)!;
    expect(chart.props.colors).toEqual([
      "#ff764d",
      "#61ba9a",
      "#7c94cb",
      "#e0b15b",
    ]);
    expect(chart.props.series[0].values).toEqual([1.85, 0, null]);
  });

  it("clamps expired gw to data.next_gw in FixtureDetail, guards invalid dates, and falls back to fixture.opponent", () => {
    const onDetail = vi.fn();
    const onClose = vi.fn();
    const data = makeBootstrap({
      next_gw: 8,
      gameweeks: [8, 9],
      players: [
        {
          ...makeBootstrap().players[0],
          gw: {
            "8": makeForecast(
              [
                makeFixture({
                  opponent: "UNK",
                  opponent_id: 999,
                  kickoff: "not-a-valid-date",
                  team_strength_scenario: {
                    label: "Human",
                    source: "user",
                    adjusted_at: "now",
                    attack_factor: 1.1,
                    conceded_factor: 0.9,
                    base: {
                      team_goals: 1.5,
                      conceded: 1.0,
                      cs: 0.35,
                      source: "FPL Joe",
                    },
                  },
                }),
              ],
              6.2,
            ),
          },
        },
      ],
    });
    const tree = FixtureDetail({
      data,
      team: 1,
      gw: 7, // Expired GW from before deadline rollover
      onClose,
      onDetail,
    });
    const scenarioPill = nodes(tree).find(
      (n) => n.props.className === "subtle-tag",
    )!;
    expect(scenarioPill.type).toBe("span");
    expect(textContent(tree)).not.toContain("Invalid Date");
    expect(textContent(tree)).toContain("UNK goals");
    expect(textContent(tree)).toContain("UNK CS");

    const playerBtn = nodes(tree).find(
      (n) => typeof n.props.onClick === "function" && n.props.player?.id === 11,
    )!;
    playerBtn.props.onClick();
    expect(onDetail).toHaveBeenCalledExactlyOnceWith(11, 8);
  });
});

describe("TeamStrengths & MarketMovement UI fixes", () => {
  it("formats microsecond ISO timestamps cleanly, shortens club aria-labels, and folds Controls & provenance", () => {
    expect(
      formatSourceTimes([
        "2026-10-16T14:23:09.847392+00:00",
        "2026-10-16T14:23:55.102938Z",
      ]),
    ).toBe("16 Oct, 14:23 UTC");
    expect(
      formatSourceTimes([
        "2026-10-14T08:10:00.123456Z",
        "2026-10-16T14:23:09.847392+00:00",
      ]),
    ).toBe("14 Oct, 08:10 UTC – 16 Oct, 14:23 UTC");

    const base = makeBootstrap({ gameweeks: [7], next_gw: 7 });
    const tree = renderWithHooks(() =>
      TeamStrengths({ data: base, strengths: {}, onChange: vi.fn() }),
    );
    const svg = nodes(tree).find((n) => n.type === "svg")!;
    expect(svg.props["aria-label"]).toContain("Arrow keys");

    const points = nodes(tree).filter((n) =>
      String(n.props.className ?? "").includes("ts-point"),
    );
    expect(points).toHaveLength(2);
    expect(points[0].props["aria-label"]).toBe(
      "Alpha: 1.85 goals, 0.95 conceded",
    );
    expect(points[0].props["aria-label"]).not.toContain("Arrow keys");
    const pointTitle = nodes(points[0]).find((n) => n.type === "title")!;
    expect(typeof pointTitle.props.children).toBe("string");

    const provenance = nodes(tree).find(
      (n) =>
        n.type === "details" &&
        textContent(n.props.children[0]) === "Controls & provenance",
    )!;
    expect(textContent(provenance)).toContain("16 Oct, 14:23 UTC");
    expect(textContent(provenance)).not.toContain("847392");
  });

  it("uses TabStrip for Movement metric and colors positive/negative deltas green/red", async () => {
    const payload = {
      coverage: {
        snapshots: 2,
        fixtures: 1,
        series: 2,
        comparable_series: 2,
        teams: ["ALP", "BET"],
        gameweeks: [7],
        first_extracted_at: "2026-10-15T10:00:00Z",
        last_extracted_at: "2026-10-16T10:00:00Z",
      },
      notes: [],
      diagnostics: {},
      series: [
        {
          season: "2026-27",
          fixture_id: 101,
          gameweek: 7,
          home: "ALP",
          away: "BET",
          team: "ALP",
          source: "fpljoe",
          metric: "goals",
          unit: "goals",
          points: [
            {
              extracted_at: "2026-10-15T10:00:00Z",
              provider_at: null,
              provider_time_kind: "none",
              value: 1.6,
              sha256: "aaaa111122223333",
              mapping_sha256: "m",
              fixture_mapping_sha256: "f",
            },
            {
              extracted_at: "2026-10-16T10:00:00Z",
              provider_at: null,
              provider_time_kind: "none",
              value: 1.85,
              sha256: "bbbb111122223333",
              mapping_sha256: "m",
              fixture_mapping_sha256: "f",
            },
          ],
          latest: {} as any,
          previous: null,
          delta: null,
          state: "comparable",
        },
        {
          season: "2026-27",
          fixture_id: 101,
          gameweek: 7,
          home: "ALP",
          away: "BET",
          team: "BET",
          source: "fpljoe",
          metric: "goals",
          unit: "goals",
          points: [
            {
              extracted_at: "2026-10-15T10:00:00Z",
              provider_at: null,
              provider_time_kind: "none",
              value: 1.1,
              sha256: "aaaa111122223333",
              mapping_sha256: "m",
              fixture_mapping_sha256: "f",
            },
            {
              extracted_at: "2026-10-16T10:00:00Z",
              provider_at: null,
              provider_time_kind: "none",
              value: 0.95,
              sha256: "bbbb111122223333",
              mapping_sha256: "m",
              fixture_mapping_sha256: "f",
            },
          ],
          latest: {} as any,
          previous: null,
          delta: null,
          state: "comparable",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => payload })),
    );
    const render = () => renderWithHooks(() => MarketMovement({ gw: 7 }));
    render();
    await vi.waitFor(() => {
      const tree = render();
      expect(
        nodes(tree).some(
          (n) =>
            n.props.role === "tablist" &&
            n.props["aria-label"] === "Movement metric",
        ),
      ).toBe(true);
      const cells = nodes(tree).filter((n) => n.type === "td");
      const pos = cells.find((c) => textContent(c).includes("+0.25 goals"))!;
      const neg = cells.find((c) => textContent(c).includes("-0.15 goals"))!;
      expect(pos.props.className).toContain("green");
      expect(neg.props.className).toContain("red");

      // Every SVG <title> has a single string child (React 19 compatibility).
      for (const titleNode of nodes(tree).filter((n) => n.type === "title")) {
        expect(typeof titleNode.props.children).toBe("string");
      }
    });

    // Single-timestamp series centers points at cx=358, omits duplicate right label, and supports <tr> click.
    resetHooks();
    const singlePayload = {
      ...payload,
      series: [
        {
          ...payload.series[0],
          fixture_id: 202,
          points: [payload.series[0].points[1]],
        },
        {
          ...payload.series[1],
          fixture_id: 303,
          points: [payload.series[1].points[1]],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ ok: true, json: async () => singlePayload }),
      ),
    );
    render();
    await vi.waitFor(() => {
      let tree = render();
      const circle = nodes(tree).find((n) => n.type === "circle")!;
      expect(circle.props.cx).toBe(358);
      const axisStamps = nodes(tree).filter(
        (n) => n.type === "text" && n.props.y === "205",
      );
      expect(axisStamps).toHaveLength(1);

      const secondRow = nodes(tree).filter((n) => n.type === "tr")[2];
      secondRow.props.onClick();
      tree = render();
      expect(
        nodes(tree).filter((n) => n.type === "tr")[2].props.className,
      ).toContain("selected-fixture");
    });
  });
});

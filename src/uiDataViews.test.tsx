import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DataRefreshSettings from "./DataRefreshSettings";
import { LeadTimeView } from "./LeadTimeView";
import { ProspectiveView } from "./ProspectiveView";
import { ReferenceView } from "./ReferenceView";
import { SeasonData } from "./SeasonData";
import { TabStrip } from "./TabStrip";
import type { Bootstrap, LeadTimeReport, Player, Prospective } from "./types";

const viewState = vi.hoisted(() => new Map<string, unknown>());
const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void | (() => void))[],
  nextRef: undefined as unknown,
}));

vi.mock("./useViewState", () => ({
  useViewState: (key: string, fallback: unknown) => [
    viewState.has(key) ? viewState.get(key) : fallback,
    (value: unknown) => viewState.set(key, value),
  ],
}));

vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useMemo: (calculate: () => unknown) => calculate(),
    useRef: (initial: unknown) => {
      if (hooks.nextRef !== undefined) {
        const ref = { current: hooks.nextRef };
        hooks.nextRef = undefined;
        return ref;
      }
      return { current: initial };
    },
    useEffect: (effect: () => void | (() => void)) => {
      hooks.effects.push(effect);
    },
    useState: (initial: unknown) => {
      const slot = hooks.cursor++;
      if (!(slot in hooks.values)) {
        hooks.values[slot] =
          typeof initial === "function"
            ? (initial as () => unknown)()
            : initial;
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
  };
});

type Node = ReactElement<Record<string, any>>;
function walk(tree: ReactNode): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(walk);
  if (!isValidElement(tree)) return [];
  const node = tree as Node;
  if (typeof node.type === "function") {
    const rendered = (node.type as (props: Record<string, any>) => ReactNode)(
      node.props,
    );
    return [node, ...walk(rendered)];
  }
  return [node, ...walk(node.props.children)];
}

function makePlayer(id: number, overrides: Partial<Player> = {}): Player {
  return {
    id,
    code: 1000 + id,
    name: `Player ${id}`,
    full_name: `Player Full ${id}`,
    position: "MID",
    position_id: 3,
    team: 1,
    team_name: "Arsenal",
    team_short: "ARS",
    team_code: 3,
    price: 7.5,
    ownership: 12.3,
    status: "a",
    news: "",
    chance: 100,
    form: 5,
    total_points: 100 - id,
    minutes: 900,
    xg90: 0.4,
    xa90: 0.3,
    xmins: 85,
    pplay: 0.95,
    p60: 0.85,
    dc_probability: 0,
    sample_matches: 10,
    has_prior: true,
    overridden: false,
    price_change: 0,
    transfers_in: 0,
    transfers_out: 0,
    price_change_percent: null,
    price_change_projections: [],
    penalties_order: null,
    gw: {
      "7": { points: 5.2, xmins: 85, fixtures: [], components: {} },
      "9": { points: 6.8, xmins: 88, fixtures: [], components: {} },
    },
    ...overrides,
  };
}

describe("owned data views and tab strip", () => {
  beforeEach(() => {
    hooks.values = [];
    hooks.cursor = 0;
    hooks.effects = [];
    viewState.clear();
  });

  it("TabStrip falls back to tabIndex=0 on the first tab when value is stale and applies 12px scroll inset in reveal", () => {
    const html = renderToStaticMarkup(
      createElement(TabStrip, {
        label: "Mode",
        value: "stale-id" as "a" | "b",
        items: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
        onChange: vi.fn(),
      }),
    );
    expect(html).toContain('tabindex="0"');
    expect(html).not.toMatch(/tabindex="-1"[^>]*>Alpha/);

    // Verify 12px scroll inset via reveal():
    const prevResizeObserver = globalThis.ResizeObserver;
    let resizeCallback: (() => void) | null = null;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        resizeCallback = cb;
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      const fakeActive = {
        getBoundingClientRect: () => ({ left: 100, right: 195 }),
      };
      const fakeNode = {
        scrollLeft: 0,
        querySelector: () => fakeActive,
        getBoundingClientRect: () => ({ left: 0, right: 200 }),
      };
      hooks.nextRef = fakeNode;
      hooks.effects = [];
      renderToStaticMarkup(
        createElement(TabStrip, {
          label: "Mode",
          value: "b",
          items: [
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
          ],
          onChange: vi.fn(),
        }),
      );
      hooks.effects[0]?.();
      // item.right (195) > bounds.right - 12 (188) => scrollLeft += 7
      expect(fakeNode.scrollLeft).toBe(7);
      expect(resizeCallback).toBeTypeOf("function");
    } finally {
      globalThis.ResizeObserver = prevResizeObserver;
    }
  });

  it("LeadTimeView reads selected model coverage instead of hardcoded FPL Form and marks errors as alert", () => {
    const report: LeadTimeReport = {
      inventory: {
        bins: [
          {
            id: "7d_plus",
            label: "7d+",
            capture_count: 1,
            pending_count: 0,
            ready_count: 1,
            pending_targets: [],
            gameweeks: [],
            pairwise_comparisons: {},
            captured_targets: [
              {
                gw: 12,
                snapshot: "snap.json",
                recorded_at: "2026-10-01T12:00:00Z",
                deadline: "2026-10-10T17:30:00Z",
                current_deadline: "2026-10-10T17:30:00Z",
                deadline_changed: false,
                lead_hours: 216,
                origin_gameweek: 10,
                model_version: "v1",
                configuration_hash: "abcdef123456",
                manual_configuration: false,
                status: "pending_outcome",
                cohort: { eligible_count: 280 },
                coverage: {
                  "Component model": {
                    forecast_count: 280,
                    eligible_count: 280,
                  },
                  "FPL Form": { forecast_count: 0, eligible_count: 280 },
                },
              },
            ],
          },
        ],
      },
    };
    hooks.values[0] = report;
    hooks.values[1] = "Network down";
    const data = {
      teams: [],
      events: [],
      gameweeks: [10],
    } as unknown as Bootstrap;
    const html = renderToStaticMarkup(
      createElement(LeadTimeView, { captureKey: "k1", data }),
    );
    expect(html).toContain("<td>280/280 eligible</td>");
    expect(html).not.toContain("<td>0/280 eligible</td>");
    expect(html).toContain('role="alert"');
  });

  it("ProspectiveView discloses Showing latest 5 of N and toggles to show all captures", () => {
    const captures = Array.from({ length: 7 }, (_, i) => ({
      gw: 10 - i,
      filename: `gw${10 - i}.json`,
      recorded_at: "2026-10-01T12:00:00Z",
      deadline: "2026-10-02T17:30:00Z",
      lead_hours: 12,
      players: 250,
      capture_receipt: null,
    }));
    const report: Prospective = {
      method: "Deadline-aligned scoring.",
      captures,
      gameweeks: [],
    };
    const data = { events: [], forecast_layers: [] } as unknown as Bootstrap;

    hooks.cursor = 0;
    const collapsed = renderToStaticMarkup(
      createElement(ProspectiveView, {
        data,
        report,
        onScore: vi.fn(),
        busy: false,
      }),
    );
    expect(collapsed).toContain("Showing latest 5 of 7");
    expect(collapsed).toContain("gw10.json");
    expect(collapsed).not.toContain("gw4.json");

    hooks.values[0] = true;
    hooks.cursor = 0;
    const expanded = renderToStaticMarkup(
      createElement(ProspectiveView, {
        data,
        report,
        onScore: vi.fn(),
        busy: false,
      }),
    );
    expect(expanded).toContain("Showing all 7 captures");
    expect(expanded).toContain("gw4.json");
  });

  it("ReferenceView passes selectedGW to onDetail and reflects watched Star fill and aria-pressed", () => {
    viewState.set("market.references.view", "three_gw_goals");
    viewState.set("market.references.gw", 9);
    const onDetail = vi.fn();
    const data = {
      next_gw: 7,
      players: [makePlayer(1), makePlayer(2)],
      reference_data: {
        provider: "Elevenify",
        season: "2026-27",
        season_inferred: true,
        available: true,
        status: "live",
        players: {
          "1": {
            player_id: 1,
            attacking_views: {
              three_gw_goals: {
                source_key: "elevenify_three_gw_goals",
                conditioning: "start",
                duration_minutes: null,
                gameweeks: { "9": { goal: 0.55 } },
              },
            },
            matches: [],
          },
          "2": {
            player_id: 2,
            attacking_views: {
              three_gw_goals: {
                source_key: "elevenify_three_gw_goals",
                conditioning: "start",
                duration_minutes: null,
                gameweeks: { "9": { goal: 0.35 } },
              },
            },
            matches: [],
          },
        },
        feeds: {
          three_gw_goals: {
            url: "https://example.com",
            status: "live",
            source_at: "2026-10-01T12:00:00Z",
            sha256: "abc",
            last_modified: null,
            available: true,
            row_count: 2,
            matched_players: 2,
            caption: "GW9 goals, conditional on starting",
            units: "goals",
            gameweeks: [9],
            caption_current: true,
            window_status: "future",
            validation: null,
            diagnostics: {},
          },
        },
        coverage: {
          official_players: 2,
          matched_players: 2,
          baseline_players: 0,
          importance_players: 0,
        },
        limitations: ["Provider start conditioning."],
      },
    } as unknown as Bootstrap;

    const tree = createElement(ReferenceView, {
      data,
      gw: 7,
      onDetail,
      watch: [1],
      onWatch: vi.fn(),
    });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('aria-label="Watch Player 1" aria-pressed="true"');
    expect(html).toContain('aria-label="Watch Player 2" aria-pressed="false"');
    expect(html).toContain('fill="currentColor"');

    hooks.cursor = 0;
    const allNodes = walk(tree);
    const playerBtn = allNodes.find(
      (n) => n.type === "button" && n.props.className === "player-name-cell",
    );
    expect(playerBtn).toBeDefined();
    playerBtn!.props.onClick();
    expect(onDetail).toHaveBeenCalledWith(1, 9);
  });

  it("DataRefreshSettings renders shortened status copy and orange alert text", () => {
    hooks.values[0] = null;
    hooks.values[1] = "Timeout";
    const html = renderToStaticMarkup(createElement(DataRefreshSettings));
    expect(html).toContain("Waiting for first check.");
    expect(html).toContain("Solio updates ~4h; requires running server.");
    expect(html).toContain('class="orange help-text" role="alert"');
  });

  it("SeasonData paginates >50 rows, resets page on Per 90, places fallback above workspace, flips right-edge scatter labels, and hides map player select for teams", async () => {
    const players = Array.from({ length: 60 }, (_, idx) =>
      makePlayer(idx + 1, {
        minutes: idx === 0 ? 900 : 100 + idx,
        total_points: idx === 0 ? 150 : 60 - idx,
      }),
    );
    const data = {
      season: "2026-27",
      sources: {
        fpl_bootstrap: {
          status: "live",
          fetched_at: "2026-10-15T12:00:00Z",
          url: "https://fantasy.premierleague.com/api/bootstrap-static/",
        },
      },
      teams: [{ id: 1, code: 3, name: "Arsenal", short_name: "ARS" }],
      players,
    } as unknown as Bootstrap;

    const prevFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("Stats feed unavailable (503)")),
    ) as unknown as typeof fetch;

    const renderTree = () => {
      hooks.cursor = 0;
      return walk(createElement(SeasonData, { data, onDetail: vi.fn() }));
    };
    const renderHtml = () => {
      hooks.cursor = 0;
      return renderToStaticMarkup(
        createElement(SeasonData, { data, onDetail: vi.fn() }),
      );
    };

    try {
      // Mount & let fetch rejection settle via SeasonData's own useEffect:
      hooks.effects = [];
      renderTree();
      for (const effect of hooks.effects) effect();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Default players Table with fallback error:
      const tableHtml = renderHtml();
      expect(tableHtml.indexOf("season-data-fallback")).toBeGreaterThan(-1);
      expect(tableHtml.indexOf("season-data-fallback")).toBeLessThan(
        tableHtml.indexOf("season-data-workspace"),
      );
      expect(tableHtml).toContain("1–50 of 60 players");
      expect(tableHtml).toContain("Page 1 of 2");

      // Advance to page 2 via Next button, then toggle Per 90 to reset to page 1:
      const nextBtn = renderTree().find(
        (n) => n.type === "button" && n.props.children === "Next",
      );
      expect(nextBtn).toBeDefined();
      nextBtn!.props.onClick();
      expect(renderHtml()).toContain("Page 2 of 2");

      const per90Label = renderTree().find(
        (n) => n.type === "label" && n.props.className === "season-data-toggle",
      );
      const per90Checkbox = walk(per90Label?.props.children).find(
        (n) => n.type === "input" && n.props.type === "checkbox",
      );
      expect(per90Checkbox).toBeDefined();
      per90Checkbox!.props.onChange({ target: { checked: true } });
      expect(renderHtml()).toContain("Page 1 of 2");
      per90Checkbox!.props.onChange({ target: { checked: false } });

      // Select Player 1 via Compare button, then switch to Graph tab via TabStrip:
      const comparePlayer1 = renderTree().find(
        (n) =>
          n.type === "button" && n.props["aria-label"] === "Compare Player 1",
      );
      expect(comparePlayer1).toBeDefined();
      comparePlayer1!.props.onClick();

      const graphTab = renderTree().find(
        (n) =>
          n.type === "button" &&
          n.props.role === "tab" &&
          n.props.children === "Graph",
      );
      expect(graphTab).toBeDefined();
      graphTab!.props.onClick();

      const graphHtml = renderHtml();
      expect(graphHtml).not.toContain("\\n");
      expect(graphHtml).toContain("Player Full 1 · ARS\n");
      expect(graphHtml).toContain('text-anchor="end"');
      expect(graphHtml).toContain('y="48"');

      // Switch to Teams entity and Maps tool via TabStrip buttons:
      const teamsTab = renderTree().find(
        (n) =>
          n.type === "button" &&
          n.props.role === "tab" &&
          n.props.children === "Teams",
      );
      expect(teamsTab).toBeDefined();
      teamsTab!.props.onClick();

      const mapsTab = renderTree().find(
        (n) =>
          n.type === "button" &&
          n.props.role === "tab" &&
          n.props.children === "Maps",
      );
      expect(mapsTab).toBeDefined();
      mapsTab!.props.onClick();

      expect(renderHtml()).not.toContain("Player for maps");
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});

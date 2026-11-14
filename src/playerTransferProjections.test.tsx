import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionMenu,
  computeModalPosition,
  LineChart,
  PlayerName,
} from "./components";
import { MinutesScenarioEditor } from "./MinutesScenarioEditor";
import { PlayerSurface } from "./PlayerSurface";
import { ProjectionsView } from "./ProjectionExplorer";
import { StatScenarioEditor } from "./StatScenarioEditor";
import { TransferPanel } from "./TransferPanel";
import type { Bootstrap, Plan, Player, Week } from "./types";

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void | (() => void))[],
  effectDeps: [] as (readonly unknown[] | undefined)[],
  viewStore: {} as Record<string, unknown>,
}));

vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useMemo: (calculate: () => unknown) => calculate(),
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: (
      effect: () => void | (() => void),
      deps?: readonly unknown[],
    ) => {
      state.effects.push(effect);
      state.effectDeps.push(deps);
    },
    useState: (initial: unknown) => {
      const slot = state.cursor++;
      if (!(slot in state.values)) {
        state.values[slot] =
          typeof initial === "function" ? (initial as () => unknown)() : initial;
      }
      return [
        state.values[slot],
        (next: unknown) => {
          state.values[slot] =
            typeof next === "function"
              ? (next as (prev: unknown) => unknown)(state.values[slot])
              : next;
        },
      ];
    },
  };
});

vi.mock("react-dom", async (original) => {
  const actual = await original<typeof import("react-dom")>();
  return {
    ...actual,
    createPortal: (children: ReactNode) => children,
  };
});

vi.mock("./useViewState", () => ({
  useViewState: (key: string, fallback: unknown) => {
    if (!(key in state.viewStore)) state.viewStore[key] = fallback;
    return [
      state.viewStore[key],
      (next: unknown) => {
        state.viewStore[key] =
          typeof next === "function"
            ? (next as (prev: unknown) => unknown)(state.viewStore[key])
            : next;
      },
    ];
  },
}));

type ElementNode = ReactElement<Record<string, any>>;
function nodes(tree: ReactNode): ElementNode[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement(tree)) return [];
  const node = tree as ElementNode;
  return [node, ...nodes(node.props.children)];
}

function makePlayer(overrides: Partial<Player> & { id: number }): Player {
  return {
    code: overrides.id * 10,
    name: `Player ${overrides.id}`,
    full_name: `Player ${overrides.id} Full`,
    position: "MID",
    position_id: 3,
    team: 1,
    team_name: "Arsenal",
    team_short: "ARS",
    team_code: 3,
    price: 7.5,
    ownership: 20,
    status: "a",
    news: "",
    chance: 100,
    form: 5,
    total_points: 60,
    minutes: 900,
    xg90: 0.3,
    xa90: 0.2,
    xmins: 90,
    pplay: 1,
    p60: 0.9,
    dc_probability: 0.1,
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
      "11": {
        points: 6.2,
        xmins: 90,
        components: { goals: 2.5 },
        fixtures: [
          {
            id: 101,
            opponent: "CHE",
            opponent_id: 2,
            home: true,
            difficulty: 3,
            kickoff: null,
            source: "model",
            source_at: null,
            points: 6.2,
            xmins: 90,
            xg: 0.1,
            xa: 0.2,
            cs: 0.29,
            pplay: 1,
            p60: 0.9,
            team_goals: 1.8,
            conceded: 1.1,
            components: {},
          },
        ],
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  state.values = [];
  state.cursor = 0;
  state.effects = [];
  state.effectDeps = [];
  state.viewStore = {};
});

describe("ProjectionExplorer UI & state sync", () => {
  it("renders Cancel transfer in replacement banner, validates stale gw sort, formats 1 GW singularly, and prefixes positive Δ xPts", () => {
    const selected = makePlayer({ id: 1, name: "Saka", price: 10.0 });
    const upgrade = makePlayer({
      id: 2,
      name: "Palmer",
      team: 2,
      team_short: "CHE",
      price: 10.5,
      gw: {
        "11": {
          ...selected.gw["11"],
          points: 8.7,
        },
      },
    });
    const nearEqual = makePlayer({
      id: 3,
      name: "Mbeumo",
      team: 2,
      team_short: "CHE",
      price: 8.0,
      gw: {
        "11": {
          ...selected.gw["11"],
          points: 6.18, // -0.02 delta rounds to "0.0" green, not "-0.0" red
        },
      },
    });
    const data = {
      gameweeks: [11],
      teams: [
        { id: 1, name: "Arsenal", short_name: "ARS", code: 3 },
        { id: 2, name: "Chelsea", short_name: "CHE", code: 8 },
      ],
      players: [selected, upgrade, nearEqual],
    } as unknown as Bootstrap;

    state.viewStore["projections.sort"] = "gw99";
    state.viewStore["projections.metric"] = "cs";
    state.viewStore["projections.query"] = "Palm";

    const onCancelTransfer = vi.fn();
    const render = () => {
      state.cursor = 0;
      state.effects = [];
      return ProjectionsView({
        data,
        gw: 11,
        onDetail: vi.fn(),
        onEditorTarget: vi.fn(),
        editing: { id: 2, gw: 11 },
        watch: [],
        onWatch: vi.fn(),
        onCSV: vi.fn(),
        onExport: vi.fn(),
        selectedPlayer: selected,
        squad: [1],
        onTransfer: vi.fn(),
        onCancelTransfer,
        teamStrengths: {},
        onTeamStrengths: vi.fn(),
        fixtureMoves: {},
        onFixtureMoves: vi.fn(),
      });
    };

    const tree = render();
    for (const effect of state.effects) effect();
    expect(state.viewStore["projections.sort"]).toBe("average");

    const cancelBtn = nodes(tree).find(
      (n) => n.props["aria-label"] === "Cancel transfer",
    );
    expect(cancelBtn).toBeDefined();
    cancelBtn!.props.onClick();
    expect(onCancelTransfer).toHaveBeenCalledOnce();

    const toggle = nodes(tree).find((n) =>
      n.props.className?.includes("projection-controls-toggle"),
    );
    expect(nodes(toggle!).map((n) => n.props.children).join(" ")).toContain(
      "Clean sheets %",
    );
    expect(nodes(toggle!).map((n) => n.props.children).join(" ")).toContain(
      "1 GW",
    );
    expect(nodes(toggle!).map((n) => n.props.children).join(" ")).not.toContain(
      "1 GWs",
    );

    const horizonOptions = nodes(tree).filter((n) => n.type === "option");
    const horizonLabels = horizonOptions.map((o) =>
      Array.isArray(o.props.children)
        ? o.props.children.join("")
        : String(o.props.children),
    );
    expect(horizonLabels).toContain("1 GW");
    expect(horizonLabels).not.toContain("1 GWs");
    expect(horizonLabels).not.toContain("0 GWs");

    const rangeSmall = nodes(tree).find(
      (n) => n.type === "small" && n.props.children === "GW11",
    );
    expect(rangeSmall).toBeDefined();

    const clearSearch = nodes(tree).find(
      (n) => n.props["aria-label"] === "Clear search",
    );
    expect(clearSearch).toBeDefined();
    clearSearch!.props.onClick({});
    expect(state.viewStore["projections.query"]).toBe("");

    const treeAfterClear = render();
    const deltaCells = nodes(treeAfterClear).filter(
      (n) =>
        n.type === "td" &&
        typeof n.props.className === "string" &&
        n.props.className.includes("green numeric"),
    );
    const cellTexts = deltaCells.map((c) =>
      Array.isArray(c.props.children)
        ? c.props.children.join("")
        : String(c.props.children),
    );
    expect(cellTexts).toContain("+2.5");
    expect(cellTexts.filter((t) => t === "0.0")).toHaveLength(2);
    expect(
      nodes(treeAfterClear).some(
        (n) =>
          n.type === "td" &&
          typeof n.props.className === "string" &&
          n.props.className.includes("red numeric"),
      ),
    ).toBe(false);

    // Clicking a sort header resets page to 0 (slot 1 is page state)
    state.values[1] = 2;
    const priceHeaderBtn = nodes(treeAfterClear).find(
      (n) =>
        n.type === "button" &&
        Array.isArray(n.props.children) &&
        n.props.children[0] === "£",
    )!;
    priceHeaderBtn.props.onClick();
    expect(state.viewStore["projections.sort"]).toBe("price");
    expect(state.values[1]).toBe(0);
  });

  it("guards null source_at in TeamProjectionGrid fixture titles", () => {
    state.viewStore["projections.section"] = "teams";
    const player = makePlayer({ id: 1 });
    const data = {
      gameweeks: [11],
      teams: [{ id: 1, name: "Arsenal", short_name: "ARS", code: 3 }],
      players: [player],
    } as unknown as Bootstrap;

    const html = renderToStaticMarkup(
      ProjectionsView({
        data,
        gw: 11,
        onDetail: vi.fn(),
        onEditorTarget: vi.fn(),
        watch: [],
        onWatch: vi.fn(),
        onCSV: vi.fn(),
        onExport: vi.fn(),
        squad: [],
        onTransfer: vi.fn(),
        onCancelTransfer: vi.fn(),
        teamStrengths: {},
        onTeamStrengths: vi.fn(),
        fixtureMoves: {},
        onFixtureMoves: vi.fn(),
      }),
    );
    expect(html).toContain("model · Time unavailable");
    expect(html).not.toContain("· null");
  });
});

describe("StatScenarioEditor & MinutesScenarioEditor sync and precision", () => {
  it("rounds IEEE-754 floats cleanly, disables Reset GW when unedited, and resyncs draft when schedule prop changes", () => {
    const base = makePlayer({ id: 7 });
    const player = makePlayer({
      id: 7,
      gw: {
        "11": {
          ...base.gw["11"],
          fixtures: [
            { ...base.gw["11"].fixtures[0], id: 1, xg: 0.1, cs: 0.29 },
            { ...base.gw["11"].fixtures[0], id: 2, xg: 0.2, cs: 0.29 },
          ],
        },
      },
    });
    const props = {
      player,
      weeks: [11, 12],
      gw: 11,
      onGWChange: vi.fn(),
      schedule: {} as Record<string, any>,
      onSchedule: vi.fn(),
      onNotify: vi.fn(),
    };
    const render = () => {
      state.cursor = 0;
      return StatScenarioEditor(props);
    };

    let tree = render();
    const resetBtn = nodes(tree).find(
      (n) =>
        n.type === "button" &&
        Array.isArray(n.props.children) &&
        n.props.children.includes("Reset GW"),
    )!;
    expect(resetBtn.props.disabled).toBe(true);

    // Toggle clean sheet & xG defaults and verify zero IEEE-754 float garbage
    nodes(tree)
      .find((n) => n.props["aria-label"] === "Override Expected goals")!
      .props.onChange({ target: { checked: true } });
    nodes(tree)
      .find((n) => n.props["aria-label"] === "Override Clean sheet chance")!
      .props.onChange({ target: { checked: true } });

    tree = render();
    expect(
      nodes(tree).find((n) => n.props["aria-label"] === "Assumed Expected goals")!
        .props.value,
    ).toBe("0.3");
    expect(
      nodes(tree).find(
        (n) => n.props["aria-label"] === "Assumed Clean sheet chance",
      )!.props.value,
    ).toBe("29");

    // External prop sync (e.g. CSV/shared import or external reset)
    props.schedule = {
      "11": { clean_sheet_probability: 0.57, expected_points: 6.1000000000000005 },
    };
    tree = render();
    expect(
      nodes(tree).find(
        (n) => n.props["aria-label"] === "Assumed Clean sheet chance",
      )!.props.value,
    ).toBe("57");
    expect(
      nodes(tree).find(
        (n) => n.props["aria-label"] === "Assumed Expected points",
      )!.props.value,
    ).toBe("6.1");

    const clearChip = nodes(tree).find(
      (n) => n.props["aria-label"] === "Clear stat edit GW11",
    )!;
    expect(clearChip.props.className).toBe("icon-button");

    // External wipe clears local draft immediately on render
    props.schedule = {};
    tree = render();
    expect(
      nodes(tree).find(
        (n) => n.props["aria-label"] === "Override Clean sheet chance",
      )!.props.checked,
    ).toBe(false);
  });

  it("resets MinutesScenarioEditor local state on Use model, GW clear, selectGW, and external prop changes", () => {
    const player = makePlayer({ id: 9, chance: 75, status: "d" });
    const props = {
      player,
      weeks: [11, 12],
      gw: 11,
      onGWChange: vi.fn(),
      globalMinutes: undefined as number | undefined,
      schedule: {
        "11": { conditional_minutes: 60, availability: 0.25 },
        "12": { conditional_minutes: 75 },
      } as Record<string, any>,
      onSchedule: vi.fn(),
      onReset: vi.fn(),
      onNotify: vi.fn(),
    };
    const render = () => {
      state.cursor = 0;
      return MinutesScenarioEditor(props);
    };

    let tree = render();
    expect(
      nodes(tree).find(
        (n) => n.props["aria-label"] === "Conditional player minutes",
      )!.props.value,
    ).toBe(60);
    expect(
      nodes(tree).find(
        (n) => n.props["aria-label"] === "Assumed player availability",
      )!.props.value,
    ).toBe(25);

    // Selecting GW12 (which has no availability override) resets availability to player's default 75%
    const gw12Btn = nodes(tree).find(
      (n) =>
        n.type === "button" &&
        Array.isArray(n.props.children) &&
        n.props.children[1] === "12",
    )!;
    gw12Btn.props.onClick();
    props.gw = 12;
    tree = render();
    expect(
      nodes(tree).find(
        (n) => n.props["aria-label"] === "Conditional player minutes",
      )!.props.value,
    ).toBe(75);
    // Toggle ownAvailability to inspect reset default availability (75%)
    nodes(tree)
      .find((n) => n.type === "input" && n.props.type === "checkbox")!
      .props.onChange({ target: { checked: true } });
    tree = render();
    expect(
      nodes(tree).find(
        (n) => n.props["aria-label"] === "Assumed player availability",
      )!.props.value,
    ).toBe(75);

    // Use model resets local state even before props mutate
    const useModel = nodes(tree).find(
      (n) => n.type === "button" && n.props.children === "Use model",
    )!;
    useModel.props.onClick();
    props.schedule = {};
    tree = render();
    expect(props.onReset).toHaveBeenCalledOnce();
    expect(
      nodes(tree).find(
        (n) => n.props["aria-label"] === "Conditional player minutes",
      )!.props.value,
    ).toBe(90);
  });
});

describe("TransferPanel, PlayerSurface, Modal, ActionMenu & PlayerName", () => {
  it("renders TransferPanel clear button, watched star state, over-budget tint, and 3/3 pill without .transfer-limit", () => {
    const outgoing = makePlayer({ id: 1, position: "MID", position_id: 3, team: 4, price: 6.0 });
    const affordablePick = makePlayer({
      id: 2,
      name: "Rogers",
      position: "MID",
      position_id: 3,
      team: 5,
      price: 5.5,
      gw: {
        "11": {
          ...outgoing.gw["11"],
          points: 6.18, // delta -0.02 rounds to 0.0, never "-0.0"
        },
      },
    });
    const overBudgetPick = makePlayer({ id: 3, name: "Salah", position: "MID", position_id: 3, team: 6, price: 13.5 });
    const clubCapPick = makePlayer({ id: 4, name: "Odegaard", position: "MID", position_id: 3, team: 1, price: 5.5 });
    const clubMate1 = makePlayer({ id: 10, team: 1 });
    const clubMate2 = makePlayer({ id: 11, team: 1 });
    const clubMate3 = makePlayer({ id: 12, team: 1 });

    const week: Week = {
      gw: 11,
      squad: [1, 10, 11, 12],
      starters: [1, 10, 11, 12],
      bench: [],
      captain: 10,
      vice: 11,
      chip: "none",
      bank: 0,
      free_transfers: 1,
      next_free_transfers: 2,
      hits: 0,
      points: 0,
      net_points: 0,
      transfers_in: [],
      transfers_out: [],
    };
    const plan: Plan = {
      id: "p1",
      name: "Main",
      weeks: [week],
      base_squad: week.squad,
      base_bank: 0,
      free_transfers: 1,
      purchase_prices: {},
      created_at: "",
    };
    const data = {
      players: [outgoing, affordablePick, overBudgetPick, clubCapPick, clubMate1, clubMate2, clubMate3],
      gameweeks: [11],
      teams: [],
    } as unknown as Bootstrap;

    const render = () => {
      state.cursor = 0;
      return TransferPanel({
        data,
        plan,
        week,
        outgoing,
        busy: false,
        watch: [2],
        onWatch: vi.fn(),
        onInspect: vi.fn(),
        onTransfer: vi.fn(async () => false),
      });
    };

    let tree = render();
    // Switch to All players
    nodes(tree)
      .find((n) => n.type === "button" && n.props.children === "All players")!
      .props.onClick();
    nodes(tree)
      .find((n) => n.props["aria-label"] === "Search replacements")!
      .props.onChange({ target: { value: "a" } });
    tree = render();

    expect(
      nodes(tree).find((n) => n.props["aria-label"] === "Clear replacement search"),
    ).toBeDefined();

    // Clear search to view all candidates
    nodes(tree)
      .find((n) => n.props["aria-label"] === "Clear replacement search")!
      .props.onClick({});
    tree = render();

    const html = renderToStaticMarkup(tree);
    expect(html).not.toContain('class="transfer-limit"');
    expect(html).toContain('class="over-budget-price"');
    expect(html).toContain('class="club-cap-pill"');
    expect(html).toContain(">3/3</span>");
    expect(html).toContain(">1 GW</option>");
    expect(html).not.toContain(">1 GWs</option>");
    expect(html).not.toContain("-0.0");
    expect(html).not.toContain("+0.0");
    expect(html).toContain('<td class="green">0.0</td>');

    const watchedBtn = nodes(tree).find(
      (n) => n.props["aria-label"] === "Watch Rogers",
    )!;
    expect(watchedBtn.props["aria-pressed"]).toBe(true);
  });

  it("handles Escape and tracks subtitle in focus/scroll effect deps on inline PlayerSurface", () => {
    const onClose = vi.fn();
    const target = {} as HTMLElement;
    const tree = PlayerSurface({
      title: "Saka",
      subtitle: "Arsenal · MID · GW11",
      onClose,
      anchor: null,
      target,
      children: null,
    });
    expect(state.effectDeps[1]).toEqual([
      target,
      "Saka",
      "Arsenal · MID · GW11",
    ]);
    const section = nodes(tree).find((n) => n.type === "section")!;
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    section.props.onKeyDown({
      key: "Escape",
      defaultPrevented: false,
      preventDefault,
      stopPropagation,
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("computes floating Modal geometry with 12px right margin, mid-width shrink >=340px, and centered fallback", () => {
    // Wide desktop: full 480px on right with >=12px margin
    const wide = computeModalPosition(
      { left: 100, right: 200, top: 180, bottom: 260 },
      1440,
      900,
    );
    expect(wide).toEqual({ left: 212, top: 80, width: 480 });

    // Right-edge margin check: 300 + 480 + 12 = 792 > 800 - 12 (788), so shrinks to 476px!
    const rightEdge = computeModalPosition(
      { left: 100, right: 300, top: 150, bottom: 230 },
      800,
      900,
    );
    expect(rightEdge).toEqual({ left: 312, top: 50, width: 476 });
    expect(rightEdge!.left + rightEdge!.width).toBeLessThanOrEqual(800 - 12);

    // Mid-width 800px with tile at 380..450: shrinks to 356px on left, never covers tile
    const midLeft = computeModalPosition(
      { left: 380, right: 450, top: 200, bottom: 280 },
      800,
      900,
    );
    expect(midLeft).toEqual({ left: 12, top: 100, width: 356 });
    expect(midLeft!.left + midLeft!.width).toBeLessThanOrEqual(380 - 12);

    // Mid-width 740px with centered tile 340..400: neither side >=340px -> null (centered backdrop)
    expect(
      computeModalPosition(
        { left: 340, right: 400, top: 200, bottom: 280 },
        740,
        900,
      ),
    ).toBeNull();
  });

  it("wraps PlayerName text in .player-name-label alongside injury icon and omits invalid role=menu in ActionMenu with form controls", () => {
    const injured = makePlayer({
      id: 5,
      name: "Alexander-Arnold",
      status: "d",
    });
    const nameHtml = renderToStaticMarkup(PlayerName({ player: injured }));
    expect(nameHtml).toContain(
      '<span class="player-name-label">Alexander-Arnold</span>',
    );
    expect(nameHtml).toContain("<svg");

    // Button-only ActionMenu gets role="menu" and keeps role="menuitem"
    state.values = [true];
    state.cursor = 0;
    const menuHtml = renderToStaticMarkup(
      ActionMenu({
        label: "Actions",
        children: <button role="menuitem">Copy</button>,
      }),
    );
    expect(menuHtml).toContain('role="menu"');
    expect(menuHtml).toContain('role="menuitem"');
    expect(menuHtml).toContain('aria-haspopup="menu"');

    // Mixed form-control ActionMenu omits invalid role="menu" AND strips role="menuitem"
    state.values = [true];
    state.cursor = 0;
    const configHtml = renderToStaticMarkup(
      ActionMenu({
        label: "Configure",
        children: [
          <label key="branch">
            Branch
            <select>
              <option value="1">GW1</option>
            </select>
          </label>,
          <button key="base" role="menuitem">
            Base team & resources
          </button>,
        ],
      }),
    );
    expect(configHtml).not.toContain('role="menu"');
    expect(configHtml).not.toContain('role="menuitem"');
    expect(configHtml).not.toContain('aria-haspopup="menu"');
    expect(configHtml).toContain("Base team &amp; resources");

    // LineChart SVG <title> renders a single string without React 19 warnings
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const chartHtml = renderToStaticMarkup(
      LineChart({
        series: [{ name: "Expected points", values: [6.25, 5.5] }],
        labels: ["GW11", "GW12"],
      }),
    );
    expect(chartHtml).toContain("<title>Expected points · GW11: 6.25</title>");
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

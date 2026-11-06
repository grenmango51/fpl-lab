import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Pitch } from "./components";
import { TransferPanel } from "./TransferPanel";
import { StatScenarioEditor } from "./StatScenarioEditor";
import { MinutesScenarioEditor } from "./MinutesScenarioEditor";
import type { Bootstrap, Plan, Player, Week } from "./types";
import fixture from "../backend/tests/fixtures/transfer_affordability.json";

// Exercise real component event handlers and state transitions without a browser.
// Native focus, geometry, keyboard dispatch and touch still need parent capture.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useMemo: (calculate: () => unknown) => calculate(),
  useState: (initial: unknown) => {
    const slot = hooks.cursor++;
    if (!(slot in hooks.values)) hooks.values[slot] = initial;
    return [
      hooks.values[slot],
      (value: unknown) => {
        hooks.values[slot] =
          typeof value === "function" ? value(hooks.values[slot]) : value;
      },
    ];
  },
}));

// Walk JSX children, leaving composed components intact so their callbacks can
// also be inspected. No replacement implementation of the UI is rendered.
type Node = ReactElement<Record<string, any>>;
function nodes(tree: ReactNode): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement(tree)) return [];
  const node = tree as Node;
  return [node, ...nodes(node.props.children)];
}
function find(tree: ReactNode, predicate: (node: Node) => boolean) {
  const match = nodes(tree).find(predicate);
  expect(match, "Expected control to be rendered").toBeDefined();
  return match!;
}
const labelled = (tree: ReactNode, label: string) =>
  find(tree, (node) => node.props["aria-label"] === label);
const textButton = (tree: ReactNode, text: string) =>
  find(
    tree,
    (node) =>
      node.type === "button" &&
      (node.props.children === text ||
        (Array.isArray(node.props.children) &&
          node.props.children.includes(text))),
  );

const players = fixture.players.map(([id, position_id, team, price]) => ({
  id,
  position_id,
  team: id === 19 ? 1 : team,
  price,
  name: `Player ${id}`,
  position: ["", "GKP", "DEF", "MID", "FWD"][position_id],
  team_short: "TST",
  status: "a",
  gw: {
    "7": { points: id, xmins: 90, fixtures: [] },
    "8": { points: id * 2, xmins: 0, fixtures: [] },
  },
})) as unknown as Player[];
const week = {
  gw: 7,
  squad: Array.from({ length: 15 }, (_, i) => i + 1),
  starters: [1, 3, 4, 5, 8, 9, 10, 11, 13, 14, 15],
  bench: [2, 6, 7, 12],
  captain: 13,
  vice: 8,
  chip: "none",
  bank: 0,
  free_transfers: 2,
  next_free_transfers: 3,
  hits: 0,
  points: 0,
  net_points: 0,
  transfers_in: [],
  transfers_out: [],
} as Week;
const plan = {
  id: "source-plan",
  name: "Source",
  weeks: [week],
  base_squad: week.squad,
  base_bank: 0,
  free_transfers: 2,
  purchase_prices: { "13": 5.5 },
  created_at: "",
} as Plan;
function panel() {
  const props = {
    data: { players, gameweeks: [7, 8], teams: [] } as unknown as Bootstrap,
    plan,
    week,
    outgoing: players[12],
    busy: false,
    watch: [],
    onWatch: vi.fn(),
    onInspect: vi.fn(),
    onTransfer: vi.fn(async (_id: number) => false),
  };
  return {
    props,
    render: () => {
      hooks.cursor = 0;
      return TransferPanel(props);
    },
  };
}
beforeEach(() => {
  hooks.values = [];
  hooks.cursor = 0;
});

describe("compact transfer decisions", () => {
  it("exposes search and eligibility immediately; choosing previews before committing", () => {
    const ui = panel();
    let tree = ui.render();
    const search = labelled(tree, "Search replacements");
    // Both controls are outside every collapsed disclosure.
    for (const disclosure of nodes(tree).filter((n) => n.type === "details")) {
      expect(nodes(disclosure.props.children)).not.toContain(search);
      expect(nodes(disclosure.props.children)).not.toContain(
        textButton(tree, "All players"),
      );
    }
    textButton(tree, "All players").props.onClick();
    tree = ui.render();
    expect(textButton(tree, "All players").props["aria-pressed"]).toBe(true);
    for (const [id, reason] of [
      [18, "Over budget"],
      [19, "3 players from club"],
    ]) {
      const pick = labelled(tree, `Choose Player ${id}: ${reason}`);
      expect(pick.type).toBe("button");
      expect(pick.props.disabled).toBe(true);
      pick.props.onClick(); // Guard also rejects stale/programmatic activation.
      expect(
        nodes(ui.render()).some(
          (n) => n.props.className === "transfer-confirm",
        ),
      ).toBe(false);
    }
    search.props.onChange({ target: { value: "Player 16" } });
    tree = ui.render();
    expect(
      nodes(tree).filter((n) => n.props.className === "transfer-pick"),
    ).toHaveLength(1);
    const choose = labelled(tree, "Choose Player 16");
    expect(choose.type).toBe("button"); // Native Enter/Space activation.
    choose.props.onClick();
    tree = ui.render();
    expect(ui.props.onTransfer).not.toHaveBeenCalled();
    expect(
      nodes(tree).some((n) => n.props.className === "transfer-confirm"),
    ).toBe(true);
    textButton(tree, "Shortlist").props.onClick();
    expect(labelled(ui.render(), "Search replacements").props.value).toBe(
      "Player 16",
    );
  });

  it("keeps failed validation retryable and blocks stale confirmation when busy or ineligible", async () => {
    const ui = panel();
    labelled(ui.render(), "Choose Player 16").props.onClick();
    textButton(ui.render(), "Confirm transfer").props.onClick();
    await vi.waitFor(() =>
      expect(ui.props.onTransfer).toHaveBeenCalledExactlyOnceWith(16),
    );
    await vi.waitFor(() =>
      expect(nodes(ui.render()).some((n) => n.props.role === "alert")).toBe(
        true,
      ),
    );
    ui.props.busy = true;
    const pending = textButton(ui.render(), "Checking…");
    expect(pending.props.disabled).toBe(true);
    pending.props.onClick();
    expect(ui.props.onTransfer).toHaveBeenCalledTimes(1);
    ui.props.busy = false;
    // Current canonical resources can change while a candidate is selected.
    ui.props.plan = { ...plan, base_bank: -0.1 };
    const blocked = labelled(ui.render(), "Confirm transfer: Over budget");
    expect(blocked.props.disabled).toBe(true);
    blocked.props.onClick();
    expect(ui.props.onTransfer).toHaveBeenCalledTimes(1);
    ui.props.plan = plan;
    textButton(ui.render(), "Confirm transfer").props.onClick();
    expect(ui.props.onTransfer).toHaveBeenCalledTimes(2);
  });

  it("filters using the exact selected GW and preserves inspection/watch actions", () => {
    const ui = panel();
    ui.props.week = { ...week, gw: 8 };
    expect(
      nodes(ui.render()).filter((n) => n.props.className === "transfer-pick"),
    ).toHaveLength(0);
    find(
      ui.render(),
      (n) => n.type === "input" && n.props.type === "checkbox",
    ).props.onChange({ target: { checked: true } });
    const tree = ui.render();
    const name = find(tree, (n) => n.props.player?.id === 16);
    name.props.onClick();
    expect(ui.props.onInspect).toHaveBeenCalledExactlyOnceWith(16);
    labelled(tree, "Watch Player 16").props.onClick();
    expect(ui.props.onWatch).toHaveBeenCalledExactlyOnceWith(16);
    expect(
      nodes(tree).some(
        (n) => n.type === "th" && n.props.children?.join?.("") === "GW8",
      ),
    ).toBe(true);
  });
});

describe("direct pitch tools with deliberate substitutions", () => {
  function pitch(selected: number | null = null, disabled = false) {
    const props = {
      week,
      players,
      selected,
      disabled,
      interactionMode:
        selected === null ? ("inspect" as const) : ("substitute" as const),
      swapTargets: selected === 8 ? [6, 7, 12] : [],
      onSelect: vi.fn(),
      onDetail: vi.fn(),
      onBenchSwap: vi.fn(),
      onSwap: vi.fn(),
    };
    return {
      props,
      render: () => {
        hooks.cursor = 0;
        return Pitch(props);
      },
    };
  }
  it("opens tools from a single native primary activation and selects substitutions explicitly", () => {
    const ui = pitch();
    const primary = labelled(ui.render(), "Open Player 8");
    expect(primary.type).toBe("button");
    primary.props.onClick();
    expect(ui.props.onDetail).toHaveBeenCalledExactlyOnceWith(8);
    expect(ui.props.onSelect).not.toHaveBeenCalled();
    labelled(ui.render(), "Select Player 8 for substitution").props.onClick();
    expect(ui.props.onSelect).toHaveBeenCalledExactlyOnceWith(8);
    const swapping = pitch(8);
    labelled(swapping.render(), "Substitute Player 6").props.onClick();
    expect(swapping.props.onBenchSwap).toHaveBeenCalledExactlyOnceWith(6);
    expect(swapping.props.onDetail).not.toHaveBeenCalled();
    labelled(swapping.render(), "Deselect Player 8").props.onClick();
    expect(swapping.props.onSelect).toHaveBeenCalledExactlyOnceWith(8);
  });
  it("retains drag legality and restores click feedback after cancelled keeper drag", () => {
    const ui = pitch(8);
    const transfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    labelled(ui.render(), "Select Player 1").props.onDragStart({
      dataTransfer: transfer,
      currentTarget: { querySelector: () => null },
      preventDefault: vi.fn(),
    });
    const tree = ui.render();
    const targets = nodes(tree).filter((n) =>
      n.props.className?.includes("swap-target"),
    );
    expect(targets.map((n) => n.key)).toEqual(["2"]);
    const invalid = find(tree, (n) => n.key === "6" && Boolean(n.props.onDrop));
    invalid.props.onDrop({ preventDefault: vi.fn() });
    expect(ui.props.onSwap).not.toHaveBeenCalled();
    expect(
      nodes(ui.render())
        .filter((n) => n.props.className?.includes("swap-target"))
        .map((n) => n.key),
    ).toEqual(["6", "7", "12"]);
  });
  it("blocks primary opening, selection and drag callbacks while disabled", () => {
    const ui = pitch(null, true);
    labelled(ui.render(), "Open Player 8").props.onClick();
    expect(
      nodes(ui.render()).some((n) => n.props.className === "player-substitute"),
    ).toBe(false);
    const preventDefault = vi.fn();
    labelled(ui.render(), "Open Player 8").props.onDragStart({
      preventDefault,
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(ui.props.onDetail).not.toHaveBeenCalled();
    expect(ui.props.onSelect).not.toHaveBeenCalled();
    labelled(ui.render(), "Info for Player 8").props.onClick();
    expect(ui.props.onDetail).toHaveBeenCalledExactlyOnceWith(8);
  });
});

describe("shared forecast editor scope", () => {
  it("saves and resets only the shared player week without erasing other weeks", () => {
    const props = {
      player: players[12],
      weeks: [7, 8],
      gw: 8,
      onGWChange: vi.fn(),
      schedule: { "7": { expected_points: 1 } },
      onSchedule: vi.fn(),
      onNotify: vi.fn(),
    };
    const render = () => {
      hooks.cursor = 0;
      return StatScenarioEditor(props);
    };
    let tree = render();
    labelled(tree, "Override Expected points").props.onChange({
      target: { checked: true },
    });
    tree = render();
    labelled(tree, "Assumed Expected points").props.onChange({
      target: { value: "7.3" },
    });
    tree = render();
    textButton(tree, "Save stats").props.onClick();
    expect(props.onSchedule).toHaveBeenLastCalledWith({
      "7": { expected_points: 1 },
      "8": { expected_points: 7.3 },
    });
    expect(props.onNotify.mock.lastCall?.[0]).toContain(
      "GW8: Saved for all plans.",
    );
    expect(nodes(tree).some((n) => n.props.children === "All plans")).toBe(
      true,
    );
    props.schedule = props.onSchedule.mock.lastCall![0];
    textButton(render(), "Reset GW").props.onClick();
    expect(props.onSchedule).toHaveBeenLastCalledWith({
      "7": { expected_points: 1 },
    });
    expect(props.onNotify.mock.lastCall?.[0]).toContain(
      "GW8: Override cleared.",
    );
  });

  it("saves minutes against the same supplied week and preserves earlier assumptions", () => {
    const props = {
      player: players[12],
      weeks: [7, 8],
      gw: 8,
      onGWChange: vi.fn(),
      schedule: { "7": { conditional_minutes: 45 } },
      onSchedule: vi.fn(),
      onReset: vi.fn(),
      onNotify: vi.fn(),
    };
    const render = () => {
      hooks.cursor = 0;
      return MinutesScenarioEditor(props);
    };
    let tree = render();
    labelled(tree, "Conditional player minutes").props.onChange({
      target: { value: "30" },
    });
    tree = render();
    textButton(tree, "Save minutes").props.onClick();
    expect(props.onSchedule).toHaveBeenLastCalledWith({
      "7": { conditional_minutes: 45 },
      "8": { conditional_minutes: 30 },
    });
    expect(props.onNotify.mock.lastCall?.[0]).toContain(
      "GW8: Saved for all plans.",
    );
    const savedWeek = find(
      tree,
      (n) =>
        n.type === "button" &&
        Array.isArray(n.props.children) &&
        n.props.children[1] === "7",
    );
    savedWeek.props.onClick();
    expect(props.onGWChange).toHaveBeenCalledWith(7);
  });

  it("defaults transfer comparison to the plan and names any manually extended range", () => {
    const ui = panel();
    ui.props.plan = {
      ...plan,
      weeks: [7, 8, 9, 10].map((gw) => ({ ...week, gw })),
    };
    ui.props.data = {
      ...ui.props.data,
      gameweeks: [7, 8, 9, 10, 11],
      players: structuredClone(players),
    };
    const outgoing = ui.props.data.players.find((p) => p.id === 13)!;
    const target = ui.props.data.players.find((p) => p.id === 16)!;
    for (const [gw, a, b] of [
      [9, 20, 25],
      [10, 30, 30],
      [11, 90, 40],
    ]) {
      outgoing.gw[String(gw)] = { ...outgoing.gw["7"], points: a };
      target.gw[String(gw)] = { ...target.gw["7"], points: b };
    }
    ui.props.outgoing = outgoing;
    let tree = ui.render();
    expect(labelled(tree, "Replacement horizon").props.value).toBe(4);
    labelled(tree, "Choose Player 16").props.onClick();
    tree = ui.render();
    const delta = (rendered: ReactNode, range: string) => {
      const box = find(
        rendered,
        (n) =>
          n.type === "div" &&
          Array.isArray(n.props.children) &&
          [n.props.children[0]?.props?.children].flat().join("") ===
            `${range} Δ xPts`,
      );
      return Number(find(box, (n) => n.type === "b").props.children);
    };
    expect(delta(tree, "GW7–10")).toBe(14);
    textButton(tree, "Shortlist").props.onClick();
    tree = ui.render();
    labelled(tree, "Replacement horizon").props.onChange({
      target: { value: "5" },
    });
    tree = ui.render();
    labelled(tree, "Choose Player 16").props.onClick();
    expect(delta(ui.render(), "GW7–11")).toBe(-36);
  });
});

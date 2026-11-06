import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Pitch } from "./components";
import { TransferPanel } from "./TransferPanel";
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
        hooks.values[slot] = value;
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

import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as components from "./components";
import { PlannerBoard } from "./PlannerBoard";
import {
  canSwap,
  replacePlayer,
  sellingPrice,
  transferAllowance,
} from "./plannerInteractions";
import type { Bootstrap, Plan, Player, Week } from "./types";

const players = Array.from(
  { length: 16 },
  (_, i) =>
    ({
      id: i + 1,
      name: `Player ${i + 1}`,
      position_id: i < 2 ? 1 : i < 7 ? 2 : i < 12 ? 3 : 4,
      price: 6,
      team_short: "ARS",
      status: "a",
      gw: {},
    }) as Player,
);
function week(gw: number): Week {
  return {
    gw,
    squad: Array.from({ length: 15 }, (_, i) => i + 1),
    starters: [1, 3, 4, 5, 8, 9, 10, 11, 13, 14, 15],
    bench: [2, 6, 7, 12],
    captain: 13,
    vice: 8,
    chip: "none",
    bank: 1,
    free_transfers: 2,
    next_free_transfers: 3,
    hits: 0,
    points: 40,
    net_points: 40,
    transfers_in: [],
    transfers_out: [],
  };
}
function plan(): Plan {
  return {
    id: "test",
    name: "Test",
    weeks: [week(7), week(8), week(9), week(10)],
    base_squad: week(7).squad,
    base_bank: 1,
    free_transfers: 2,
    purchase_prices: { "13": 5.5 },
    created_at: "2026-10-14",
  };
}

describe("contextual planner decisions", () => {
  it("uses integer selling steps for profits and losses", () => {
    expect(sellingPrice(5.8, 5.5)).toBe(5.6);
    expect(sellingPrice(5.9, 5.5)).toBe(5.7);
    expect(sellingPrice(5.2, 5.5)).toBe(5.2);
  });
  it("uses the server purchase receipt for the selected week", () => {
    const p = plan(),
      w = p.weeks[0];
    w.purchase_prices = { "13": 5.7 };
    expect(transferAllowance(p, w, { ...players[12], price: 6.2 })).toEqual({
      sale: 5.9,
      budget: 6.9,
    });
  });
  it("previews an affordable temporary FH player's current-price sale", () => {
    const p = plan(),
      w = p.weeks[0];
    w.chip = "freehit";
    w.purchase_prices = {};
    expect(transferAllowance(p, w, players[12]).budget).toBe(7);
  });
  it("rejects a substitution below the minimum defence and permits a legal formation change", () => {
    const w = week(7);
    expect(canSwap(w, players[2], players[11], players)).toBe(false);
    expect(canSwap(w, players[7], players[5], players)).toBe(true);
    expect(canSwap(w, players[0], players[5], players)).toBe(false);
    expect(canSwap(w, players[0], players[1], players)).toBe(true);
  });
  it("keeps manual XI, captain, vice and bench roles across a transfer", () => {
    const p = plan(),
      next = replacePlayer(p, 8, 13, 16);
    expect(next.weeks[0]).toEqual(p.weeks[0]);
    expect(next.weeks[1].captain).toBe(16);
    expect(next.weeks[1].vice).toBe(8);
    expect(next.weeks[1].starters).toEqual([
      1, 3, 4, 5, 8, 9, 10, 11, 16, 14, 15,
    ]);
    expect(next.weeks[1].bench).toEqual(p.weeks[1].bench);
    expect(p.weeks[1].captain).toBe(13);
  });
  it("limits a Free Hit transfer to its temporary gameweek", () => {
    const p = plan();
    p.weeks[1].chip = "freehit";
    const next = replacePlayer(p, 8, 13, 16);
    expect(next.weeks[1].squad).toContain(16);
    expect(next.weeks[2]).toEqual(p.weeks[2]);
  });
  it("preserves a later independent FH selection and resumes permanent holdings", () => {
    const p = plan();
    p.weeks[1].chip = "freehit";
    const next = replacePlayer(p, 7, 13, 16);
    expect(next.weeks[1]).toEqual(p.weeks[1]);
    expect(next.weeks[2].squad).toContain(16);
  });
  it("stops carrying a move when the incoming player was already planned", () => {
    const p = plan();
    p.weeks[2].squad[14] = 16;
    const next = replacePlayer(p, 7, 13, 16);
    expect(next.weeks[1].squad).toContain(16);
    expect(next.weeks[2]).toEqual(p.weeks[2]);
    expect(next.weeks[3]).toEqual(p.weeks[3]);
  });
});

function boardPitch(selected: number | null, busy = false) {
  const callbacks = {
    onSelect: vi.fn(),
    onDetail: vi.fn(),
    onBenchSwap: vi.fn(),
    onSwap: vi.fn(),
  };
  const capture = vi
    .spyOn(components, "Pitch")
    .mockImplementation(() => createElement("div"));
  try {
    renderToStaticMarkup(
      createElement(PlannerBoard, {
        data: { players, next_gw: 7, gameweeks: [7, 8, 9, 10] } as Bootstrap,
        plan: plan(),
        week: week(7),
        selected,
        busy,
        ...callbacks,
        onWeek: vi.fn(),
        onName: vi.fn(),
        onHorizon: vi.fn(),
        onClone: vi.fn(),
        onChip: vi.fn(),
        onBestXI: vi.fn(),
        onReset: vi.fn(),
        onTeam: vi.fn(),
        onOptimise: vi.fn(),
        onShare: vi.fn(),
        onLockTransfers: vi.fn(),
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        canUndo: false,
        canRedo: false,
      }),
    );
    return { pitch: capture.mock.calls[0][0], ...callbacks };
  } finally {
    capture.mockRestore();
  }
}

describe("direct pitch selection", () => {
  it("selects, deselects and changes a source without opening details", () => {
    const first = boardPitch(null);
    first.pitch.onSelect(3);
    expect(first.onSelect).toHaveBeenCalledWith(3);
    const active = boardPitch(3);
    active.pitch.onSelect(3);
    expect(active.onSelect).toHaveBeenLastCalledWith(null);
    active.pitch.onSelect(4);
    expect(active.onSelect).toHaveBeenLastCalledWith(4);
    expect(first.onDetail).not.toHaveBeenCalled();
    expect(active.onDetail).not.toHaveBeenCalled();
  });

  it("offers legal substitutions in both directions and retains an invalid source", () => {
    for (const [source, target] of [
      [8, 6],
      [6, 8],
      [1, 2],
      [2, 1],
    ]) {
      const active = boardPitch(source);
      expect(active.pitch.swapTargets).toContain(target);
      active.pitch.onBenchSwap(target);
      expect(active.onBenchSwap).toHaveBeenCalledExactlyOnceWith(target);
    }
    for (const [source, invalid] of [
      [3, 12],
      [12, 3],
      [1, 6],
      [6, 1],
    ]) {
      const active = boardPitch(source);
      expect(active.pitch.swapTargets).not.toContain(invalid);
      active.pitch.onSelect(invalid);
      active.pitch.onBenchSwap(invalid);
      expect(active.onSelect).not.toHaveBeenCalled();
      expect(active.onBenchSwap).not.toHaveBeenCalled();
      expect(active.onDetail).not.toHaveBeenCalled();
    }
  });

  it("blocks selection and swap callbacks while busy but retains explicit info", () => {
    const active = boardPitch(8, true);
    expect(active.pitch.disabled).toBe(true);
    expect(active.pitch.onSwap).toBeUndefined();
    expect(active.pitch.swapTargets).toEqual([]);
    active.pitch.onSelect(8);
    active.pitch.onSelect(9);
    active.pitch.onBenchSwap(6);
    expect(active.onSelect).not.toHaveBeenCalled();
    expect(active.onBenchSwap).not.toHaveBeenCalled();
    active.pitch.onDetail(8);
    expect(active.onDetail).toHaveBeenCalledExactlyOnceWith(8);
  });

  const pitchProps: ComponentProps<typeof components.Pitch> = {
    week: week(7),
    players,
    selected: 8,
    onSelect: vi.fn(),
    onDetail: vi.fn(),
    onBenchSwap: vi.fn(),
    onSwap: vi.fn(),
    swapTargets: [6, 7, 12],
  };

  it("exposes selection, substitution and info as separate accessible actions", () => {
    const html = renderToStaticMarkup(
      createElement(components.Pitch, {
        ...pitchProps,
        interactionMode: "substitute",
      }),
    );
    expect(html).toContain(
      'aria-label="Deselect Player 8" aria-pressed="true"',
    );
    expect(html).toContain('aria-label="Select Player 3" aria-pressed="false"');
    expect(html).toContain('aria-label="Substitute Player 6"');
    expect(html).toContain('aria-label="Info for Player 8"');
    expect(html).not.toContain('aria-label="Open Player');
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(15);
  });

  it("disables every primary tile and drag handle while busy", () => {
    const html = renderToStaticMarkup(
      createElement(components.Pitch, {
        ...pitchProps,
        interactionMode: "substitute",
        disabled: true,
      }),
    );
    const tiles = html.match(/<button class="player-select"[^>]*>/g)!;
    expect(tiles).toHaveLength(15);
    expect(
      tiles.every(
        (tile) =>
          tile.includes('disabled=""') && tile.includes('draggable="false"'),
      ),
    ).toBe(true);
  });

  it("keeps other pitch consumers in inspect mode by default", () => {
    const html = renderToStaticMarkup(
      createElement(components.Pitch, {
        ...pitchProps,
        selected: null,
        swapTargets: undefined,
      }),
    );
    expect(html).toContain('aria-label="Open Player 8"');
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(15);
    expect(html).not.toContain("aria-pressed=");
    expect(html).not.toContain('aria-label="Info for');
  });
});

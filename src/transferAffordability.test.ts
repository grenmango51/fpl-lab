import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import fixture from "../backend/tests/fixtures/transfer_affordability.json";
import { transferAllowance } from "./plannerInteractions";
import { TransferPanel } from "./TransferPanel";
import type { Bootstrap, Plan, Player, Week } from "./types";

const ui = vi.hoisted(() => ({
  target: null as Player | null,
  affordable: true,
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    // Seed only the confirmation target and affordable filter for SSR assertions.
    useState: (initial: unknown) =>
      actual.useState(
        initial === null
          ? ui.target
          : initial === true
            ? ui.affordable
            : initial,
      ),
  };
});

function scenario(spec: (typeof fixture.cases)[number]) {
  const players = fixture.players.map(([id, position_id, team, price]) => ({
    id,
    position_id,
    team: (spec.teams as Record<string, number> | undefined)?.[id] ?? team,
    price: (spec.prices as Record<string, number> | undefined)?.[id] ?? price,
    name: `Player ${id}`,
    position: ["", "GKP", "DEF", "MID", "FWD"][position_id],
    team_short: "TST",
    status: "a",
    gw: Object.fromEntries(
      spec.weeks.map((w) => [w.gw, { points: 2, xmins: 90 }]),
    ),
  })) as Player[];
  const base_squad = Array.from({ length: 15 }, (_, i) => i + 1);
  const weeks = spec.weeks.map((w) => {
    const replace = (id: number) =>
      w.swaps.reduce(
        (pid, [out, incoming]) => (pid === out ? incoming : pid),
        id,
      );
    return {
      gw: w.gw,
      chip: ("chip" in w ? w.chip : "none") as Week["chip"],
      squad: base_squad.map(replace),
      starters: [1, 3, 4, 5, 8, 9, 10, 11, 13, 14, 15].map(replace),
      bench: [2, 6, 7, 12].map(replace),
      captain: replace(13),
      vice: 8,
      bank: spec.expected.bank,
      free_transfers:
        ("freeTransfers" in spec.expected
          ? spec.expected.freeTransfers
          : undefined) ?? 5,
      next_free_transfers: 5,
      hits: 0,
      points: 0,
      net_points: 0,
      transfers_in: [],
      transfers_out: [],
      // A post-decision receipt must not erase an entering player's old cost.
      purchase_prices: { "16": 6 },
    } satisfies Week;
  });
  const plan = {
    id: "test",
    name: "Test",
    weeks,
    base_squad,
    base_bank: spec.bank ?? 0,
    purchase_prices: spec.purchases ?? { "13": 5.5 },
    free_transfers:
      ("free_transfers" in spec ? spec.free_transfers : undefined) ?? 5,
    created_at: "2026-11-05",
  } as Plan;
  return {
    players,
    plan,
    week: weeks.at(-1)!,
    outgoing: players.find((p) => p.id === spec.outgoing)!,
    target: players.find((p) => p.id === spec.target)!,
    data: {
      players,
      gameweeks: weeks.map((w) => w.gw),
      teams: [],
    } as unknown as Bootstrap,
  };
}

function render(
  spec: (typeof fixture.cases)[number],
  confirm = false,
  affordable = true,
) {
  const s = scenario(spec);
  ui.target = confirm ? s.target : null;
  ui.affordable = affordable;
  return renderToStaticMarkup(
    createElement(TransferPanel, {
      ...s,
      busy: false,
      watch: [],
      onWatch: vi.fn(),
      onInspect: vi.fn(),
      onTransfer: vi.fn(async () => false),
    }),
  );
}

describe("final-squad transfer affordability", () => {
  for (const spec of fixture.cases) {
    it(spec.name, () => {
      const { players, plan, week, outgoing, target } = scenario(spec);
      const original = structuredClone(plan);
      const allowance = transferAllowance(plan, week, outgoing, players);
      const preview = allowance.forTarget(target);
      expect(allowance.bank).toBe(spec.expected.bank);
      expect(allowance.sale).toBe(spec.expected.sale);
      expect(preview.cost).toBe(spec.expected.cost);
      expect(preview.bankAfter).toBe(spec.expected.bankAfter);
      expect(plan).toEqual(original);
      const blocked = spec.expected.bankAfter < 0 || spec.clubBlocked;
      const choose = `aria-label="Choose Player ${target.id}`;
      expect(render(spec).includes(choose)).toBe(!blocked);
      const unfiltered = render(spec, false, false);
      const button = unfiltered.match(new RegExp(`${choose}[^>]*>`))![0];
      expect(button.includes('disabled=""')).toBe(Boolean(blocked));
      if (blocked) expect(button).toMatch(/Over budget|3 players from club/);
      expect(unfiltered).not.toContain('class="transfer-limit"');
      const confirmation = render(spec, true, false);
      expect(confirmation).toContain(
        `<small>Bank after</small><b>£${spec.expected.bankAfter.toFixed(1)}m</b>`,
      );
      expect(confirmation).toContain(
        `class="button primary"${blocked ? ' disabled=""' : ""}`,
      );
      if ("hitsBefore" in spec.expected) {
        expect(allowance.hits).toBe(spec.expected.hitsBefore);
        expect(preview.hits).toBe(spec.expected.hitsAfter);
        expect(confirmation).toContain(`<span>GW${week.gw} hit</span>`);
        expect(confirmation).toContain(
          `>${preview.hits ? `−${preview.hits}` : "0"} pts</b>`,
        );
      }
    });
  }

  it("labels a net cancellation without pretending to buy at market price", () => {
    const html = render(fixture.cases[0], true);
    expect(html).toContain("£6.0m buy cancelled");
    expect(html).toContain("£6.0m sale cancelled");
    expect(html).not.toContain("£6.5m buying");
  });
});

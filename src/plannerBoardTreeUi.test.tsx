import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LineupImageDialog } from "./LineupImageDialog";
import { buildLineupSvg, clampImageText } from "./lineupImage";
import { PlanTree } from "./PlanTree";
import { PlannerBoard } from "./PlannerBoard";
import { TeamOverview } from "./TeamOverview";
import {
  computeSplitBounds,
  nextSplitForKey,
  WorkspaceDivider,
} from "./WorkspaceDivider";
import type { Bootstrap, Plan, Player, Week } from "./types";

type Node = ReactElement<Record<string, any>>;
function walk(tree: ReactNode): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(walk);
  if (!isValidElement(tree)) return [];
  const node = tree as Node;
  return [node, ...walk(node.props.children)];
}

const clubs = ["ARS", "FUL", "BOU", "NEW", "AVL"];
const players: Player[] = Array.from({ length: 16 }, (_, index) => {
  const id = index + 1;
  const position_id = index < 2 ? 1 : index < 7 ? 2 : index < 12 ? 3 : 4;
  return {
    id,
    code: 1000 + id,
    name:
      id === 1
        ? "Raya"
        : id === 15
          ? "Extraordinarily Long Forward Name"
          : `Player ${id}`,
    full_name: `Player ${id}`,
    team: (index % 5) + 1,
    team_code: (index % 5) + 1,
    team_name: clubs[index % clubs.length],
    team_short: clubs[index % clubs.length],
    position_id,
    position: ["", "GKP", "DEF", "MID", "FWD"][position_id],
    price: 5 + (index % 4),
    ownership: 15,
    status: id === 4 ? "d" : "a",
    news: "",
    chance: 100,
    gw: {
      "7": {
        points: id === 15 ? 1.5 : 4 + (index % 5),
        xmins: 90,
        xgoals: 0.3,
        xassists: 0.2,
        xcs: 0.3,
        fixtures: [
          { opponent: "MCI", home: true, difficulty: 4 },
          ...(id === 8 ? [{ opponent: "LIV", home: false, difficulty: 5 }] : []),
        ],
      },
      "8": {
        points: 5,
        xmins: 90,
        xgoals: 0.3,
        xassists: 0.2,
        xcs: 0.3,
        fixtures: [{ opponent: "CHE", home: false, difficulty: 3 }],
      },
    },
  } as unknown as Player;
});

function makeWeek(gw: number, overrides: Partial<Week> = {}): Week {
  return {
    gw,
    squad: Array.from({ length: 15 }, (_, i) => i + 1),
    starters: [1, 3, 4, 5, 8, 9, 10, 11, 13, 14, 15],
    bench: [2, 6, 7, 12],
    captain: 13,
    vice: 8,
    chip: "none",
    bank: 1.4,
    free_transfers: 2,
    next_free_transfers: 3,
    hits: 0,
    points: 52.3,
    net_points: 52.3,
    transfers_in: [],
    transfers_out: [],
    ...overrides,
  };
}

function makePlan(name = "My first plan", weeks = [makeWeek(7), makeWeek(8)]): Plan {
  return {
    id: `plan-${name}`,
    name,
    weeks,
    base_squad: weeks[0].squad,
    base_bank: 1.4,
    free_transfers: 2,
    purchase_prices: {},
    created_at: "2026-11-14T00:00:00Z",
  };
}

const bootstrap = {
  season: "2026-27",
  loaded_at: "2026-11-14T12:00:00Z",
  next_gw: 7,
  gameweeks: [7, 8, 9, 10],
  players,
  teams: [],
  sources: {},
} as unknown as Bootstrap;

describe("PlanTree UI fixes", () => {
  const noop = () => {};

  it("renders bank without ITB, hit badges, zoom % readout, mobile aria-busy, non-inverted toggle and deduplicated scenario sublabels", () => {
    const first = makePlan("Base scenario", [
      makeWeek(7, { hits: 4, net_points: 48.3 }),
      makeWeek(8),
    ]);
    const second = { ...makePlan("Scenario 2"), id: "plan-2" };
    const third = { ...makePlan("Wildcard GW8"), id: "plan-3" };

    const html = renderToStaticMarkup(
      createElement(PlanTree, {
        data: bootstrap,
        plans: [first, second, third],
        active: first,
        gw: 7,
        busy: true,
        optimising: true,
        pitchExpanded: false,
        lineup: null,
        onPlan: noop,
        onWeek: noop,
        onCreate: noop,
        onCopy: noop,
        onDelete: noop,
        onConfigure: noop,
        onHorizon: noop,
        onOptimise: noop,
        onOptimiseSettings: noop,
        onEvaluate: noop,
        onPitchExpanded: noop,
        onStart: noop,
        onReorder: noop,
      }),
    );

    expect(html).not.toContain("ITB");
    expect(html).toContain("£1.4m");
    expect(html).toContain("−4");
    expect(html).toContain('<span class="tree-zoom-value">65%</span>');
    expect(html).toContain("Wildcard GW8");
    // Scenario 1 ("Base scenario") and Scenario 2 ("Scenario 2") match their headings so no duplicate <small> sublabel is emitted.
    expect(html).not.toContain("<small>Scenario 2</small>");
    expect(html).not.toContain("<small>Base scenario</small>");
    expect(html).toContain("<small>Wildcard GW8</small>");
    // Toggle button does not announce an inverted aria-pressed state.
    expect(html).not.toMatch(/tree-pitch-toggle[^>]*aria-pressed/);
    // Mobile optimise button exposes aria-busy when optimising.
    expect(html).toMatch(/aria-busy="true"[^>]*>.*Optimising…/);
    // Singular 1 GW option instead of "1 GWs".
    expect(html).toContain(">1 GW</option>");
    expect(html).not.toContain(">1 GWs</option>");
  });
});

describe("PlannerBoard UI fixes", () => {
  it("uses crisp labels, non-destructive GW total readout, timeline aria-current, singular move label and disabled missing outgoing transfer", () => {
    const onOptimise = vi.fn();
    const w7 = makeWeek(7, {
      transfers_in: [16],
      transfers_out: [],
    });
    const w8 = makeWeek(8, {
      transfers_in: [14, 15],
      transfers_out: [10, 11],
    });
    const plan = makePlan("Main", [w7, w8]);

    const html = renderToStaticMarkup(
      createElement(PlannerBoard, {
        data: bootstrap,
        plan,
        week: w7,
        selected: 8,
        busy: false,
        onWeek: vi.fn(),
        onName: vi.fn(),
        onHorizon: vi.fn(),
        onClone: vi.fn(),
        onSelect: vi.fn(),
        onDetail: vi.fn(),
        onBenchSwap: vi.fn(),
        onSwap: vi.fn(),
        onChip: vi.fn(),
        onBestXI: vi.fn(),
        onReset: vi.fn(),
        onTeam: vi.fn(),
        onOptimise,
        onShare: vi.fn(),
        onLockTransfers: vi.fn(),
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        canUndo: false,
        canRedo: false,
      }),
    );

    expect(html).toContain("Moves / FT");
    expect(html).toContain("<span>Bank</span>");
    expect(html).not.toContain("FTs / Available");
    expect(html).not.toContain("In the bank");
    expect(html).toContain("pick swap target");
    expect(html).toContain("1 move");
    expect(html).toContain("2 moves");
    expect(html).toContain('aria-current="step"');
    // 2 GW total is a non-destructive <div>, not a <button>.
    expect(html).toMatch(/<div[^>]*><span>2 GW total<\/span>/);
    // Missing transfers_out[0] renders a disabled "New squad" button.
    expect(html).toMatch(/<button disabled="">New squad<\/button>/);
    // Singular 1 GW option instead of "1 GWs", and includes 4 GWs option.
    expect(html).toContain(">1 GW</option>");
    expect(html).toContain(">4 GWs</option>");
    expect(html).not.toContain(">1 GWs</option>");
    expect(html).not.toContain(">0 GWs</option>");
  });
});

describe("WorkspaceDivider bounds & keyboard", () => {
  it("clamps split bounds dynamically against minLeft and right-panel 366px minimum", () => {
    expect(computeSplitBounds(1400, 1440)).toEqual([25, 70]);
    expect(computeSplitBounds(1000, 1200)).toEqual([28, 63]);
    expect(computeSplitBounds(800, 900)).toEqual([28, 54]);
  });

  it("handles Home, End, Enter and arrow keys with accessible title", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceDivider, { value: 78, onChange: vi.fn() }),
    );
    expect(html).toContain(
      'title="Drag to resize · Double-click or Enter to reset"',
    );
    expect(html).toContain('aria-valuenow="70"');

    expect(nextSplitForKey("End", 44, [28, 63])).toBe(63);
    expect(nextSplitForKey("Home", 44, [28, 63])).toBe(28);
    expect(nextSplitForKey("Enter", 44, [28, 63])).toBe(50);
    expect(nextSplitForKey("Enter", 44, [31, 48])).toBe(48);
    expect(nextSplitForKey("ArrowLeft", 28, [28, 63])).toBe(28);
    expect(nextSplitForKey("ArrowRight", 62, [28, 63])).toBe(63);
  });
});

describe("TeamOverview UI & accessibility fixes", () => {
  it("always includes active differential captain with visible fixture, toggles squad selection, marks watched stars and labels details accurately", () => {
    const onSelect = vi.fn();
    const w7 = makeWeek(7, { captain: 15 });
    const tree = TeamOverview({
      data: bootstrap,
      week: w7,
      selected: players[14],
      targets: [players[15]],
      watch: [16],
      onWatch: vi.fn(),
      onDetail: vi.fn(),
      onSelect,
      onTransfer: vi.fn(),
      onPlayers: vi.fn(),
      onCaptain: vi.fn(),
    });

    const html = renderToStaticMarkup(tree);
    // Redundant <h2>Lineup</h2> heading removed; vice badge uses slate role-pill-vice; injury triangle shown.
    expect(html).not.toContain("<h2>Lineup</h2>");
    expect(html).toContain('class="role-pill role-pill-vice">V</b>');
    expect(html).toContain("lucide-triangle-alert");
    // Active low-xPts captain (player 15) is included with visible fixture text and aria-pressed="true".
    expect(html).toContain("Extraordinarily Long Forward Name");
    expect(html).toContain("MCI H · C");
    expect(html).toContain('aria-label="Details for Raya"');
    expect(html).not.toContain("Edit Raya stats");

    // Clicking the already-selected squad row toggles selection off with null.
    const buttons = walk(tree).filter(
      (node) => node.type === "button" && node.props.className === "squad-name",
    );
    const activeRowBtn = buttons.find((node) => node.props["aria-pressed"] === true)!;
    activeRowBtn.props.onClick();
    expect(onSelect).toHaveBeenCalledWith(null);

    const otherRowBtn = buttons.find((node) => node.props["aria-pressed"] === false)!;
    otherRowBtn.props.onClick();
    expect(onSelect).toHaveBeenCalledWith(1);

    // Unselected view renders watched star with aria-pressed="true" and currentColor fill.
    const unselectedHtml = renderToStaticMarkup(
      createElement(TeamOverview, {
        data: bootstrap,
        week: w7,
        selected: null,
        targets: [players[15]],
        watch: [16],
        onWatch: vi.fn(),
        onDetail: vi.fn(),
        onSelect: vi.fn(),
        onTransfer: vi.fn(),
        onPlayers: vi.fn(),
        onCaptain: vi.fn(),
      }),
    );
    expect(unselectedHtml).toMatch(/aria-label="Watch Player 16"[^>]*aria-pressed="true"/);
    expect(unselectedHtml).toContain('fill="currentColor"');

    // Non-starter captain id is ignored rather than injected into starter captainOptions.
    const benchCaptainHtml = renderToStaticMarkup(
      createElement(TeamOverview, {
        data: bootstrap,
        week: makeWeek(7, { captain: 6 }),
        selected: null,
        targets: [],
        watch: [],
        onWatch: vi.fn(),
        onDetail: vi.fn(),
        onSelect: vi.fn(),
        onTransfer: vi.fn(),
        onPlayers: vi.fn(),
        onCaptain: vi.fn(),
      }),
    );
    expect(benchCaptainHtml).not.toContain("· C</span>");

    // Busy prop disables captain buttons and shortlist In button.
    const busyHtml = renderToStaticMarkup(
      createElement(TeamOverview, {
        data: bootstrap,
        week: w7,
        selected: players[14],
        targets: [players[15]],
        watch: [],
        busy: true,
        onWatch: vi.fn(),
        onDetail: vi.fn(),
        onSelect: vi.fn(),
        onTransfer: vi.fn(),
        onPlayers: vi.fn(),
        onCaptain: vi.fn(),
      }),
    );
    expect(busyHtml).toMatch(/class="button small primary" disabled="">In<\/button>/);
    expect(busyHtml).toMatch(/class="active" disabled="" aria-pressed="true"/);
  });
});

describe("LineupImage SVG & dialog fixes", () => {
  it("uses GK green kit, readable light/dark club text, uniform 0.84 bench scale, GK/1/2/3 bench labels, active chip name and clamped names", () => {
    const w7 = makeWeek(7, { chip: "benchboost" });
    const longPlan = makePlan(
      "A Very Long Scenario Name That Previously Overflowed Across The Right Header Text",
      [w7],
    );
    const svg = buildLineupSvg(bootstrap, longPlan, w7);

    // GK green shirt fill
    expect(svg).toContain('fill="#a6b675"');
    // Dark kit clubs (BOU, AVL) use white #ffffff text + dark paint-order stroke halo; light kit clubs (FUL, NEW) use dark #132238 text + light stroke halo
    expect(svg).toMatch(
      /fill="#ffffff" stroke="rgba\(11,21,37,\.78\)" stroke-width="2\.4" stroke-linejoin="round" paint-order="stroke"[^>]*>BOU<\/text>/,
    );
    expect(svg).toMatch(/fill="#ffffff"[^>]*>AVL<\/text>/);
    expect(svg).toMatch(
      /fill="#132238" stroke="rgba\(255,255,255,\.72\)" stroke-width="2\.4" stroke-linejoin="round" paint-order="stroke"[^>]*>FUL<\/text>/,
    );
    expect(svg).toMatch(/fill="#132238"[^>]*>NEW<\/text>/);
    // Unmapped club fallback uses high-contrast #cad5e3 primary with dark #132238 text
    const unmappedSvg = buildLineupSvg(
      {
        ...bootstrap,
        players: bootstrap.players.map((p) =>
          p.id === 3 ? { ...p, team_short: "WHU" } : p,
        ),
      },
      longPlan,
      w7,
    );
    expect(unmappedSvg).toContain('fill="#cad5e3"');
    expect(unmappedSvg).toMatch(/fill="#132238"[^>]*>WHU<\/text>/);
    // Uniform bench scale instead of squished scale(1,.82)
    expect(svg).not.toContain("scale(1,.82)");
    expect(svg).toContain("scale(0.84)");
    // Bench labels GK, 1, 2, 3
    expect(svg).toContain(">GK</text>");
    expect(svg).toContain(">1</text>");
    expect(svg).toContain(">2</text>");
    expect(svg).toContain(">3</text>");
    // Active chip name & differentiated captain (#ff8e63) vs vice-captain (#475b73) badges
    expect(svg).toContain("Bench Boost");
    expect(svg).toContain('fill="#ff8e63"');
    expect(svg).toContain('fill="#475b73"');
    // Clamped long names
    expect(clampImageText("Extraordinarily Long Forward Name", 16)).toBe(
      "Extraordinarily…",
    );
    expect(svg).toContain("Extraordinarily…");
    expect(svg).not.toContain("Extraordinarily Long Forward Name");

    // Loading state renders reserved placeholder container
    const dialogHtml = renderToStaticMarkup(
      createElement(LineupImageDialog, {
        data: bootstrap,
        plan: longPlan,
        week: w7,
        onClose: vi.fn(),
      }),
    );
    expect(dialogHtml).toContain('class="lineup-image-loading"');
    expect(dialogHtml).toContain("Creating image…");
  });
});

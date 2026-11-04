import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanTree } from "./PlanTree";
import { fitTreeZoom, treeGameweeks } from "./planTreeLayout";
import type { Bootstrap, Plan } from "./types";

const plan = (start: number, count: number) =>
  ({
    weeks: Array.from({ length: count }, (_, index) => ({ gw: start + index })),
  }) as Plan;

describe("planning tree horizon and fit", () => {
  it("shows all ten selected weeks alongside a five-week branch", () => {
    const short = plan(9, 5),
      long = plan(9, 10);
    expect(treeGameweeks([short, long], long)).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
  });

  it("uses the selected three-week calendar when other branches are longer or start earlier", () => {
    const active = plan(12, 3);
    expect(treeGameweeks([plan(9, 10), active], active)).toEqual([12, 13, 14]);
  });

  it("keeps ten cards and their full total when a later week is selected", () => {
    const active = {
      ...plan(9, 10),
      id: "long",
      name: "Long plan",
      weeks: plan(9, 10).weeks.map((week) => ({
        ...week,
        chip: "none",
        bank: 1,
        free_transfers: 2,
        transfers_in: [],
        net_points: 50,
      })),
    } as Plan;
    const noop = () => {};
    for (const gw of [9, 18]) {
      const markup = renderToStaticMarkup(
        createElement(PlanTree, {
          data: {
            players: [],
            next_gw: 9,
            gameweeks: Array.from({ length: 30 }, (_, i) => i + 9),
          } as unknown as Bootstrap,
          plans: [active],
          active,
          gw,
          busy: false,
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
      expect(markup.match(/class="tree-gw-card/g)).toHaveLength(10);
      expect(markup).toContain('aria-label="Long plan GW18"');
      expect(markup).toContain("<b>500.0</b><small>10 GW xPts</small>");
    }
  });

  it("retains the final season week and uses all branch dates when no plan is selected", () => {
    expect(treeGameweeks([plan(36, 3)], plan(36, 3))).toEqual([36, 37, 38]);
    expect(treeGameweeks([plan(36, 2), plan(37, 2)], null)).toEqual([
      36, 37, 38,
    ]);
    expect(treeGameweeks([], null)).toEqual([]);
  });

  it.each([3, 10, 30, 38])(
    "fits every column of a %i-week tree, including its evaluation",
    (count) => {
      const width = 455 + count * 146;
      for (const viewWidth of [220, 660]) {
        const zoom = fitTreeZoom(viewWidth, 850, width, 518);
        expect(width * zoom + 48).toBeLessThanOrEqual(viewWidth);
        expect(518 * zoom + 180).toBeLessThanOrEqual(850);
        expect(zoom).toBeLessThanOrEqual(0.65);
      }
    },
  );

  it("fits vertically when many branches share a short calendar", () => {
    const zoom = fitTreeZoom(1200, 600, 893, 2000);
    expect(2000 * zoom + 180).toBeLessThanOrEqual(600);
  });
});

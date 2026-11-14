import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AnalysisView } from "./Views";
import type { Bootstrap } from "./types";

vi.mock("./useViewState", () => ({
  useViewState: (key: string, fallback: unknown) => [
    key === "plans.section" ? "benchmarks" : fallback,
    vi.fn(),
  ],
}));

describe("benchmark operation controls", () => {
  it.each([false, true])(
    "capture and single score control reflect busy=%s without duplicate header score button",
    (busy) => {
      const html = renderToStaticMarkup(
        createElement(AnalysisView, {
          data: {
            events: [],
            teams: [],
            gameweeks: [7],
          } as unknown as Bootstrap,
          plans: [],
          active: null,
          evalData: null,
          prospective: null,
          busy,
          selectedGW: 7,
          onSnapshot: vi.fn(),
          onScore: vi.fn(),
          onDetail: vi.fn(),
          onLock: vi.fn(),
          onPlan: vi.fn(),
        }),
      );
      const buttons = [
        ...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g),
      ];
      for (const label of ["Capture forecasts", "Score weeks"]) {
        const button = buttons.find((match) => match[2].includes(label));
        expect(button, label).toBeDefined();
        expect(button![1].includes('disabled=""'), label).toBe(busy);
      }
      expect(
        buttons.some((match) => match[2].includes("Score completed")),
      ).toBe(false);
    },
  );
});

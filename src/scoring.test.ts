import { describe, expect, it } from "vitest";
import { appearance, teamPoints } from "./scoring";
import type { Player } from "./types";

function setup() {
  const positions = [1, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 1, 3, 2, 2];
  const lookup = new Map(
    positions.map((pos, j) => [
      j + 1,
      {
        id: j + 1,
        position_id: pos,
        pplay: 1,
        gw: { "6": { points: 2 } },
      } as unknown as Player,
    ]),
  );
  return {
    starters: Array.from({ length: 11 }, (_, j) => j + 1),
    bench: [12, 13, 14, 15],
    lookup,
  };
}
describe("expected squad scores", () => {
  it("skips a midfielder to maintain three defenders", () => {
    const { starters, bench, lookup } = setup();
    lookup.get(2)!.pplay = 0;
    lookup.get(2)!.gw["6"].points = 0;
    lookup.get(13)!.gw["6"].points = 20;
    lookup.get(14)!.gw["6"].points = 7;
    expect(teamPoints(starters, bench, 5, 6, lookup, 6)).toEqual({
      points: 29,
      autosub_points: 7,
      vice_points: 0,
    });
  });
  it("matches conditional bench points and fallback weighting", () => {
    const { starters, bench, lookup } = setup();
    lookup.get(5)!.pplay = 0.5;
    lookup.get(13)!.pplay = 0.6;
    lookup.get(13)!.gw["6"].points = 4.8;
    lookup.get(14)!.gw["6"].points = 7;
    const result = teamPoints(
      starters,
      bench,
      5,
      6,
      lookup,
      6,
      "triplecaptain",
    );
    expect(result.autosub_points).toBeCloseTo(0.5 * (0.6 * 8 + 0.4 * 7));
    expect(result.vice_points).toBe(2);
  });
  it("recognises any appearance across a double and zero in a blank", () => {
    const p = {
      pplay: 0.8,
      gw: {
        "6": { fixtures: [{ pplay: 0.5 }, { pplay: 0.4 }] },
        "7": { fixtures: [] },
      },
    } as unknown as Player;
    expect(appearance(p, 6)).toBeCloseTo(0.7);
    expect(appearance(p, 7)).toBe(0);
  });
});

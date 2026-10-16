import { describe, expect, it } from "vitest";
import { matchesPlayerQuery, playerSearchTerms } from "./playerSearch";

const players = [
  {
    name: "Wirtz",
    full_name: "Florian Wirtz",
    team_name: "Liverpool",
    team_short: "LIV",
  },
  {
    name: "Gakpo",
    full_name: "Cody Gakpo",
    team_name: "Liverpool",
    team_short: "LIV",
  },
  {
    name: "Haaland",
    full_name: "Erling Haaland",
    team_name: "Manchester City",
    team_short: "MCI",
  },
];
const search = (query: string) =>
  players
    .filter((player) => matchesPlayerQuery(player, playerSearchTerms(query)))
    .map((player) => player.name);

describe("shared player multi-search", () => {
  it("matches comma and pipe alternatives, ignoring case and empty terms", () => {
    expect(playerSearchTerms("  WIRTZ, | , Gakpo || ")).toEqual([
      "wirtz",
      "gakpo",
    ]);
    expect(search("  WIRTZ, | , Gakpo || ")).toEqual(["Wirtz", "Gakpo"]);
    expect(search("wirtz | HAALAND")).toEqual(["Wirtz", "Haaland"]);
  });

  it("preserves plain phrases and searches full names and club names/codes", () => {
    expect(search("florian wirtz")).toEqual(["Wirtz"]);
    expect(search(" Manchester City ")).toEqual(["Haaland"]);
    expect(search("liv")).toEqual(["Wirtz", "Gakpo"]);
    expect(search("Cody | mci")).toEqual(["Gakpo", "Haaland"]);
    expect(search("wirtz gakpo")).toEqual([]);
  });

  it("treats blank or separator-only queries as no search filter", () => {
    for (const query of ["", "  ", ", | ,, || "])
      expect(search(query)).toEqual(["Wirtz", "Gakpo", "Haaland"]);
    expect(search("unmatched")).toEqual([]);
  });
});

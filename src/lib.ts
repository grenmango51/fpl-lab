import type { Player, Week, Chip, Plan } from "./types";
import { teamPoints } from "./scoring";

export const fmt = (n: number, d = 1) =>
  Number.isFinite(n) ? n.toFixed(d) : "—";
export const money = (n: number) => `£${fmt(n)}m`;
export const xp = (p: Player, gw: number) => p.gw[String(gw)]?.points ?? 0;
export const uid = () => crypto.randomUUID();
export const chipNames: Record<Chip, string> = {
  none: "No chip",
  wildcard: "Wildcard",
  freehit: "Free Hit",
  benchboost: "Bench Boost",
  triplecaptain: "Triple Captain",
};
export const clubColors: Record<string, [string, string]> = {
  ARS: ["#e8434b", "#f5f3ef"],
  AVL: ["#882948", "#94c8e5"],
  BOU: ["#d73840", "#222a36"],
  BRE: ["#f6f4ef", "#d94c51"],
  BHA: ["#307dcc", "#f3f7fb"],
  CHE: ["#3270de", "#3270de"],
  COV: ["#73b9e5", "#f3f7fb"],
  CRY: ["#2971ce", "#d84950"],
  EVE: ["#2864d4", "#2864d4"],
  FUL: ["#eff1f5", "#151d2c"],
  HUL: ["#eca536", "#222a36"],
  IPS: ["#4485d5", "#f3f7fb"],
  LEE: ["#f5f4eb", "#f5f4eb"],
  LIV: ["#d74a55", "#d74a55"],
  MCI: ["#80b8e2", "#80b8e2"],
  MUN: ["#df4c4d", "#df4c4d"],
  NEW: ["#f1f3f5", "#273341"],
  NFO: ["#d75051", "#d75051"],
  TOT: ["#f1f2ef", "#f1f2ef"],
  SUN: ["#e35b60", "#f3f3ef"],
};
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    `/api${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!r.ok) {
    const d = await r
      .json()
      .catch(() => ({ detail: `Request failed (${r.status})` }));
    const detail = d.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : detail?.errors
          ? `GW${detail.gw}: ${detail.errors.join(" ")}`
          : Array.isArray(detail)
            ? detail
                .map((e: { msg?: string }) => e.msg ?? "Invalid input.")
                .join(" ")
            : "The request could not be completed. Check your inputs.",
    );
  }
  return r.json() as Promise<T>;
}
export function download(
  name: string,
  text: string,
  type = "application/json",
) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function optimalLineup(
  squad: number[],
  players: Player[],
  gw: number,
  chip: Chip = "none",
) {
  const lookup = new Map(players.map((p) => [p.id, p]));
  const groups = [1, 2, 3, 4].map((pos) =>
    squad
      .filter((id) => lookup.get(id)?.position_id === pos)
      .sort((a, b) => xp(lookup.get(b)!, gw) - xp(lookup.get(a)!, gw)),
  );
  let best: number[] = [];
  let score = -Infinity;
  for (let d = 3; d <= 5; d++)
    for (let m = 2; m <= 5; m++) {
      const f = 10 - d - m;
      if (f < 1 || f > 3) continue;
      const starters = [
        ...groups[0].slice(0, 1),
        ...groups[1].slice(0, d),
        ...groups[2].slice(0, m),
        ...groups[3].slice(0, f),
      ];
      if (starters.length !== 11) continue;
      const value =
        starters.reduce((n, id) => n + xp(lookup.get(id)!, gw), 0) +
        Math.max(...starters.map((id) => xp(lookup.get(id)!, gw)));
      if (value > score) {
        score = value;
        best = starters;
      }
    }
  const ranked = [...best].sort(
    (a, b) => xp(lookup.get(b)!, gw) - xp(lookup.get(a)!, gw),
  );
  const bench = squad
    .filter((id) => !best.includes(id))
    .sort((a, b) =>
      lookup.get(a)!.position_id === 1
        ? -1
        : lookup.get(b)!.position_id === 1
          ? 1
          : xp(lookup.get(b)!, gw) - xp(lookup.get(a)!, gw),
    );
  const captain = ranked[0],
    vice = ranked[1];
  return {
    starters: best,
    bench,
    captain,
    vice,
    ...teamPoints(best, bench, captain, vice, lookup, gw, chip),
  };
}
export function planFromSquad(
  squad: number[],
  players: Player[],
  weeks: number[],
  bank = 0,
  free_transfers = 1,
  name = "My first plan",
): Plan {
  return {
    id: uid(),
    name,
    base_squad: squad,
    base_bank: bank,
    free_transfers,
    purchase_prices: Object.fromEntries(
      squad.map((id) => [String(id), players.find((p) => p.id === id)!.price]),
    ),
    created_at: new Date().toISOString(),
    weeks: weeks.slice(0, 6).map((gw, index) => ({
      gw,
      squad: [...squad],
      ...optimalLineup(squad, players, gw),
      chip: "none",
      bank,
      free_transfers: Math.min(5, free_transfers + index),
      next_free_transfers: Math.min(5, free_transfers + index + 1),
      hits: 0,
      net_points: 0,
      transfers_in: [],
      transfers_out: [],
    })),
  };
}
export function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  const header =
    rows.shift()?.map((h) =>
      h
        .replace(/^\uFEFF/, "")
        .trim()
        .toLowerCase(),
    ) ?? [];
  return rows.map((r) =>
    Object.fromEntries(header.map((h, i) => [h, r[i]?.trim() ?? ""])),
  );
}

export function projectionCSV(text: string, ids: Set<number>, weeks: number[]) {
  const points: Record<string, Record<string, number>> = {};
  const minutes: Record<string, number> = {};
  let count = 0;
  const assign = (id: string, gw: string, raw: string) => {
    const value = Number(raw);
    gw = String(Number(gw));
    if (
      !weeks.includes(Number(gw)) ||
      !Number.isFinite(value) ||
      value < -5 ||
      value > 60
    )
      throw new Error(`Invalid gameweek or expected_points for player ${id}.`);
    if (points[id]?.[gw] !== undefined)
      throw new Error(
        `Duplicate forecast for player ${id}, GW${gw}. Sum double-gameweek fixture points before importing.`,
      );
    points[id] = { ...points[id], [gw]: value };
    count++;
  };
  for (const row of parseCSV(text)) {
    const rawId = row.player_id || row.id || row.fpl_id || row.element;
    const id = String(Number(rawId));
    if (!rawId || !Number.isInteger(Number(rawId)) || !ids.has(Number(rawId)))
      throw new Error(
        `Unknown player_id: ${rawId || "(missing)"}. Use current official FPL player IDs.`,
      );
    if (
      row.conditional_minutes !== undefined &&
      row.conditional_minutes !== ""
    ) {
      const value = Number(row.conditional_minutes);
      if (!Number.isFinite(value) || value < 0 || value > 90)
        throw new Error(`Invalid conditional_minutes for player ${id}.`);
      minutes[id] = value;
    }
    if (row.expected_points !== undefined && row.expected_points !== "")
      assign(id, row.gameweek || row.gw, row.expected_points);
    else
      for (const [key, value] of Object.entries(row)) {
        const match = /^(?:gw)?(\d+)_(?:pts|with_prob|expected_points)$/.exec(
          key,
        );
        if (match && value !== "" && weeks.includes(Number(match[1])))
          assign(id, match[1], value);
      }
  }
  if (!count && !Object.keys(minutes).length)
    throw new Error(
      "CSV needs player_id/gameweek/expected_points, ID with numeric GW_Pts columns, or player_id/conditional_minutes.",
    );
  return { points, minutes, count };
}

import { chipNames, clubColors, fmt } from "./lib";
import type { Bootstrap, Plan, Player, Week } from "./types";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );

export const clampImageText = (value: string, max: number) => {
  const trimmed = value.trim();
  return trimmed.length > max
    ? `${trimmed.slice(0, Math.max(1, max - 1)).trimEnd()}…`
    : trimmed;
};

function isLightHex(color: string): boolean {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const channel = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const luminance =
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.34;
}

export function buildLineupSvg(
  data: Bootstrap,
  plan: Plan,
  week: Week,
): string {
  const lookup = new Map(data.players.map((player) => [player.id, player]));
  const tile = (id: number, x: number, y: number, scale = 1) => {
    const player = lookup.get(id) as Player | undefined;
    if (!player) return "";
    const gk = player.position_id === 1;
    const colors = clubColors[player.team_short] ?? ["#cad5e3", "#9aa9bd"];
    const primary = gk ? "#a6b675" : colors[0];
    const secondary = colors[1];
    const light = gk || isLightHex(primary);
    const textFill = gk ? "#1f2c1b" : light ? "#132238" : "#ffffff";
    const textHalo = light ? "rgba(255,255,255,.72)" : "rgba(11,21,37,.78)";
    const fixtures = clampImageText(
      player.gw[String(week.gw)]?.fixtures
        .map((f) => `${f.opponent} (${f.home ? "H" : "A"})`)
        .join(" + ") || "Blank",
      20,
    );
    const shortName = clampImageText(player.name, 16);
    const transform =
      scale === 1
        ? `translate(${x},${y})`
        : `translate(${x},${y}) scale(${scale})`;
    const stripes =
      !gk && primary !== secondary
        ? `<path d="M-18 -11V54H-12V-11ZM12 -11V54H18V-11Z" fill="${secondary}" opacity=".9"/>`
        : "";
    const roleBadge =
      week.captain === id
        ? `<circle cx="30" cy="-2" r="12" fill="#ff8e63"/><text x="30" y="3" text-anchor="middle" fill="#131b28" font-size="13" font-weight="700">C</text>`
        : week.vice === id
          ? `<circle cx="30" cy="-2" r="12" fill="#475b73" stroke="#9fb4ce66" stroke-width="1"/><text x="30" y="3" text-anchor="middle" fill="#f1f6fc" font-size="13" font-weight="700">V</text>`
          : "";
    return `<g transform="${transform}"><path d="M-23 -15 L-45 0 -34 23 -22 17 -22 54 H22 V17 L34 23 45 0 23 -15 12 -10 Q0 1 -12 -10Z" fill="${primary}" stroke="#e8f0ff44" stroke-width="2"/>${stripes}<text y="27" text-anchor="middle" fill="${textFill}" stroke="${textHalo}" stroke-width="2.4" stroke-linejoin="round" paint-order="stroke" font-size="10" font-weight="700">${escape(player.team_short)}</text>${roleBadge}<rect x="-67" y="61" width="134" height="24" rx="4" fill="#13243a"/><text y="77" text-anchor="middle" font-size="13" fill="#e8eef8">${escape(shortName)}</text><text y="100" text-anchor="middle" font-size="12" fill="#a7bad2">${escape(fixtures)}</text><text y="120" text-anchor="middle" font-size="15" font-weight="700" fill="#ff9d78">${fmt(player.gw[String(week.gw)]?.points ?? 0)} xPts</text></g>`;
  };
  const rows = [1, 2, 3, 4].map((pos) =>
    week.starters.filter((id) => lookup.get(id)?.position_id === pos),
  );
  const chipSummary =
    week.chip !== "none" ? ` · ${chipNames[week.chip]}` : "";
  const clampedPlanName = clampImageText(plan.name, 56);
  const benchSlots = week.bench
    .map((id, index) => {
      const bx = 25 + ((index + 0.5) * 910) / 4;
      const label = index === 0 ? "GK" : String(index);
      return `<g><rect x="${bx - 16}" y="783" width="32" height="16" rx="3" fill="#162840" stroke="#354860"/><text x="${bx}" y="795" text-anchor="middle" font-size="10" font-weight="700" fill="#9fb4ce">${label}</text>${tile(id, bx, 816, 0.84)}</g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1000" viewBox="0 0 960 1000"><rect width="960" height="1000" fill="#030712"/><g font-family="Arial,sans-serif"><text x="35" y="44" font-size="23" font-weight="700" fill="#ff8e63">OPEN FPL</text><text x="925" y="44" text-anchor="end" font-size="18" fill="#dce8f8">GW${week.gw}${escape(chipSummary)} · ${fmt(week.net_points ?? week.points)} net xPts</text><text x="35" y="76" font-size="14" fill="#9aacc6">${escape(clampedPlanName)}</text><rect x="25" y="96" width="910" height="642" rx="10" fill="#0b192b" stroke="#263f5a"/><path d="M25 417H935M330 96V188H630V96M330 738V646H630V738" fill="none" stroke="#243e58" stroke-width="2"/><circle cx="480" cy="417" r="88" fill="none" stroke="#243e58" stroke-width="2"/>${rows.map((ids, row) => ids.map((id, index) => tile(id, 25 + ((index + 0.5) * 910) / ids.length, 128 + row * 152)).join("")).join("")}<rect x="25" y="752" width="910" height="188" rx="8" fill="#101e32"/><text x="40" y="773" font-size="11" fill="#849ebd">BENCH · SUBSTITUTION ORDER</text>${benchSlots}<text x="35" y="970" font-size="12" fill="#829bb9">Current forecasts · ${escape(data.season)} · captain and hits included in team total</text><text x="925" y="970" text-anchor="end" font-size="12" fill="#829bb9">${escape(new Date(data.loaded_at).toLocaleDateString())}</text></g></svg>`;
}

export async function createLineupImage(
  data: Bootstrap,
  plan: Plan,
  week: Week,
) {
  const svg = buildLineupSvg(data, plan, week);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not create lineup image."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 2000;
    canvas.getContext("2d")!.drawImage(img, 0, 0, 1920, 2000);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

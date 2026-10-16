import { clubColors, fmt } from "./lib";
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

export async function createLineupImage(
  data: Bootstrap,
  plan: Plan,
  week: Week,
) {
  const lookup = new Map(data.players.map((player) => [player.id, player]));
  const tile = (id: number, x: number, y: number) => {
    const player = lookup.get(id) as Player,
      colors = clubColors[player.team_short] ?? ["#9aa9bd", "#9aa9bd"];
    const fixtures =
      player.gw[String(week.gw)]?.fixtures
        .map((f) => `${f.opponent} (${f.home ? "H" : "A"})`)
        .join(" + ") || "Blank";
    return `<g transform="translate(${x},${y})"><path d="M-23 -15 L-45 0 -34 23 -22 17 -22 54 H22 V17 L34 23 45 0 23 -15 12 -10 Q0 1 -12 -10Z" fill="${colors[0]}" stroke="#e8f0ff44" stroke-width="2"/><path d="M-9 -10V54H3V-8" fill="${colors[1]}"/><text y="27" text-anchor="middle" fill="#132238" font-size="10" font-weight="700">${escape(player.team_short)}</text>${week.captain === id || week.vice === id ? `<circle cx="30" cy="-2" r="12" fill="#ff8e63"/><text x="30" y="3" text-anchor="middle" fill="#131b28" font-size="13" font-weight="700">${week.captain === id ? "C" : "V"}</text>` : ""}<rect x="-67" y="61" width="134" height="24" rx="4" fill="#13243a"/><text y="77" text-anchor="middle" font-size="13" fill="#e8eef8">${escape(player.name)}</text><text y="100" text-anchor="middle" font-size="12" fill="#a7bad2">${escape(fixtures)}</text><text y="120" text-anchor="middle" font-size="15" font-weight="700" fill="#ff9d78">${fmt(player.gw[String(week.gw)]?.points ?? 0)} xPts</text></g>`;
  };
  const rows = [1, 2, 3, 4].map((pos) =>
    week.starters.filter((id) => lookup.get(id)?.position_id === pos),
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1000" viewBox="0 0 960 1000"><rect width="960" height="1000" fill="#030712"/><g font-family="Arial,sans-serif"><text x="35" y="44" font-size="23" font-weight="700" fill="#ff8e63">OPEN FPL</text><text x="925" y="44" text-anchor="end" font-size="18" fill="#dce8f8">GW${week.gw} · ${fmt(week.net_points ?? week.points)} net xPts</text><text x="35" y="76" font-size="14" fill="#9aacc6">${escape(plan.name)}</text><rect x="25" y="96" width="910" height="650" rx="10" fill="#0b192b" stroke="#263f5a"/><path d="M25 420H935M330 96V190H630V96M330 746V650H630V746" fill="none" stroke="#243e58" stroke-width="2"/><circle cx="480" cy="420" r="90" fill="none" stroke="#243e58" stroke-width="2"/>${rows.map((ids, row) => ids.map((id, index) => tile(id, 25 + ((index + 0.5) * 910) / ids.length, 130 + row * 155)).join("")).join("")}<rect x="25" y="765" width="910" height="165" rx="8" fill="#101e32"/><text x="40" y="785" font-size="11" fill="#849ebd">BENCH · SUBSTITUTION ORDER</text>${week.bench.map((id, index) => `<g transform="translate(0,805) scale(1,.82)">${tile(id, 25 + ((index + 0.5) * 910) / 4, 0)}</g>`).join("")}<text x="35" y="967" font-size="12" fill="#829bb9">Current forecasts · ${escape(data.season)} · captain and hits included in team total</text><text x="925" y="967" text-anchor="end" font-size="12" fill="#829bb9">${escape(new Date(data.loaded_at).toLocaleDateString())}</text></g></svg>`;
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

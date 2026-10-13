import {
  X,
  ChevronRight,
  ArrowUpRight,
  Star,
  Info,
  LoaderCircle,
  AlertTriangle,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Player, Week } from "./types";
import { clubColors, fmt, money, xp } from "./lib";

export function Logo() {
  return (
    <svg viewBox="0 0 40 40" className="brand-mark" aria-hidden="true">
      <path d="M8 26V14l12-7 12 7v12l-12 7z" />
      <path d="M15 22l5-9 5 9-5 5z" className="logo-fill" />
    </svg>
  );
}
export function Badge({
  player,
  code,
  size = 24,
}: {
  player?: Player;
  code?: number;
  size?: number;
}) {
  return (
    <img
      className="club-badge"
      src={`https://resources.premierleague.com/premierleague/badges/70/t${player?.team_code ?? code}.png`}
      width={size}
      height={size}
      alt={player?.team_name ?? "Club badge"}
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
export function Shirt({
  player,
  small = false,
}: {
  player: Player;
  small?: boolean;
}) {
  const colors = clubColors[player.team_short] ?? ["#91a1b7", "#cad5e3"];
  const gk = player.position_id === 1;
  return (
    <svg
      viewBox="0 0 72 72"
      className={`shirt ${small ? "shirt-small" : ""}`}
      aria-hidden="true"
    >
      <path
        d="M23 9l-13 6-8 17 14 6 5-9v33h30V29l5 9 14-6-8-17-13-6-7 6H30z"
        fill={gk ? "#a6b675" : colors[0]}
        stroke="rgba(255,255,255,.23)"
        strokeWidth="1.2"
      />
      <path d="M23 9l7 6h12l7-6-5 1c-1 5-15 5-16 0z" fill="#131e2c" />
      {!gk && colors[0] !== colors[1] && (
        <>
          <path
            d="M24 16h7v45h-7zM41 16h7v45h-7z"
            fill={colors[1]}
            opacity=".9"
          />
          <path
            d="M10 15l10 5-5 13-11-4zM62 15l-10 5 5 13 11-4z"
            fill={colors[1]}
          />
        </>
      )}
      <text
        x="36"
        y="44"
        textAnchor="middle"
        fill={
          gk
            ? "#243120"
            : colors[0] === "#f1f2ef" ||
                colors[0] === "#f5f4eb" ||
                colors[0] === "#eff1f5"
              ? "#24334b"
              : "#fff"
        }
        fontSize="10"
        fontWeight="700"
        fontFamily="inherit"
      >
        {player.team_short}
      </text>
    </svg>
  );
}
export function Pitch({
  week,
  players,
  selected,
  onSelect,
  onDetail,
  onBenchSwap,
}: {
  week: Week;
  players: Player[];
  selected: number | null;
  onSelect: (id: number) => void;
  onDetail: (id: number) => void;
  onBenchSwap: (id: number) => void;
}) {
  const lookup = new Map(players.map((p) => [p.id, p]));
  const tile = (id: number, bench = false) => {
    const p = lookup.get(id);
    if (!p) return null;
    const f = p.gw[String(week.gw)];
    return (
      <div
        className={`player-tile ${selected === id ? "player-selected" : ""} ${bench ? "bench-player" : ""}`}
        key={id}
      >
        <button
          className="player-info"
          aria-label={`Details for ${p.name}`}
          onClick={() => onDetail(id)}
        >
          <Info size={12} />
        </button>
        <button
          className="player-select"
          onClick={() =>
            bench && selected !== null && week.starters.includes(selected)
              ? onBenchSwap(id)
              : onSelect(id)
          }
          aria-label={`Select ${p.name}`}
        >
          <div className="player-shirt">
            <Shirt player={p} />
            {week.captain === id && <span className="captain-badge">C</span>}
            {week.vice === id && <span className="vice-badge">V</span>}
            {p.status !== "a" && (
              <span className="injury-badge">
                <AlertTriangle size={11} />
              </span>
            )}
          </div>
          <span className="pitch-name">{p.name}</span>
          <div className="pitch-meta">
            <span>
              {f?.fixtures
                .map((v) => `${v.opponent} (${v.home ? "H" : "A"})`)
                .join(" + ") || "Blank"}
            </span>
            <b>{fmt(xp(p, week.gw))}</b>
          </div>
        </button>
      </div>
    );
  };
  return (
    <div className="pitch-wrap">
      <div className="pitch">
        <svg
          className="pitch-lines"
          viewBox="0 0 640 540"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect x="20" y="12" width="600" height="516" rx="2" />
          <path d="M20 270H620" />
          <circle cx="320" cy="270" r="68" />
          <circle cx="320" cy="270" r="2" fill="currentColor" />
          <path d="M185 12v96h270V12M250 12v36h140V12M185 528v-96h270v96M250 528v-36h140v36" />
          <path d="M270 108a64 64 0 0 0 100 0M270 432a64 64 0 0 1 100 0" />
        </svg>
        {[1, 2, 3, 4].map((pos) => (
          <div className={`pitch-row row-${pos}`} key={pos}>
            {week.starters
              .filter((id) => lookup.get(id)?.position_id === pos)
              .map((id) => tile(id))}
          </div>
        ))}
        <span className="pitch-watermark">OPEN FPL</span>
      </div>
      <div className="bench">
        <div className="bench-label">
          <span>THE BENCH</span>
          <span>In substitution order</span>
        </div>
        <div className="bench-row">
          {week.bench.map((id, i) => (
            <div key={id}>
              <span className="bench-number">{i === 0 ? "GK" : i}</span>
              {tile(id, true)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Stat({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={`stat ${accent ? "stat-accent" : ""}`}>
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
export function PlayerName({
  player,
  onClick,
}: {
  player: Player;
  onClick?: () => void;
}) {
  return (
    <button className="player-name-cell" onClick={onClick}>
      <Badge player={player} />
      <span>
        <b>
          {player.name}
          {player.status !== "a" && (
            <AlertTriangle size={12} className="orange" />
          )}
        </b>
        <small>
          {player.team_short} <span>·</span> {player.position}
        </small>
      </span>
    </button>
  );
}
export function PlayerRow({
  player,
  gw,
  action,
  onDetail,
  onWatch,
  watched = false,
}: {
  player: Player;
  gw: number;
  action?: () => void;
  onDetail: (id: number) => void;
  onWatch?: (id: number) => void;
  watched?: boolean;
}) {
  return (
    <div className="compact-player">
      <PlayerName player={player} onClick={() => onDetail(player.id)} />
      <span className="compact-price">{money(player.price)}</span>
      <b className="compact-points">{fmt(xp(player, gw))}</b>
      {action ? (
        <button
          className="icon-button transfer-add"
          onClick={action}
          aria-label={`Transfer ${player.name} in`}
        >
          <ArrowUpRight size={17} />
        </button>
      ) : onWatch ? (
        <button
          className={`icon-button ${watched ? "starred" : ""}`}
          onClick={() => onWatch(player.id)}
          aria-label={`${watched ? "Remove" : "Add"} ${player.name} ${watched ? "from" : "to"} watchlist`}
        >
          <Star size={15} fill={watched ? "currentColor" : "none"} />
        </button>
      ) : (
        <ChevronRight size={14} className="muted" />
      )}
    </div>
  );
}
export function Busy({
  text = "Working on your next move…",
}: {
  text?: string;
}) {
  return (
    <div className="busy-line">
      <LoaderCircle size={16} className="spin" />
      {text}
    </div>
  );
}
export function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Logo />
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function LineChart({
  series,
  labels,
  height = 200,
  yLabel = "Expected points",
  colors = ["#ff764d", "#61ba9a", "#7c94cb"],
}: {
  series: { name: string; values: (number | null)[] }[];
  labels: string[];
  height?: number;
  yLabel?: string;
  colors?: string[];
}) {
  const width = 760,
    top = 18,
    left = 46,
    bottom = 35,
    right = 15;
  const plotHeight = height - top - bottom,
    plotWidth = width - left - right;
  const values = series.flatMap((s) => s.values.filter((value): value is number => value !== null && Number.isFinite(value)));
  const max = Math.max(1, ...values) * 1.1;
  const min = Math.min(0, ...values);
  const range = max - min;
  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${yLabel} by gameweek`}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line
              x1={left}
              x2={width - right}
              y1={top + (i * plotHeight) / 4}
              y2={top + (i * plotHeight) / 4}
              stroke="#263141"
              strokeDasharray="3 5"
            />
            <text
              x={left - 9}
              y={top + (i * plotHeight) / 4 + 4}
              fill="#8897ad"
              textAnchor="end"
              fontSize="11"
            >
              {fmt(max - (i * range) / 4)}
            </text>
          </g>
        ))}
        {series.map((s, index) => (
          <g key={s.name}>
          <path
            d={s.values
              .map(
                (v, i) =>
                  v === null || !Number.isFinite(v) ? "" :
                  `${i === 0 || s.values[i - 1] === null || !Number.isFinite(s.values[i - 1]) ? "M" : "L"}${left + (i * plotWidth) / Math.max(1, s.values.length - 1)},${top + ((max - v) / range) * plotHeight}`,
              )
              .join(" ")}
            fill="none"
            stroke={colors[index % colors.length]}
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          {s.values.map((value, i) => value === null || !Number.isFinite(value) ? null : (
            <circle key={i} cx={left + (i * plotWidth) / Math.max(1, s.values.length - 1)} cy={top + ((max - value) / range) * plotHeight} r="2.7" fill={colors[index % colors.length]}>
              <title>{s.name} · {labels[i]}: {fmt(value, 2)}</title>
            </circle>
          ))}
          </g>
        ))}
        {labels.map(
          (label, i) =>
            (labels.length <= 12 || i % 4 === 0 || i === labels.length - 1) && (
              <text
                key={`${i}-${label}`}
                x={left + (i * plotWidth) / Math.max(1, labels.length - 1)}
                y={height - 11}
                fill="#8897ad"
                textAnchor="middle"
                fontSize="11"
              >
                {label}
              </text>
            ),
        )}
        <text x="8" y="11" fill="#8897ad" fontSize="10">
          {yLabel}
        </text>
      </svg>
      <div className="chart-legend">
        {series.map((s, index) => (
          <span key={s.name}>
            <i style={{ background: colors[index % colors.length] }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

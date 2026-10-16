import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  GitBranch,
  RefreshCw,
  Sparkles,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import { ActionMenu, Pitch } from "./components";
import { chipNames, fmt, money } from "./lib";
import { canSwap } from "./plannerInteractions";
import { projectionMetric } from "./ProjectionExplorer";
import type { Bootstrap, Chip, Plan, Player, Week } from "./types";
import "./pitch-interactions.css";

export function PlannerBoard({
  data,
  plan,
  week,
  selected,
  busy,
  onWeek,
  onName,
  onHorizon,
  onClone,
  onSelect,
  onDetail,
  onBenchSwap,
  onSwap,
  onChip,
  onBestXI,
  onReset,
  onTeam,
  onOptimise,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onShare,
  onLockTransfers,
}: {
  data: Bootstrap;
  plan: Plan;
  week: Week;
  selected: number | null;
  busy: boolean;
  onWeek: (gw: number) => void;
  onName: (name: string) => void;
  onHorizon: (horizon: number) => void;
  onClone: () => void;
  onSelect: (id: number | null) => void;
  onDetail: (id: number) => void;
  onBenchSwap: (id: number) => void;
  onSwap: (from: number, to: number) => void;
  onChip: (chip: Chip) => void;
  onBestXI: () => void;
  onReset: () => void;
  onTeam: () => void;
  onOptimise: () => void;
  onShare: () => void;
  onLockTransfers: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const [metric, setMetric] = useState("points");
  const pitchRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected === null) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        !pitchRoot.current?.contains(target) &&
        !target.closest(
          'button, a[href], input, select, textarea, summary, label, [role="button"], [role="menu"], [role="menuitem"], [role="dialog"], [contenteditable="true"], [tabindex]',
        )
      )
        onSelect(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [selected, onSelect]);
  const lookup = new Map(data.players.map((player) => [player.id, player]));
  const chosen: Player | undefined =
    selected === null || !week.squad.includes(selected)
      ? undefined
      : lookup.get(selected);
  const weeks = plan.weeks;
  const total = weeks.reduce(
    (sum, item) => sum + (item.net_points ?? item.points),
    0,
  );
  const firstGW = plan.weeks[0]?.gw ?? data.next_gw;
  const remaining = data.gameweeks.filter((gw) => gw >= firstGW).length;
  const formation = [2, 3, 4]
    .map(
      (pos) =>
        week.starters.filter((id) => lookup.get(id)?.position_id === pos)
          .length,
    )
    .join("–");
  const index = weeks.findIndex((item) => item.gw === week.gw);
  const targets =
    chosen && !busy
      ? data.players
          .filter((player) => canSwap(week, chosen, player, data.players))
          .map((player) => player.id)
      : [];
  const metrics = [
    { id: "points", label: "Points" },
    { id: "minutes", label: "Minutes" },
    { id: "goals", label: "Goals" },
    { id: "assists", label: "Assists" },
    { id: "cs", label: "CS %" },
    { id: "ownership", label: "Owned %" },
    { id: "price", label: "Price" },
  ];
  const playerValue = (player: Player) => {
    if (metric === "price") return money(player.price);
    const value = projectionMetric(
      player,
      week.gw,
      metric as Parameters<typeof projectionMetric>[2],
    );
    return `${fmt(value, metric === "minutes" || metric === "ownership" || metric === "cs" ? 0 : metric === "goals" || metric === "assists" ? 2 : 1)}${metric === "cs" || metric === "ownership" ? "%" : ""}`;
  };
  const usedChip = (chip: Chip) =>
    chip !== "none" &&
    (plan.used_chips?.some(
      (used) => used.chip === chip && used.gw <= 19 === week.gw <= 19,
    ) ||
      weeks.some(
        (row) =>
          row.gw !== week.gw &&
          row.chip === chip &&
          row.gw <= 19 === week.gw <= 19,
      ));
  return (
    <section className="planner-board" aria-label="Team planner">
      <header className="board-plan-header">
        <GitBranch size={14} />
        <input
          aria-label="Plan name"
          value={plan.name}
          onChange={(event) => onName(event.target.value.slice(0, 70))}
        />
        <button
          className="icon-button"
          aria-label="Undo plan change"
          title="Undo · Ctrl+Z"
          disabled={busy || !canUndo}
          onClick={onUndo}
        >
          <Undo2 size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Redo plan change"
          title="Redo · Ctrl+Shift+Z"
          disabled={busy || !canRedo}
          onClick={onRedo}
        >
          <Redo2 size={15} />
        </button>
      </header>
      <div className="board-metrics">
        <button
          onClick={onTeam}
          title={`Edit starting resources for GW${firstGW}`}
        >
          <span>FTs / Available</span>
          <b>
            {week.transfers_in.length}
            <small> / {week.free_transfers}</small>
          </b>
        </button>
        <button onClick={onTeam} title="Edit starting bank">
          <span>In the bank</span>
          <b>{money(week.bank)}</b>
        </button>
        <div title="Captain, expected substitutions and hits included">
          <span>GW{week.gw} xPts</span>
          <b className="orange">{fmt(week.net_points ?? week.points)}</b>
        </div>
        <button onClick={onOptimise} disabled={busy} title="Optimise this plan">
          <span>{weeks.length} GW total</span>
          <b>{fmt(total)}</b>
        </button>
      </div>
      <div className="lineup-control-row">
        <label className="sr-only" htmlFor="pitch-metric">
          Pitch metric
        </label>
        <select
          id="pitch-metric"
          value={metric}
          onChange={(event) => setMetric(event.target.value)}
        >
          {metrics.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Gameweek chip"
          disabled={busy}
          value={week.chip}
          onChange={(event) => onChip(event.target.value as Chip)}
        >
          {(
            [
              "none",
              "wildcard",
              "freehit",
              "benchboost",
              "triplecaptain",
            ] as Chip[]
          ).map((chip) => (
            <option key={chip} value={chip} disabled={Boolean(usedChip(chip))}>
              {chipNames[chip]}
              {usedChip(chip) ? " · used" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="board-week-bar">
        <div>
          <button
            className="icon-button"
            aria-label="Previous gameweek"
            disabled={index <= 0}
            onClick={() => onWeek(weeks[index - 1].gw)}
          >
            <ChevronLeft size={17} />
          </button>
          <select
            aria-label="Lineup gameweek"
            value={week.gw}
            onChange={(event) => onWeek(+event.target.value)}
          >
            {weeks.map((row) => (
              <option key={row.gw} value={row.gw}>
                GW{row.gw}
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            aria-label="Next gameweek"
            disabled={index >= weeks.length - 1}
            onClick={() => onWeek(weeks[index + 1].gw)}
          >
            <ChevronRight size={17} />
          </button>
          <small>{formation}</small>
        </div>
        <ActionMenu
          label={
            <>
              Actions
              <ChevronDown size={13} />
            </>
          }
        >
          <button role="menuitem" onClick={onShare}>
            Download lineup image
          </button>
          <button role="menuitem" disabled={busy} onClick={onLockTransfers}>
            Lock transfers for GW{week.gw}
          </button>
          <button role="menuitem" disabled={busy} onClick={onBestXI}>
            <Sparkles size={14} />
            Best XI & captain
          </button>
          <button role="menuitem" disabled={busy} onClick={onOptimise}>
            <Sparkles size={14} />
            Optimise from GW{week.gw}
          </button>
          <button role="menuitem" onClick={onClone}>
            <Copy size={14} />
            Copy plan
          </button>
          <button role="menuitem" disabled={busy} onClick={onReset}>
            <RefreshCw size={14} />
            Reset this gameweek
          </button>
        </ActionMenu>
      </div>
      <div
        ref={pitchRoot}
        onPointerDown={(event) => {
          if (
            event.target instanceof Element &&
            !event.target.closest(".player-tile,button")
          )
            onSelect(null);
        }}
      >
        <Pitch
          week={week}
          players={data.players}
          selected={selected}
          interactionMode="substitute"
          disabled={busy}
          onSelect={(id) => {
            if (busy) return;
            if (selected === id) onSelect(null);
            else if (
              !chosen ||
              week.starters.includes(chosen.id) === week.starters.includes(id)
            )
              onSelect(id);
          }}
          onDetail={onDetail}
          onBenchSwap={(id) => {
            if (!busy && targets.includes(id)) onBenchSwap(id);
          }}
          value={playerValue}
          swapTargets={targets}
          onSwap={busy ? undefined : onSwap}
        />
      </div>
      {chosen ? (
        <div className="swap-banner" role="status">
          <span>
            <b>{chosen.name}</b> · choose a highlighted player
          </span>
          <button
            className="icon-button"
            onClick={() => onSelect(null)}
            aria-label="Cancel substitution"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      <section className="board-transfers">
        <header>
          <b>
            GW{week.gw} · {fmt(week.net_points ?? week.points)} xPts
          </b>
          <span>
            {week.hits
              ? `−${week.hits} pts`
              : `${week.next_free_transfers} FT next`}
          </span>
        </header>
        {week.transfers_in.length ? (
          week.transfers_in.map((id, i) => (
            <div key={id}>
              <button onClick={() => onDetail(week.transfers_out[i])}>
                {lookup.get(week.transfers_out[i])?.name ?? "New squad"}
              </button>
              <ArrowRight size={13} />
              <button onClick={() => onDetail(id)} className="green">
                {lookup.get(id)?.name}
              </button>
            </div>
          ))
        ) : (
          <small>Roll transfer</small>
        )}
      </section>
      <div className="board-timeline" aria-label="Gameweek timeline">
        {weeks.map((item) => (
          <button
            key={item.gw}
            className={item.gw === week.gw ? "active" : ""}
            onClick={() => onWeek(item.gw)}
          >
            <span>GW{item.gw}</span>
            <b>{fmt(item.net_points ?? item.points)}</b>
            <small>
              {item.chip === "none"
                ? item.transfers_in.length
                  ? `${item.transfers_in.length} moves`
                  : "Roll"
                : {
                    wildcard: "WC",
                    freehit: "FH",
                    benchboost: "BB",
                    triplecaptain: "TC",
                  }[item.chip]}
            </small>
          </button>
        ))}
      </div>
      <div className="board-horizon">
        <span>Plan horizon</span>
        <select
          aria-label="Planner horizon"
          value={weeks.length}
          disabled={busy}
          onChange={(event) => onHorizon(+event.target.value)}
        >
          {[...new Set([weeks.length, 1, 3, 5, 6, 10, 14, 20, remaining])]
            .filter((n) => n <= remaining)
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n} value={n}>
                {n} GWs
              </option>
            ))}
        </select>
      </div>
    </section>
  );
}

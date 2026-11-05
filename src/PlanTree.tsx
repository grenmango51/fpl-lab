import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  Copy,
  GitBranch,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { ActionMenu } from "./components";
import { useViewState } from "./useViewState";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { fmt, money } from "./lib";
import { fitTreeZoom, treeGameweeks } from "./planTreeLayout";
import type { Bootstrap, Plan } from "./types";

export function PlanTree({
  data,
  plans,
  active,
  gw,
  onPlan,
  onWeek,
  onCreate,
  onCopy,
  onDelete,
  onConfigure,
  onHorizon,
  onOptimise,
  onOptimiseSettings,
  onEvaluate,
  pitchExpanded,
  onPitchExpanded,
  lineup,
  onStart,
  onReorder,
  busy,
  optimising = false,
}: {
  data: Bootstrap;
  plans: Plan[];
  active: Plan | null;
  gw: number;
  onPlan: (id: string) => void;
  onWeek: (gw: number) => void;
  onCreate: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onConfigure: () => void;
  onHorizon: (horizon: number) => void;
  onOptimise: () => void;
  onOptimiseSettings: () => void;
  onEvaluate: () => void;
  pitchExpanded: boolean;
  onPitchExpanded: (expanded: boolean) => void;
  lineup: ReactNode;
  onStart: (gw: number) => void;
  onReorder: (direction: number) => void;
  busy: boolean;
  optimising?: boolean;
}) {
  const [zoom, setZoom] = useState(0.65);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [summaries, setSummaries] = useViewState("tree.summaries", true);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mobileWeeksRef = useRef<HTMLDivElement>(null);
  const mobileSelectedWeekRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const lookup = new Map(data.players.map((player) => [player.id, player]));
  const firstGW = active?.weeks[0]?.gw ?? data.next_gw;
  const remaining = data.gameweeks.filter((week) => week >= firstGW).length;
  const visibleGameweeks = treeGameweeks(plans, active);
  const shown = visibleGameweeks.length;
  const activeIndex = Math.max(0, visibleGameweeks.indexOf(gw));
  const visibleWeeks = (plan: Plan) =>
    plan.weeks.filter((week) => visibleGameweeks.includes(week.gw));
  const column = (gameweek: number) => visibleGameweeks.indexOf(gameweek);
  const horizonOptions = [
    ...new Set([
      active?.weeks.length ?? 0,
      1,
      3,
      4,
      5,
      6,
      10,
      14,
      20,
      remaining,
    ]),
  ]
    .sort((a, b) => a - b)
    .filter((n) => n > 0 && (n <= remaining || n === active?.weeks.length));
  const width = 455 + shown * 146;
  const configure = (
    <ActionMenu
      label={
        <>
          <Settings2 size={13} />
          Configure
        </>
      }
    >
      <label className="tree-config-field">
        Start a branch at
        <select
          aria-label="Branch start gameweek"
          disabled={!active || busy}
          value={firstGW}
          onChange={(event) => onStart(+event.target.value)}
        >
          {active?.weeks.map((week) => (
            <option key={week.gw} value={week.gw}>
              GW{week.gw}
            </option>
          ))}
        </select>
      </label>
      <label className="tree-config-toggle">
        <input
          type="checkbox"
          checked={summaries}
          onChange={(event) => setSummaries(event.target.checked)}
        />
        Decision summaries
      </label>
      <button role="menuitem" onClick={onConfigure}>
        Base team & resources
      </button>
      <button role="menuitem" onClick={onOptimiseSettings}>
        Optimisation settings
      </button>
    </ActionMenu>
  );
  const height = 298 + Math.max(0, plans.length - 1) * 220;
  const canvasTop = Math.max(
    112,
    (canvasSize.height - height * zoom - 68) * 0.8,
  );
  function fit() {
    const node = canvasRef.current;
    if (node?.clientWidth) {
      setZoom(fitTreeZoom(node.clientWidth, node.clientHeight, width, height));
      node.scrollLeft = 0;
      node.scrollTop = 0;
    }
  }
  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const resize = () => {
      if (!node.clientWidth || !node.clientHeight) {
        return;
      }
      setCanvasSize({ width: node.clientWidth, height: node.clientHeight });
      setZoom(fitTreeZoom(node.clientWidth, node.clientHeight, width, height));
      node.scrollLeft = 0;
      node.scrollTop = 0;
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    // Scrollbars change the content box when zooming. Only a panel resize
    // should refit the tree; otherwise it would undo the user's zoom.
    observer.observe(node, { box: "border-box" });
    return () => observer.disconnect();
  }, [width, height, pitchExpanded]);
  useEffect(() => {
    const node = canvasRef.current;
    if (!node?.clientWidth || !active) return;
    const planIndex = plans.findIndex((plan) => plan.id === active.id);
    const left = 24 + (262 + activeIndex * 146) * zoom;
    const top = (128 + planIndex * 220 - 63) * zoom + canvasTop;
    const right = left + 120 * zoom;
    const bottom = top + 126 * zoom;
    if (
      left < node.scrollLeft + 10 ||
      right > node.scrollLeft + node.clientWidth - 10
    )
      node.scrollLeft = Math.max(0, left - node.clientWidth * 0.35);
    if (
      top < node.scrollTop + 60 ||
      bottom > node.scrollTop + node.clientHeight - 50
    )
      node.scrollTop = Math.max(0, top - node.clientHeight * 0.3);
  }, [active?.id, gw, zoom, shown, canvasSize, canvasTop]);
  useEffect(() => {
    const timeline = mobileWeeksRef.current;
    const card = mobileSelectedWeekRef.current;
    if (!timeline || !card) return;
    const reveal = () => {
      if (!timeline.clientWidth) return;
      const left = card.offsetLeft;
      if (
        left < timeline.scrollLeft ||
        left + card.offsetWidth > timeline.scrollLeft + timeline.clientWidth
      ) {
        timeline.scrollLeft = Math.max(
          0,
          left - (timeline.clientWidth - card.offsetWidth) / 2,
        );
      }
    };
    reveal();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(reveal);
    observer.observe(timeline);
    return () => observer.disconnect();
  }, [active?.id, gw, active?.weeks.length]);
  return (
    <section
      className={`plan-canvas ${pitchExpanded ? "tree-with-pitch" : ""}`}
      aria-label="Planning tree"
    >
      <header className="tree-toolbar">
        {configure}
        <button
          className="button tree-pitch-toggle"
          disabled={!active}
          aria-pressed={pitchExpanded}
          onClick={() => {
            if (
              !pitchExpanded &&
              active &&
              !active.weeks.some((week) => week.gw === gw)
            )
              onWeek(firstGW);
            onPitchExpanded(!pitchExpanded);
          }}
        >
          {pitchExpanded ? "Tree" : "Pitch"}
        </button>
        {pitchExpanded ? (
          <button
            className="button tree-pitch-optimise"
            disabled={!active || busy}
            aria-busy={optimising}
            onClick={onOptimise}
          >
            <Sparkles size={13} />
            {optimising ? "Optimising…" : "Optimise"}
          </button>
        ) : null}
        <span className="tree-team-label">
          {active?.team_name ?? "My FPL team"}
        </span>
        {active && !pitchExpanded ? (
          <label className="tree-horizon-control">
            <CalendarDays size={15} aria-hidden="true" />
            <select
              aria-label="Tree plan horizon"
              value={active.weeks.length}
              disabled={busy}
              onChange={(event) => onHorizon(+event.target.value)}
            >
              {horizonOptions.map((n) => (
                <option key={n} value={n}>
                  {n} GWs
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>
      <div className="tree-zoom" hidden={pitchExpanded}>
        <input
          aria-label="Planning tree zoom"
          type="range"
          min="2"
          max="150"
          step="1"
          value={Math.round(zoom * 100)}
          onChange={(event) => setZoom(+event.target.value / 100)}
        />
        <button aria-label="Fit planning tree" onClick={fit}>
          Fit
        </button>
      </div>
      <div className="tree-mobile">
        <div className="tree-mobile-header">
          <label>
            Scenario
            <select
              aria-label="Mobile planning scenario"
              value={active?.id ?? ""}
              disabled={!plans.length}
              onChange={(event) => onPlan(event.target.value)}
            >
              {plans.length ? (
                plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))
              ) : (
                <option value="">No plans</option>
              )}
            </select>
          </label>
          {configure}
        </div>
        {active ? (
          <>
            <div
              className="tree-mobile-weeks"
              ref={mobileWeeksRef}
              aria-label="Scenario gameweeks"
            >
              {active.weeks.map((week) => {
                const selected = week.gw === gw;
                return (
                  <button
                    key={week.gw}
                    ref={selected ? mobileSelectedWeekRef : undefined}
                    className={`tree-mobile-gw ${selected ? "active" : ""}`}
                    aria-current={selected ? "step" : undefined}
                    onClick={() => onWeek(week.gw)}
                  >
                    <span>
                      GW{week.gw}
                      {week.chip !== "none" ? (
                        <small>
                          {
                            {
                              wildcard: "WC",
                              freehit: "FH",
                              benchboost: "BB",
                              triplecaptain: "TC",
                            }[week.chip]
                          }
                        </small>
                      ) : null}
                    </span>
                    <strong>
                      {fmt(week.net_points ?? week.points)}
                      <small>xPts</small>
                    </strong>
                    <div>
                      <span>{money(week.bank)}</span>
                      <span>{week.free_transfers} FT</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="tree-mobile-options">
              <label>
                Horizon
                <select
                  aria-label="Mobile plan horizon"
                  value={active.weeks.length}
                  disabled={busy}
                  onChange={(event) => onHorizon(+event.target.value)}
                >
                  {horizonOptions.map((n) => (
                    <option key={n} value={n}>
                      {n} GWs
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={onOptimise} disabled={busy}>
                <Sparkles size={13} />
                {optimising ? "Optimising…" : `Optimise GW${gw}`}
              </button>
            </div>
          </>
        ) : (
          <button
            className="button primary tree-mobile-empty"
            onClick={onConfigure}
          >
            Import team
          </button>
        )}
      </div>
      {pitchExpanded ? (
        <div className="tree-pitch-panel">
          <div className="tree-pitch-navigation">
            <select
              aria-label="Pitch scenario"
              value={active?.id ?? ""}
              onChange={(event) => onPlan(event.target.value)}
            >
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </div>
          {lineup ?? (
            <p className="inline-empty">
              GW{gw} is outside this plan.
              <button className="button small" onClick={() => onWeek(firstGW)}>
                View GW{firstGW}
              </button>
            </p>
          )}
        </div>
      ) : null}
      <div
        hidden={pitchExpanded}
        className="tree-canvas-scroll"
        ref={canvasRef}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button,input,select"))
            return;
          const node = canvasRef.current!;
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: node.scrollLeft,
            top: node.scrollTop,
          };
          node.setPointerCapture(event.pointerId);
          node.classList.add("panning");
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const node = canvasRef.current!;
          node.scrollLeft =
            drag.current.left - (event.clientX - drag.current.x);
          node.scrollTop = drag.current.top - (event.clientY - drag.current.y);
        }}
        onPointerUp={() => {
          drag.current = null;
          canvasRef.current?.classList.remove("panning");
        }}
        onPointerCancel={() => {
          drag.current = null;
          canvasRef.current?.classList.remove("panning");
        }}
      >
        <div
          className="tree-canvas-size"
          style={{
            width: width * zoom,
            height: height * zoom,
            marginTop: canvasTop,
          }}
        >
          <div
            className="tree-canvas-inner"
            style={{ width, height, transform: `scale(${zoom})` }}
          >
            <svg
              className="tree-connections"
              width={width}
              height={height}
              aria-hidden="true"
            >
              {plans.map((plan, index) => {
                const y = 128 + index * 220;
                const weeks = visibleWeeks(plan);
                return (
                  <g key={plan.id}>
                    <path d={`M72 77 V${y} H176`} />
                    <path
                      className={active?.id === plan.id ? "active" : ""}
                      d={`M206 ${y} H${280 + shown * 146}`}
                    />
                    {weeks.map((week) => (
                      <circle
                        key={week.gw}
                        cx={282 + column(week.gw) * 146}
                        cy={y}
                        r="3"
                      />
                    ))}
                  </g>
                );
              })}
            </svg>
            <button
              className="tree-base-team"
              style={{ left: 20, top: 45 }}
              onClick={onConfigure}
            >
              <GitBranch size={14} />
              <span>Base team</span>
              <small>
                {active?.entry_id ? `#${active.entry_id}` : "Local squad"}
              </small>
            </button>
            {plans.map((plan, index) => {
              const y = 128 + index * 220;
              const weeks = visibleWeeks(plan);
              return (
                <div key={plan.id}>
                  <button
                    className={`tree-scenario ${active?.id === plan.id ? "active" : ""}`}
                    style={{ left: 147, top: y - 30 }}
                    onClick={() => onPlan(plan.id)}
                    title={plan.name}
                  >
                    <GitBranch size={17} />
                    <span>
                      {index === 0 ? "Base scenario" : `Scenario ${index + 1}`}
                    </span>
                    <small>{plan.name}</small>
                  </button>
                  {weeks.map((week) => {
                    const chosen = active?.id === plan.id && gw === week.gw;
                    return (
                      <div
                        className="tree-gameweek-node"
                        key={week.gw}
                        style={{
                          left: 262 + column(week.gw) * 146,
                          top: y - 63,
                        }}
                      >
                        {chosen ? (
                          <button
                            className="tree-node-optimise"
                            onClick={onOptimise}
                            disabled={busy}
                            aria-busy={optimising}
                          >
                            <Sparkles size={12} />
                            {optimising ? "Optimising…" : "Optimise"}
                          </button>
                        ) : null}
                        <button
                          className={`tree-gw-card ${chosen ? "active" : ""}`}
                          aria-label={`${plan.name} GW${week.gw}`}
                          aria-current={chosen ? "step" : undefined}
                          onClick={() => {
                            onPlan(plan.id);
                            onWeek(week.gw);
                          }}
                        >
                          <span>GW{week.gw}</span>
                          <strong>
                            {fmt(week.net_points ?? week.points)}
                            <small>xPts</small>
                          </strong>
                          <div>
                            <span>{money(week.bank)} ITB</span>
                            <span>{week.free_transfers} FT</span>
                          </div>
                          <em hidden={!summaries}>
                            {week.chip !== "none"
                              ? {
                                  wildcard: "Wildcard",
                                  freehit: "Free Hit",
                                  benchboost: "Bench Boost",
                                  triplecaptain: "Triple Captain",
                                }[week.chip]
                              : week.transfers_in.length
                                ? week.transfers_in
                                    .map((id) => lookup.get(id)?.name)
                                    .join(", ")
                                : "Roll transfer"}
                          </em>
                        </button>
                        <button
                          className="tree-expand-lineup"
                          aria-label={`Expand ${plan.name} GW${week.gw} lineup`}
                          aria-expanded={pitchExpanded && chosen}
                          onClick={() => {
                            onPlan(plan.id);
                            onWeek(week.gw);
                            onPitchExpanded(true);
                          }}
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>
                    );
                  })}
                  <button
                    className="tree-evaluation"
                    style={{ left: 282 + shown * 146, top: y - 26 }}
                    onClick={() => {
                      onPlan(plan.id);
                      onEvaluate();
                    }}
                  >
                    <span>Evaluation</span>
                    <b>
                      {fmt(
                        weeks.reduce(
                          (sum, week) => sum + (week.net_points ?? week.points),
                          0,
                        ),
                      )}
                    </b>
                    <small>{weeks.length} GW xPts</small>
                  </button>
                </div>
              );
            })}
            {!plans.length ? (
              <div className="tree-empty" style={{ left: 180, top: 150 }}>
                <h3>Start your plan</h3>
                <button className="button primary" onClick={onConfigure}>
                  Import team
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="tree-footer">
        <div>
          <button onClick={onCreate} disabled={!active || busy}>
            <Plus size={14} />
            Create
          </button>
          <button onClick={onCopy} disabled={!active || busy}>
            <Copy size={14} />
            Copy
          </button>
          <button onClick={onDelete} disabled={plans.length <= 1 || busy}>
            <Trash2 size={14} />
            Delete
          </button>
        </div>
        <div className="tree-branch-order" hidden={pitchExpanded}>
          <button
            aria-label="Move branch up"
            disabled={busy || plans[0]?.id === active?.id}
            onClick={() => onReorder(-1)}
          >
            <ArrowUp size={13} />
          </button>
          <button
            aria-label="Move branch down"
            disabled={busy || plans.at(-1)?.id === active?.id}
            onClick={() => onReorder(1)}
          >
            <ArrowDown size={13} />
          </button>
        </div>
      </div>
    </section>
  );
}

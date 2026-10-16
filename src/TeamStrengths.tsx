import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { Bootstrap } from "./types";
import {
  DEFAULT_STRENGTH,
  roundStrength,
  strengthDrag,
  strengthDomain,
  strengthLabels,
  strengthPosition,
  teamStrengthBaseline,
  validStrength,
  withTeamStrength,
} from "./teamStrengthsModel";
import type {
  RateDomain,
  StrengthRates,
  TeamStrengthsSchedule,
} from "./teamStrengthsModel";
import "./team-strengths.css";

export type { TeamStrengthsSchedule } from "./teamStrengthsModel";
export type TeamStrengthsProps = {
  data: Bootstrap;
  strengths: TeamStrengthsSchedule;
  onChange: (next: TeamStrengthsSchedule) => void;
  onTeam?: (id: number) => void;
};

export function TeamStrengths({
  data,
  strengths,
  onChange,
  onTeam,
}: TeamStrengthsProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<{
    code: string;
    attack: string;
    defence: string;
  } | null>(null);
  const [undo, setUndo] = useState<TeamStrengthsSchedule | null>(null);
  const [notice, setNotice] = useState("");
  const svg = useRef<SVGSVGElement>(null);
  const [plotWidth, setPlotWidth] = useState(640);
  useEffect(() => {
    if (!svg.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setPlotWidth(Math.max(280, entry.contentRect.width)),
    );
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const drag = useRef<{
    pointer: number;
    code: string;
    x: number;
    y: number;
    attack: number;
    defence: number;
    next: { attack: number; defence: number };
    moved: boolean;
    rates: StrengthRates;
    domain: RateDomain;
  } | null>(null);
  const teams = useMemo(
    () => [...data.teams].sort((a, b) => a.name.localeCompare(b.name)),
    [data.teams],
  );
  const team = teams.find((row) => row.id === selected) ?? teams[0];
  const code = team ? String(team.code) : "";
  const stored = strengths[code] ?? DEFAULT_STRENGTH;
  const activeDraft = draft?.code === code ? draft : null;
  const attack = activeDraft ? Number(activeDraft.attack) : stored.attack;
  const defence = activeDraft ? Number(activeDraft.defence) : stored.defence;
  const valid =
    (!activeDraft ||
      (activeDraft.attack.trim() !== "" &&
        activeDraft.defence.trim() !== "")) &&
    validStrength(attack) &&
    validStrength(defence);
  const changed =
    valid && (attack !== stored.attack || defence !== stored.defence);
  const previewStrengths = useMemo(() => {
    if (
      !draft ||
      !draft.attack.trim() ||
      !draft.defence.trim() ||
      !validStrength(Number(draft.attack)) ||
      !validStrength(Number(draft.defence))
    )
      return strengths;
    return withTeamStrength(strengths, draft.code, {
      attack: Number(draft.attack),
      defence: Number(draft.defence),
    });
  }, [strengths, draft]);
  const appliedRows = useMemo(
    () =>
      teams.map((row) => ({
        team: row,
        baseline: teamStrengthBaseline(data, row.id, strengths),
      })),
    [data, teams, strengths],
  );
  const previewRows = useMemo(
    () =>
      teams.map((row) => ({
        team: row,
        baseline: teamStrengthBaseline(data, row.id, previewStrengths),
      })),
    [data, teams, previewStrengths],
  );
  const baseline = previewRows.find(
    (row) => row.team.id === team?.id,
  )?.baseline;
  const domain = strengthDomain(
    [...appliedRows, ...previewRows].flatMap(({ baseline: base }) =>
      base.derivedGoals === null || base.derivedConceded === null
        ? []
        : [{ goals: base.derivedGoals, conceded: base.derivedConceded }],
    ),
  );
  const plotDomain = drag.current?.domain ?? domain;
  const matchesQuery = (row: Bootstrap["teams"][number]) =>
    `${row.name} ${row.short_name}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const visibleTeams = teams.filter(matchesQuery);
  const plotRows = previewRows.filter(
    ({ team: row, baseline: base }) =>
      matchesQuery(row) &&
      base.derivedGoals !== null &&
      base.derivedConceded !== null,
  );
  const points = plotRows.map(({ baseline: base }) =>
    strengthPosition(
      { goals: base.derivedGoals!, conceded: base.derivedConceded! },
      plotDomain,
      plotWidth,
    ),
  );
  const labels = strengthLabels(points, plotWidth);
  const unavailable = previewRows.filter(
    ({ team: row, baseline: base }) =>
      matchesQuery(row) &&
      (base.derivedGoals === null || base.derivedConceded === null),
  );

  function select(id: number) {
    setSelected(id);
    setDraft(null);
    setNotice("");
  }
  function commit(next: TeamStrengthsSchedule, message: string) {
    if (JSON.stringify(next) === JSON.stringify(strengths)) {
      setDraft(null);
      return;
    }
    setUndo(structuredClone(strengths));
    setDraft(null);
    setNotice(message);
    onChange(next);
  }
  function apply() {
    if (valid && changed) {
      drag.current = null;
      commit(
        withTeamStrength(strengths, code, { attack, defence }),
        `${team.name} factors applied.`,
      );
    }
  }
  function pointerDown(event: PointerEvent<SVGGElement>, id: number) {
    if (event.button !== 0) return;
    const row = teams.find((item) => item.id === id)!;
    const key = String(row.code);
    const factor = previewStrengths[key] ?? DEFAULT_STRENGTH;
    const base = previewRows.find((item) => item.team.id === id)?.baseline;
    if (base?.derivedGoals == null || base.derivedConceded == null) return;
    setSelected(id);
    setNotice("");
    drag.current = {
      pointer: event.pointerId,
      code: key,
      x: event.clientX,
      y: event.clientY,
      ...factor,
      next: factor,
      moved: false,
      rates: { goals: base.derivedGoals, conceded: base.derivedConceded },
      domain: plotDomain,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<SVGGElement>) {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    const bounds = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (Math.hypot(dx, dy) < 4 && !state.moved) return;
    state.moved = true;
    state.next = strengthDrag(
      state,
      state.rates,
      state.domain,
      dx,
      dy,
      bounds.width,
      bounds.height,
      plotWidth,
    );
    setDraft({
      code: state.code,
      attack: String(state.next.attack),
      defence: String(state.next.defence),
    });
  }
  function pointerUp(event: PointerEvent<SVGGElement>) {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (state.moved)
      commit(
        withTeamStrength(strengths, state.code, state.next),
        "Team factors applied.",
      );
  }
  function keyboard(event: KeyboardEvent<SVGGElement>, id: number) {
    const row = teams.find((item) => item.id === id)!;
    const key = String(row.code);
    if (event.key === "Escape") {
      drag.current = null;
      setDraft(null);
      setNotice("Preview cancelled.");
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (id === team?.id && changed) apply();
      else select(id);
      return;
    }
    if (
      !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
    )
      return;
    event.preventDefault();
    const factor =
      draft?.code === key &&
      validStrength(Number(draft.attack)) &&
      validStrength(Number(draft.defence))
        ? { attack: Number(draft.attack), defence: Number(draft.defence) }
        : (strengths[key] ?? DEFAULT_STRENGTH);
    const step = event.shiftKey ? 0.1 : 0.01;
    setSelected(id);
    setDraft({
      code: key,
      attack: String(
        roundStrength(
          factor.attack +
            (event.key === "ArrowUp"
              ? step
              : event.key === "ArrowDown"
                ? -step
                : 0),
        ),
      ),
      defence: String(
        roundStrength(
          factor.defence +
            (event.key === "ArrowRight"
              ? step
              : event.key === "ArrowLeft"
                ? -step
                : 0),
        ),
      ),
    });
  }

  if (!team)
    return (
      <section className="team-strengths">No current clubs available.</section>
    );
  return (
    <section className="team-strengths" aria-label="Team strength assumptions">
      <div className="ts-heading">
        <div>
          <h3>Team strengths</h3>
          <span className="ts-assumption">Human assumption</span>
        </div>
        <label className="ts-search">
          <span className="sr-only">Search teams</span>
          <input
            type="search"
            placeholder="Search teams"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <p className="ts-caption">
        Expected goals per fixture · remaining schedule
      </p>
      <div className="ts-plot">
        <svg
          ref={svg}
          viewBox={`0 0 ${plotWidth} 300`}
          preserveAspectRatio="none"
          aria-label="Remaining-fixture averages: expected goals upward, expected conceded reversed horizontally; better defence to the right"
        >
          <text x="58" y="16" className="ts-direction">
            Better attack ↑
          </text>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const p = strengthPosition(
              {
                goals: fraction * plotDomain.goals,
                conceded: fraction * plotDomain.conceded,
              },
              plotDomain,
              plotWidth,
            );
            return (
              <g key={fraction} className="ts-grid">
                <line x1={58} y1={p.y} x2={plotWidth - 58} y2={p.y} />
                <line x1={p.x} y1={36} x2={p.x} y2={254} />
                <text x={42} y={p.y + 4} textAnchor="end">
                  {(fraction * plotDomain.goals).toFixed(2)}
                </text>
                <text x={p.x} y={280} textAnchor="middle">
                  {(fraction * plotDomain.conceded).toFixed(2)}
                </text>
              </g>
            );
          })}
          {plotRows.map(({ team: row, baseline: base }, i) => (
            <g
              key={row.id}
              className={`ts-point ${row.id === team.id ? "is-selected" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={row.id === team.id}
              aria-label={`${row.name}: ${base.derivedGoals!.toFixed(2)} expected goals, ${base.derivedConceded!.toFixed(2)} expected conceded per fixture. Arrow keys preview factors by 0.01; Shift by 0.1; Enter applies.`}
              onFocus={() => {
                if (row.id !== team.id) select(row.id);
              }}
              onClick={() => {
                if (row.id !== team.id) select(row.id);
              }}
              onDoubleClick={() => onTeam?.(row.id)}
              onKeyDown={(event) => keyboard(event, row.id)}
              onPointerDown={(event) => pointerDown(event, row.id)}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={() => {
                drag.current = null;
                setDraft(null);
              }}
            >
              <title>
                {row.name}: {base.derivedGoals!.toFixed(2)} goals / fixture;{" "}
                {base.derivedConceded!.toFixed(2)} conceded / fixture
              </title>
              <line
                x1={points[i].x}
                y1={points[i].y}
                x2={labels[i].x}
                y2={labels[i].y}
                className="ts-leader"
              />
              <circle cx={points[i].x} cy={points[i].y} r="3" />
              <rect
                x={labels[i].x - 23}
                y={labels[i].y - 12}
                width="46"
                height="24"
                rx="6"
              />
              <text x={labels[i].x} y={labels[i].y + 4} textAnchor="middle">
                {row.short_name}
              </text>
            </g>
          ))}
        </svg>
        <span className="ts-defence-direction">Better defence →</span>
      </div>
      {!visibleTeams.length && <p className="ts-caption">No matching teams.</p>}
      <p className="ts-caption">
        Drag a label; release to apply. Arrows preview, Enter applies, Esc
        cancels. Arrows change factors by 0.01 (Shift: 0.1).
      </p>
      {!!unavailable.length && (
        <div
          className="ts-unavailable"
          aria-label="Teams without complete rate baselines"
        >
          <span>Rates unavailable:</span>
          {unavailable.map(({ team: row }) => (
            <button
              type="button"
              key={row.id}
              aria-pressed={row.id === team.id}
              onClick={() => select(row.id)}
            >
              {row.short_name}
            </button>
          ))}
        </div>
      )}
      <div
        className="ts-editor"
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            event.target instanceof HTMLInputElement &&
            event.target.type === "number"
          ) {
            event.preventDefault();
            apply();
          }
          if (event.key === "Escape") {
            setDraft(null);
            drag.current = null;
          }
        }}
      >
        <div className="ts-team-heading">
          <label>
            <span className="sr-only">Selected team</span>
            <select
              value={team.id}
              onChange={(event) => select(Number(event.target.value))}
            >
              {teams.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          {onTeam && (
            <button type="button" onClick={() => onTeam(team.id)}>
              View {team.name} →
            </button>
          )}
        </div>
        <div className="ts-source">
          <strong>Source baseline · remaining-fixture averages</strong>
          <span>
            {baseline?.goals === null
              ? "Unavailable"
              : `${baseline?.goals.toFixed(2)} goals / fixture · ${baseline?.conceded?.toFixed(2)} conceded`}
          </span>
          <span>
            {baseline?.derivedGoals == null || baseline.derivedConceded == null
              ? "Derived rates unavailable: incomplete baseline or opponent mapping"
              : `${changed ? "Preview" : "Current scenario"}: ${baseline.derivedGoals.toFixed(2)} goals; ${baseline.derivedConceded.toFixed(2)} conceded / fixture`}
          </span>
          <small>
            {baseline?.fixtures ?? 0} fixtures ·{" "}
            {baseline?.sources.join(" / ") || "Source unavailable"}
          </small>
          {!!baseline?.sourceTimes.length && (
            <small>
              Source / extraction times: {baseline.sourceTimes.join(" / ")}
            </small>
          )}
          {!!baseline?.missingWeeks.length && (
            <small>
              Incomplete: missing GW {baseline.missingWeeks.join(", ")}
            </small>
          )}
        </div>
        <div className="ts-factors">
          {(["attack", "defence"] as const).map((field) => (
            <label key={field}>
              <span>{field === "attack" ? "Attack" : "Defence"} factor</span>
              <div>
                <input
                  type="number"
                  min="0.5"
                  max="2"
                  step="0.01"
                  inputMode="decimal"
                  value={activeDraft?.[field] ?? stored[field]}
                  aria-invalid={!valid}
                  onChange={(event) =>
                    setDraft({
                      code,
                      attack: activeDraft?.attack ?? String(stored.attack),
                      defence: activeDraft?.defence ?? String(stored.defence),
                      [field]: event.target.value,
                    })
                  }
                />
                <span>×</span>
              </div>
            </label>
          ))}
        </div>
        <p className="ts-caption">
          Higher defence reduces goals conceded. Range 0.5–2×.
        </p>
        {!valid && (
          <p className="ts-error" role="alert">
            Enter both factors from 0.5 to 2.
          </p>
        )}
        <div className="ts-actions">
          <button
            type="button"
            className="ts-apply"
            disabled={!valid || !changed}
            onClick={apply}
          >
            Apply
          </button>
          <button
            type="button"
            disabled={!strengths[code] && !activeDraft}
            onClick={() => {
              if (!strengths[code]) setDraft(null);
              else
                commit(
                  withTeamStrength(strengths, code, DEFAULT_STRENGTH),
                  `${team.name} reset to source.`,
                );
            }}
          >
            Reset team
          </button>
          <button
            type="button"
            disabled={!Object.keys(strengths).length && !draft}
            onClick={() => {
              if (!Object.keys(strengths).length) setDraft(null);
              else commit({}, "All team factors reset to source.");
            }}
          >
            Reset all
          </button>
          <button
            type="button"
            disabled={undo === null}
            onClick={() => {
              if (undo) {
                const previous = undo;
                setUndo(null);
                setDraft(null);
                setNotice("Previous team factors restored.");
                onChange(previous);
              }
            }}
          >
            Undo
          </button>
        </div>
        <p className="ts-caption">
          Reset removes manual factors; sourced inputs stay intact.
        </p>
        <span className="ts-notice" role="status">
          {notice || (changed ? "Preview · not applied" : "")}
        </span>
      </div>
    </section>
  );
}

export default TeamStrengths;

import { useEffect, useMemo, useState } from "react";
import type { Bootstrap } from "./types";
import {
  assumedFixtureGW,
  movableFixtures,
  moveFixture,
  normalizeFixtureMoves,
  parseFixtureCatalog,
  resetFixture,
  scheduleWindow,
} from "./fixtureScheduleModel";
import type {
  FixtureCatalog,
  FixtureMoves,
  ScheduleFixture,
} from "./fixtureScheduleModel";
import "./fixture-schedule.css";

export type { FixtureMoves, FixtureCatalog } from "./fixtureScheduleModel";
export type FixtureScheduleProps = {
  data: Bootstrap;
  gw: number;
  moves: FixtureMoves;
  onChange: (moves: FixtureMoves) => void;
  /** Optional original catalog, never reconstructed from adjusted forecasts. */
  catalog?: FixtureCatalog;
};

function officialKickoff(value: string | null): string {
  if (!value) return "Kickoff unassigned";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Kickoff unavailable";
  return (
    date.toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }) + " UTC"
  );
}

export function FixtureSchedule({
  data,
  gw,
  moves,
  onChange,
  catalog: supplied,
}: FixtureScheduleProps) {
  const [loaded, setLoaded] = useState<FixtureCatalog | null>(null);
  const [loading, setLoading] = useState(!supplied);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState("");
  const [showAll, setShowAll] = useState(true);
  const [span, setSpan] = useState(5);
  const [start, setStart] = useState(gw);
  const [undo, setUndo] = useState<FixtureMoves | null>(null);
  const [notice, setNotice] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  useEffect(() => setStart(gw), [gw]);
  useEffect(() => {
    setUndo(null);
    if (supplied) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setLoaded(null);
    fetch("/api/fixture-schedule", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Official fixture schedule is unavailable.");
        const result = parseFixtureCatalog(await response.json());
        if (result.season !== data.season)
          throw new Error("Fixture catalog season differs from forecasts.");
        return result;
      })
      .then((result) => {
        if (!controller.signal.aborted) setLoaded(result);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load fixtures.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [data.season, attempt, supplied]);

  let catalog = supplied ?? loaded;
  let catalogIssue = error;
  if (catalog) {
    try {
      parseFixtureCatalog(catalog);
      if (catalog.season !== data.season || catalog.next_gw !== data.next_gw)
        throw new Error(
          "Fixture catalog differs from current forecasts. Reload the schedule.",
        );
    } catch (reason) {
      catalogIssue =
        reason instanceof Error ? reason.message : "Invalid fixture catalog.";
      catalog = null;
    }
  }
  const teams = useMemo(
    () => new Map(data.teams.map((row) => [row.id, row])),
    [data.teams],
  );
  const fixtures = catalog?.fixtures ?? [];
  const weeks = catalog?.gameweeks ?? [];
  const movable = catalog ? movableFixtures(catalog, [...teams.keys()]) : [];
  const clean = normalizeFixtureMoves(moves, movable, weeks);
  const count = Object.keys(clean).length;
  const invalid = Object.entries(moves).filter(
    ([id, target]) => !Object.hasOwn(clean, id) || clean[id] !== target,
  ).length;
  const unknown = fixtures.filter(
    (row) => !teams.has(row.team_h) || !teams.has(row.team_a),
  ).length;
  const viewStart = weeks.includes(start) ? start : weeks[0];
  const visibleWeeks = scheduleWindow(weeks, viewStart, span);
  const filtered = fixtures.filter((row) => {
    const names = [
      teams.get(row.team_h)?.name,
      teams.get(row.team_h)?.short_name,
      teams.get(row.team_a)?.name,
      teams.get(row.team_a)?.short_name,
    ]
      .join(" ")
      .toLowerCase();
    return (
      (showAll || Object.hasOwn(clean, String(row.id))) &&
      names.includes(query.trim().toLowerCase()) &&
      (!team || String(row.team_h) === team || String(row.team_a) === team)
    );
  });
  const hidden = filtered.filter((row) => {
    const week = assumedFixtureGW(row, clean);
    return week !== null && !visibleWeeks.includes(week);
  }).length;
  const apply = (next: FixtureMoves, message: string) => {
    if (JSON.stringify(next) === JSON.stringify(moves)) return;
    setUndo({ ...moves });
    onChange(next);
    setNotice(message);
  };
  const move = (id: string, target: number | null) => {
    const next = moveFixture(moves, id, target, movable, weeks);
    if (!next) {
      setNotice("This fixture or gameweek cannot be moved.");
      return;
    }
    apply(
      next,
      `Fixture ${id} moved to ${target === null ? "Unset" : `GW${target}`}.`,
    );
  };
  const card = (row: ScheduleFixture) => {
    const id = String(row.id);
    const home = teams.get(row.team_h);
    const away = teams.get(row.team_a);
    const editable = !!home && !!away;
    const label = `${home?.short_name ?? `Unknown club ${row.team_h}`} v ${away?.short_name ?? `Unknown club ${row.team_a}`}`;
    const changed = Object.hasOwn(clean, id);
    const target = assumedFixtureGW(row, clean);
    return (
      <article
        key={id}
        className={`fixture-schedule-card${changed ? " is-changed" : ""}${dragged === id ? " is-dragging" : ""}`}
        draggable={editable}
        onDragStart={(event) => {
          if (!editable) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.setData("application/x-open-fpl-fixture", id);
          event.dataTransfer.effectAllowed = "move";
          setDragged(id);
        }}
        onDragEnd={() => {
          setDragged(null);
          setDropTarget(null);
        }}
      >
        <strong
          title={`${home?.name ?? row.team_h} (home) v ${away?.name ?? row.team_a} (away)`}
        >
          {label}
        </strong>
        <small>
          Official {row.event === null ? "Unset" : `GW${row.event}`} · #{id}
        </small>
        <small>{officialKickoff(row.kickoff_time)}</small>
        <span className="fixture-schedule-assumption">
          Assumed {target === null ? "Unset" : `GW${target}`}
          {changed ? " · moved" : ""}
        </span>
        {!editable && (
          <small role="status">Unknown club; move unavailable.</small>
        )}
        <label>
          Move to GW
          <select
            aria-label={`Move ${label}, fixture ${id}, to gameweek`}
            disabled={!editable}
            value={target === null ? "unset" : String(target)}
            onChange={(event) => {
              const raw = event.target.value;
              // Native options are controlled; do not coerce arbitrary numeric text.
              const value =
                raw === "unset"
                  ? null
                  : weeks.find((week) => String(week) === raw);
              if (value !== undefined) move(id, value);
            }}
          >
            <option value="unset">Unset</option>
            {weeks.map((week) => (
              <option key={week} value={week}>
                GW{week}
              </option>
            ))}
          </select>
        </label>
        {changed && (
          <button
            type="button"
            onClick={() =>
              apply(
                resetFixture(moves, id, movable, weeks),
                `Fixture ${id} reset to official schedule.`,
              )
            }
          >
            Reset fixture
          </button>
        )}
      </article>
    );
  };

  return (
    <section
      className="fixture-schedule"
      aria-label="Hypothetical fixture schedule"
    >
      <header className="fixture-schedule-heading">
        <div>
          <h3>Fixture schedule</h3>
          <p>Hypothetical schedule; official dates unchanged</p>
          <small>Global configuration · all plans</small>
        </div>
        <div className="fixture-schedule-actions">
          <span>
            {count} {count === 1 ? "move" : "moves"}
          </span>
          <button
            type="button"
            disabled={!catalog || Object.keys(moves).length === 0}
            onClick={() => apply({}, "All fixture moves reset.")}
          >
            Reset all
          </button>
          <button
            type="button"
            disabled={!catalog || !undo}
            onClick={() => {
              if (!undo) return;
              onChange(normalizeFixtureMoves(undo, movable, weeks));
              setUndo(null);
              setNotice("Previous fixture schedule restored.");
            }}
          >
            Undo
          </button>
        </div>
      </header>
      {loading && !supplied && <p role="status">Loading official fixtures…</p>}
      {catalogIssue && (
        <div role="alert" className="fixture-schedule-issue">
          {catalogIssue}{" "}
          {!supplied && (
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry
            </button>
          )}
        </div>
      )}
      {catalog && (
        <>
          <div className="fixture-schedule-controls">
            <label>
              Search teams
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Team name"
              />
            </label>
            <label>
              Club
              <select
                value={team}
                onChange={(event) => setTeam(event.target.value)}
              >
                <option value="">All clubs</option>
                {data.teams.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From GW
              <select
                value={viewStart ?? ""}
                disabled={span === 38}
                onChange={(event) => setStart(Number(event.target.value))}
              >
                {weeks.map((week) => (
                  <option key={week} value={week}>
                    {week}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Window
              <select
                value={span}
                onChange={(event) => setSpan(Number(event.target.value))}
              >
                <option value={5}>5 GWs</option>
                <option value={10}>10 GWs</option>
                <option value={38}>All remaining GWs</option>
              </select>
            </label>
            <label className="fixture-schedule-check">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => setShowAll(event.target.checked)}
              />
              Show all fixtures
            </label>
          </div>
          <p className="fixture-schedule-hint">
            Drag a card or use Move to GW. Unset removes it from forecast weeks.
          </p>
          {(invalid > 0 || unknown > 0) && (
            <p role="status" className="fixture-schedule-issue">
              {invalid > 0
                ? `${invalid} invalid or redundant saved moves ignored. `
                : ""}
              {unknown > 0
                ? `${unknown} fixtures have unknown clubs; moves disabled.`
                : ""}
            </p>
          )}
          {hidden > 0 && (
            <p className="fixture-schedule-hint">
              {hidden} matching fixtures outside this window. Choose All
              remaining GWs to view.
            </p>
          )}
          <div
            className="fixture-schedule-scroll"
            tabIndex={0}
            aria-label="Gameweek columns; scroll horizontally"
          >
            <div className="fixture-schedule-columns">
              {[null, ...visibleWeeks].map((week) => {
                const key = week === null ? "unset" : String(week);
                const rows = filtered.filter(
                  (row) => assumedFixtureGW(row, clean) === week,
                );
                return (
                  <section
                    key={key}
                    className={`fixture-schedule-column${dropTarget === key ? " is-drop-target" : ""}`}
                    aria-label={
                      week === null ? "Unset fixtures" : `GW${week} fixtures`
                    }
                    onDragOver={(event) => {
                      if (dragged) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDropTarget(key);
                      }
                    }}
                    onDragLeave={(event) => {
                      if (
                        !event.currentTarget.contains(
                          event.relatedTarget as Node | null,
                        )
                      )
                        setDropTarget(null);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const id = event.dataTransfer.getData(
                        "application/x-open-fpl-fixture",
                      );
                      if (dragged === id) move(id, week);
                      setDragged(null);
                      setDropTarget(null);
                    }}
                  >
                    <h4>
                      {week === null ? "Unset" : `GW${week}`}{" "}
                      <span>{rows.length}</span>
                    </h4>
                    {rows.map(card)}
                    {!rows.length && (
                      <p className="fixture-schedule-empty">
                        {showAll ? "No matching fixtures" : "No moved fixtures"}
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
          <footer className="fixture-schedule-source">
            Official FPL · {catalog.season} · {fixtures.length} remaining
            fixtures
            {Object.entries(catalog.sources ?? {}).map(([key, source]) => (
              <span key={key}>
                {key === "fpl_fixtures" ? "Fixtures" : "Bootstrap"}:{" "}
                {source.status ?? "Status unavailable"} · extracted{" "}
                {source.fetched_at
                  ? officialKickoff(source.fetched_at)
                  : "time unavailable"}
              </span>
            ))}
          </footer>
        </>
      )}
      <p className="fixture-schedule-notice" role="status" aria-live="polite">
        {notice}
      </p>
    </section>
  );
}

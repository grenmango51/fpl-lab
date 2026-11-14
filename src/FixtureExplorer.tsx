import { useEffect, useRef, useState } from "react";
import { ArrowDownUp, ChevronDown, RotateCcw } from "lucide-react";
import { Badge } from "./components";
import { FixtureDetail } from "./FixtureDetail";
import { TabStrip } from "./TabStrip";
import { useViewState } from "./useViewState";
import { fmt } from "./lib";
import {
  fixtureMetricValue,
  fixtureRows,
  fixtureSelectedWeeks,
  fixtureRangeWeeks,
  fixtureSourceWeeks,
  fixtureSortForWeeks,
  fixtureTotal,
  type FixtureMetric,
  type FixtureSort,
} from "./fixtureData";
import type { Bootstrap } from "./types";
import "./fixture-explorer.css";

export type TrendPoint = {
  week: number;
  value: number | null;
  blank: boolean;
};

export function fixtureTrendScale(
  values: readonly number[],
  metric: FixtureMetric,
): { low: number; high: number; baseline: number } {
  if (metric === "difficulty") {
    return {
      low: Math.min(1, ...values),
      high: Math.max(5, ...values),
      baseline: 3,
    };
  }
  const minSpan = metric === "cs" ? 0.5 : 1;
  const low = Math.min(0, ...values);
  return {
    low,
    high: Math.max(0, low + minSpan, ...values),
    baseline: 0,
  };
}

export function formatTrendPoint(
  point: TrendPoint,
  metric: FixtureMetric,
): string {
  if (point.blank) return "Blank";
  if (point.value === null || !Number.isFinite(point.value))
    return "unavailable";
  if (metric === "cs") return `${fmt(point.value * 100, 0)}%`;
  if (metric === "difficulty")
    return `FDR ${fmt(point.value, Number.isInteger(point.value) ? 0 : 1)}`;
  if (metric === "gd")
    return `${point.value > 0 ? "+" : ""}${fmt(point.value, 2)}`;
  return fmt(point.value, 2);
}

export function FixtureExplorer({
  data,
  gw,
  onDetail,
}: {
  data: Bootstrap;
  gw: number;
  onDetail: (id: number, gw?: number) => void;
}) {
  const [metric, setMetric] = useViewState<FixtureMetric>(
    "fixtures.metric",
    "goals",
  );
  const [horizon, setHorizon] = useViewState("fixtures.horizon", 10);
  const [selectedWeeks, setSelectedWeeks] = useViewState<number[] | null>(
    "fixtures.selectedWeeks",
    null,
  );
  const [selectedTeams, setSelectedTeams] = useViewState<number[] | null>(
    "fixtures.selectedTeams",
    null,
  );
  const [savedSort, setSort] = useViewState<FixtureSort>(
    "fixtures.columnSort",
    { column: "club", direction: "ascending" },
  );
  const [openFilter, setOpenFilter] = useState<"teams" | "weeks" | null>(null);
  const [selected, setSelected] = useState<{ team: number; gw: number } | null>(
    null,
  );
  const teamsFilterRef = useRef<HTMLDetailsElement>(null);
  const weeksFilterRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!openFilter) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        !teamsFilterRef.current?.contains(target) &&
        !weeksFilterRef.current?.contains(target)
      ) {
        setOpenFilter(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const activeDetails =
        openFilter === "teams"
          ? teamsFilterRef.current
          : weeksFilterRef.current;
      event.stopPropagation?.();
      setOpenFilter(null);
      activeDetails?.querySelector?.<HTMLElement>("summary")?.focus?.();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openFilter]);
  const available = fixtureSourceWeeks(data.gameweeks);
  const remaining = available.filter((week) => week >= gw);
  const effectiveHorizon = Math.min(horizon, remaining.length);
  const weeks = fixtureSelectedWeeks(
    available,
    selectedWeeks,
    gw,
    effectiveHorizon,
  );
  const sort = fixtureSortForWeeks(savedSort, weeks);
  const rows = fixtureRows(data, weeks, metric, selectedTeams, sort);
  const trends = new Map<number, TrendPoint[]>(
    rows.map((row) => [
      row.team.id,
      weeks.map((week) => {
        const forecast = row.forecasts[String(week)];
        const blank = Boolean(forecast && forecast.fixtures.length === 0);
        return {
          week,
          value: fixtureTotal([forecast], metric),
          blank,
        };
      }),
    ]),
  );
  const trendValues = [...trends.values()]
    .flat()
    .map((point) => point.value)
    .filter(
      (value): value is number => value !== null && Number.isFinite(value),
    );
  const {
    low: trendLow,
    high: trendHigh,
    baseline: trendBaseline,
  } = fixtureTrendScale(trendValues, metric);
  const chosenTeams = data.teams.filter(
    (team) => selectedTeams === null || selectedTeams.includes(team.id),
  );
  const allTeams =
    selectedTeams === null || chosenTeams.length === data.teams.length;
  const rangeFrom = weeks[0] ?? available[0];
  const rangeThrough = weeks.at(-1) ?? available.at(-1);
  function setRangeFrom(from: number) {
    setSelectedWeeks(
      fixtureRangeWeeks(available, from, Math.max(from, rangeThrough ?? from)),
    );
  }
  function setRangeThrough(through: number) {
    setSelectedWeeks(
      fixtureRangeWeeks(
        available,
        Math.min(rangeFrom ?? through, through),
        through,
      ),
    );
  }
  function toggleWeek(week: number) {
    setSelectedWeeks(
      weeks.includes(week)
        ? weeks.filter((value) => value !== week)
        : [...weeks, week],
    );
  }
  function toggleTeam(team: number) {
    const current = chosenTeams.map((club) => club.id);
    setSelectedTeams(
      current.includes(team)
        ? current.filter((value) => value !== team)
        : [...current, team],
    );
  }
  function sortBy(column: FixtureSort["column"]) {
    setSort({
      column,
      direction:
        sort.column === column
          ? sort.direction === "ascending"
            ? "descending"
            : "ascending"
          : column === "club" || metric === "difficulty"
            ? "ascending"
            : "descending",
    });
  }
  const totalLabel =
    metric === "difficulty"
      ? "Avg FDR"
      : metric === "cs"
        ? "Total CS"
        : metric === "gd"
          ? "Total GD"
          : "Total goals";
  const sortButton = (column: FixtureSort["column"], label: string) => (
    <button
      type="button"
      className="fixture-sort"
      onClick={() => sortBy(column)}
      title={`Sort by ${label}`}
    >
      {label}
      {sort.column === column ? (
        <ChevronDown
          size={12}
          className={sort.direction === "ascending" ? "rotate" : ""}
        />
      ) : (
        <ArrowDownUp size={11} />
      )}
    </button>
  );
  const weekLabel = weeks.length
    ? weeks.map((week) => `GW${week}`).join(", ")
    : "No gameweeks";
  return (
    <div className="fixture-explorer">
      {(data.fixture_scenario || data.team_strength_scenario) && (
        <div className="fixture-scenario-tags">
          {data.fixture_scenario && (
            <span className="subtle-tag">Custom schedule active</span>
          )}
          {data.team_strength_scenario && (
            <span className="subtle-tag">Team strengths active</span>
          )}
        </div>
      )}
      <div className="view-heading compact-view-heading">
        <h2>Fixtures</h2>
        <TabStrip
          label="Fixture metric"
          value={metric}
          onChange={setMetric}
          items={[
            { id: "difficulty", label: "Difficulty" },
            { id: "goals", label: "Attack (G)" },
            { id: "cs", label: "Defence (CS)" },
            { id: "gd", label: "Overall (GD)" },
          ]}
        />
      </div>
      <div className="fixture-controls">
        <label>
          Horizon
          <select
            aria-label="Fixture horizon"
            value={effectiveHorizon}
            disabled={selectedWeeks !== null}
            title={
              selectedWeeks !== null
                ? "Reset Filter GWs to use horizon"
                : undefined
            }
            onChange={(event) => setHorizon(Number(event.target.value))}
          >
            {[
              ...new Set([
                1,
                3,
                5,
                6,
                10,
                14,
                20,
                28,
                effectiveHorizon,
                remaining.length,
              ]),
            ]
              .filter((value) => value > 0 && value <= remaining.length)
              .sort((a, b) => a - b)
              .map((value) => (
                <option key={value} value={value}>
                  {value} GWs
                </option>
              ))}
          </select>
        </label>
        <details
          ref={teamsFilterRef}
          className={`fixture-filter${!allTeams ? " is-active" : ""}`}
          open={openFilter === "teams"}
          onKeyDown={(event) => {
            if (event.key === "Escape" && openFilter === "teams") {
              event.preventDefault();
              event.stopPropagation();
              setOpenFilter(null);
              event.currentTarget
                .querySelector<HTMLElement>("summary")
                ?.focus();
            }
          }}
        >
          <summary
            onClick={(event) => {
              event.preventDefault();
              setOpenFilter((current) =>
                current === "teams" ? null : "teams",
              );
            }}
          >
            <span>
              Teams <b>({allTeams ? "All" : chosenTeams.length})</b>
            </span>
          </summary>
          <div className="fixture-filter-body">
            <div className="button-row">
              <button type="button" onClick={() => setSelectedTeams(null)}>
                Select all
              </button>
              <button type="button" onClick={() => setSelectedTeams([])}>
                Clear
              </button>
            </div>
            <div className="fixture-team-choices">
              {data.teams.map((team) => (
                <label key={team.id}>
                  <input
                    type="checkbox"
                    checked={chosenTeams.some((club) => club.id === team.id)}
                    onChange={() => toggleTeam(team.id)}
                  />
                  {team.name}
                </label>
              ))}
            </div>
          </div>
        </details>
        <details
          ref={weeksFilterRef}
          className={`fixture-filter fixture-week-filter${selectedWeeks !== null ? " is-active" : ""}`}
          open={openFilter === "weeks"}
          onKeyDown={(event) => {
            if (event.key === "Escape" && openFilter === "weeks") {
              event.preventDefault();
              event.stopPropagation();
              setOpenFilter(null);
              event.currentTarget
                .querySelector<HTMLElement>("summary")
                ?.focus();
            }
          }}
        >
          <summary
            onClick={(event) => {
              event.preventDefault();
              setOpenFilter((current) =>
                current === "weeks" ? null : "weeks",
              );
            }}
          >
            <span>
              Filter GWs <b>({weeks.length})</b>
            </span>
          </summary>
          <div className="fixture-filter-body">
            <div className="fixture-range">
              <label>
                From
                <select
                  aria-label="Fixture range from"
                  value={rangeFrom}
                  onChange={(event) => setRangeFrom(Number(event.target.value))}
                >
                  {available.map((week) => (
                    <option key={week} value={week}>
                      GW{week}
                    </option>
                  ))}
                </select>
                <input
                  type="range"
                  aria-label="Fixture range start"
                  min={available[0]}
                  max={available.at(-1)}
                  step={1}
                  value={rangeFrom}
                  onChange={(event) => setRangeFrom(Number(event.target.value))}
                />
              </label>
              <label>
                Through
                <select
                  aria-label="Fixture range through"
                  value={rangeThrough}
                  onChange={(event) =>
                    setRangeThrough(Number(event.target.value))
                  }
                >
                  {available.map((week) => (
                    <option key={week} value={week}>
                      GW{week}
                    </option>
                  ))}
                </select>
                <input
                  type="range"
                  aria-label="Fixture range end"
                  min={available[0]}
                  max={available.at(-1)}
                  step={1}
                  value={rangeThrough}
                  onChange={(event) =>
                    setRangeThrough(Number(event.target.value))
                  }
                />
              </label>
            </div>
            <div className="button-row">
              <button type="button" onClick={() => setSelectedWeeks(available)}>
                All GWs
              </button>
              <button type="button" onClick={() => setSelectedWeeks([])}>
                Clear
              </button>
              <button type="button" onClick={() => setSelectedWeeks(null)}>
                <RotateCcw size={12} />
                Reset
              </button>
            </div>
            <p className="fixture-selection-caption">
              Untick a Free Hit GW to exclude it.
            </p>
            <div className="fixture-week-choices">
              {available.map((week) => (
                <label key={week}>
                  <input
                    type="checkbox"
                    aria-label={`Include GW${week}`}
                    checked={weeks.includes(week)}
                    onChange={() => toggleWeek(week)}
                  />
                  GW{week}
                </label>
              ))}
            </div>
          </div>
        </details>
        <button
          type="button"
          className="button small"
          onClick={() =>
            setSort({
              column: "total",
              direction: metric === "difficulty" ? "ascending" : "descending",
            })
          }
        >
          Best{" "}
          {metric === "difficulty"
            ? "run"
            : metric === "cs"
              ? "defence"
              : metric === "goals"
                ? "attack"
                : "overall"}
        </button>
        {(selectedWeeks !== null || selectedTeams !== null) && (
          <button
            type="button"
            className="button small"
            onClick={() => {
              setSelectedTeams(null);
              setSelectedWeeks(null);
              setOpenFilter(null);
            }}
          >
            Reset filters
          </button>
        )}
      </div>
      <p className="fixture-selection-caption" title={weekLabel}>
        {chosenTeams.length} clubs · {weeks.length} GWs
        {selectedWeeks !== null ? " · Custom GWs" : ""}
      </p>
      {weeks.length && rows.length ? (
        <div className="table-container fixture-scroll">
          <table className="data-table fixture-table">
            <thead>
              <tr>
                <th
                  aria-sort={sort.column === "club" ? sort.direction : "none"}
                >
                  {sortButton("club", "Club")}
                </th>
                <th
                  title={
                    metric === "difficulty"
                      ? "Selected GWs; shared scale (higher = easier)"
                      : "Selected GWs; shared scale across displayed clubs"
                  }
                >
                  Trend
                </th>
                {weeks.map((week) => (
                  <th
                    key={week}
                    aria-sort={sort.column === week ? sort.direction : "none"}
                  >
                    {sortButton(week, `GW${week}`)}
                  </th>
                ))}
                <th
                  aria-sort={sort.column === "total" ? sort.direction : "none"}
                >
                  {sortButton("total", totalLabel)}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.team.id}>
                  <td>
                    <div className="club-cell" title={row.team.name}>
                      <Badge code={row.team.code} />
                      <b className="club-name-full">{row.team.name}</b>
                      <b className="club-name-short">{row.team.short_name}</b>
                    </div>
                  </td>
                  <td className="fixture-trend-cell">
                    <FixtureTrend
                      club={row.team.name}
                      metric={metric}
                      points={trends.get(row.team.id)!}
                      low={trendLow}
                      high={trendHigh}
                      baseline={trendBaseline}
                    />
                  </td>
                  {weeks.map((week) => {
                    const forecast = row.forecasts[String(week)];
                    return (
                      <td key={week}>
                        {forecast ? (
                          forecast.fixtures.length ? (
                            forecast.fixtures.map((fixture, index) => {
                              const value = fixtureMetricValue(
                                forecast,
                                index,
                                metric,
                              );
                              const metricText =
                                metric === "difficulty"
                                  ? `FDR ${value}`
                                  : metric === "cs"
                                    ? `${fmt(value * 100, 0)}% CS`
                                    : metric === "gd"
                                      ? `${value > 0 ? "+" : ""}${fmt(value, 2)} GD`
                                      : `${fmt(value, 2)} xG`;
                              const venue = fixture.home ? "H" : "A";
                              return (
                                <button
                                  type="button"
                                  key={fixture.id}
                                  className={`fixture-chip fdr-${fixture.difficulty}`}
                                  aria-haspopup="dialog"
                                  aria-label={`${row.team.name} GW${week}: ${fixture.opponent} (${venue}), ${metricText}`}
                                  onClick={() =>
                                    setSelected({ team: row.team.id, gw: week })
                                  }
                                  title={`${row.team.name} · GW${week} v ${fixture.opponent} (${venue}) · ${fixture.source} · ${fixture.source_at ?? "Provider time unknown"}`}
                                >
                                  <b>
                                    {fixture.opponent} <span>({venue})</span>
                                  </b>
                                  <small>{metricText}</small>
                                </button>
                              );
                            })
                          ) : (
                            <span className="muted">Blank</span>
                          )
                        ) : (
                          <span className="muted">Unavailable</span>
                        )}
                      </td>
                    );
                  })}
                  <td
                    className="numeric fixture-total"
                    title={
                      metric === "difficulty"
                        ? "Mean FDR per fixture"
                        : metric === "cs"
                          ? "Expected clean sheets across selected fixtures"
                          : totalLabel
                    }
                  >
                    {row.total === null
                      ? "—"
                      : fmt(row.total, metric === "cs" ? 2 : 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="inline-empty">Select at least one club and gameweek.</p>
      )}
      <details className="compact-details">
        <summary>Sources & totals</summary>
        <p>
          Official FDR. Goals and CS use FPL Joe, Elevenify or labelled
          fallback. GD = goals for − against; Total CS = expected clean sheets;
          Avg FDR = mean per fixture. Doubles sum both; blanks count zero. Click
          a fixture for timestamps.
        </p>
      </details>
      {selected && (
        <FixtureDetail
          data={data}
          team={selected.team}
          gw={selected.gw}
          onClose={() => setSelected(null)}
          onDetail={onDetail}
        />
      )}
    </div>
  );
}

export function FixtureTrend({
  club,
  metric,
  points,
  low,
  high,
  baseline,
}: {
  club: string;
  metric: FixtureMetric;
  points: TrendPoint[];
  low: number;
  high: number;
  baseline: number;
}) {
  const x = (index: number) =>
    points.length === 1
      ? 42
      : 3 +
        (78 * (points[index].week - points[0].week)) /
          (points.at(-1)!.week - points[0].week);
  const span = Math.max(0.0001, high - low);
  const y = (value: number) =>
    metric === "difficulty"
      ? 5 + (24 * (value - low)) / span
      : 29 - (24 * (value - low)) / span;
  const known = (value: number | null): value is number =>
    value !== null && Number.isFinite(value);
  if (!points.some((point) => known(point.value))) {
    return (
      <span className="muted">
        {points.length > 0 && points.every((point) => point.blank)
          ? "Blank"
          : "Unavailable"}
      </span>
    );
  }
  const line = points
    .map((point, index) =>
      known(point.value)
        ? `${index && known(points[index - 1].value) ? "L" : "M"}${x(index)},${y(point.value)}`
        : "",
    )
    .join(" ");
  const summary = points
    .map((point) => `GW${point.week}: ${formatTrendPoint(point, metric)}`)
    .join("; ");
  return (
    <svg
      viewBox="0 0 84 34"
      className="fixture-trend"
      role="img"
      aria-label={`${club} ${metric === "difficulty" ? "difficulty trend (higher is easier)" : "forecast trend"} across selected gameweeks`}
    >
      <title>
        {metric === "difficulty" ? `${summary} (higher = easier)` : summary}
      </title>
      <path d={`M3 ${y(baseline)} H81`} className="fixture-trend-baseline" />
      <path d={line} className="fixture-trend-line" />
      {points.map((point, index) =>
        known(point.value) ? (
          <circle key={point.week} cx={x(index)} cy={y(point.value)} r="1.6" />
        ) : null,
      )}
    </svg>
  );
}

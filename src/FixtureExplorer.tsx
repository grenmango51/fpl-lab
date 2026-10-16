import { useState } from "react";
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
  const [selected, setSelected] = useState<{ team: number; gw: number } | null>(
    null,
  );
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
  const trends = new Map(
    rows.map((row) => [
      row.team.id,
      weeks.map((week) => fixtureTotal([row.forecasts[String(week)]], metric)),
    ]),
  );
  const trendValues = [...trends.values()]
    .flat()
    .filter(
      (value): value is number => value !== null && Number.isFinite(value),
    );
  const trendLow = Math.min(0, ...trendValues);
  const trendHigh = Math.max(trendLow + 1, ...trendValues);
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
      {data.fixture_scenario ? (
        <p className="subtle-tag">Your fixture schedule is active.</p>
      ) : null}
      {data.team_strength_scenario ? (
        <p className="subtle-tag">Your team-strength assumptions are active.</p>
      ) : null}
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
        <details className="fixture-filter">
          <summary>
            Teams <b>{allTeams ? "All" : chosenTeams.length}</b>
          </summary>
          <div className="fixture-filter-body">
            <div className="button-row">
              <button onClick={() => setSelectedTeams(null)}>Select all</button>
              <button onClick={() => setSelectedTeams([])}>Clear</button>
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
        <details className="fixture-filter fixture-week-filter">
          <summary>
            Gameweeks <b>{weeks.length}</b>
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
              <button onClick={() => setSelectedWeeks(available)}>
                All GWs
              </button>
              <button onClick={() => setSelectedWeeks([])}>Clear</button>
              <button onClick={() => setSelectedWeeks(null)}>
                <RotateCcw size={12} />
                Reset
              </button>
            </div>
            <p className="fixture-selection-caption">
              Untick a Free Hit week to exclude it from totals.
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
            ? "fixtures"
            : metric === "cs"
              ? "defence"
              : metric === "goals"
                ? "attack"
                : "overall"}
        </button>
        {(selectedWeeks !== null || selectedTeams !== null) && (
          <button
            className="button small"
            onClick={() => {
              setSelectedTeams(null);
              setSelectedWeeks(null);
            }}
          >
            Reset filters
          </button>
        )}
      </div>
      <p className="fixture-selection-caption" title={weekLabel}>
        {chosenTeams.length} clubs · {weeks.length} gameweeks
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
                <th title="Selected GWs; shared scale across displayed clubs">
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
                    <div className="club-cell">
                      <Badge code={row.team.code} />
                      <b>{row.team.name}</b>
                    </div>
                  </td>
                  <td className="fixture-trend-cell">
                    <FixtureTrend
                      club={row.team.name}
                      weeks={weeks}
                      values={trends.get(row.team.id)!}
                      low={trendLow}
                      high={trendHigh}
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
                              return (
                                <button
                                  key={fixture.id}
                                  className={`fixture-chip fdr-${fixture.difficulty}`}
                                  onClick={() =>
                                    setSelected({ team: row.team.id, gw: week })
                                  }
                                  title={`${row.team.name} v ${fixture.opponent} · ${fixture.source} · ${fixture.source_at ?? "Provider time unknown"}`}
                                >
                                  <b>
                                    {fixture.opponent}{" "}
                                    <span>({fixture.home ? "H" : "A"})</span>
                                  </b>
                                  <small>
                                    {metric === "difficulty"
                                      ? `FDR ${value}`
                                      : metric === "cs"
                                        ? `${fmt(value * 100, 0)}% CS`
                                        : metric === "gd"
                                          ? `${value > 0 ? "+" : ""}${fmt(value, 2)} GD`
                                          : `${fmt(value, 2)} xG`}
                                  </small>
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
      <details className="compact-details source-caption">
        <summary>Sources and totals</summary>
        <p>
          Official FDR. Goals and CS use FPL Joe, Elevenify or the labelled
          fallback. GD = goals for − against. Total CS is an expected count; Avg
          FDR is per fixture. Doubles count both fixtures; blanks count zero.
          Open a fixture for source times.
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

function FixtureTrend({
  club,
  weeks,
  values,
  low,
  high,
}: {
  club: string;
  weeks: number[];
  values: (number | null)[];
  low: number;
  high: number;
}) {
  const x = (index: number) =>
    weeks.length === 1
      ? 42
      : 3 + (78 * (weeks[index] - weeks[0])) / (weeks.at(-1)! - weeks[0]);
  const y = (value: number) => 29 - (24 * (value - low)) / (high - low);
  const known = (value: number | null): value is number =>
    value !== null && Number.isFinite(value);
  if (!values.some(known)) return <span className="muted">Unavailable</span>;
  const line = values
    .map((value, index) =>
      known(value)
        ? `${index && known(values[index - 1]) ? "L" : "M"}${x(index)},${y(value)}`
        : "",
    )
    .join(" ");
  return (
    <svg
      viewBox="0 0 84 34"
      className="fixture-trend"
      role="img"
      aria-label={`${club} forecast trend across selected gameweeks`}
    >
      <title>
        {weeks
          .map(
            (week, index) =>
              `GW${week}: ${known(values[index]) ? fmt(values[index]!, 2) : "unavailable"}`,
          )
          .join("; ")}
      </title>
      <path d={`M3 ${y(0)} H81`} className="fixture-trend-baseline" />
      <path d={line} className="fixture-trend-line" />
      {values.map((value, index) =>
        known(value) ? (
          <circle key={weeks[index]} cx={x(index)} cy={y(value)} r="1.6" />
        ) : null,
      )}
    </svg>
  );
}

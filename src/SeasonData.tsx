import { useEffect, useMemo, useState } from "react";
import { TabStrip } from "./TabStrip";
import type { Bootstrap, Source } from "./types";
import {
  bootstrapSeasonStats,
  DEFAULT_PLAYER_COLUMNS,
  DEFAULT_TEAM_COLUMNS,
  filterStatRows,
  formatStat,
  moveStatsColumn,
  PLAYER_METRICS,
  sanitiseStatsViews,
  scatterStats,
  sortStatRows,
  statLabel,
  statValue,
  STATS_GROUPS,
  TEAM_METRICS,
  teamStatRows,
  type SavedStatsView,
  type SeasonStats,
  type StatRow,
  type StatsGroup,
  type StatsMetric,
  type StatsMode,
} from "./seasonDataModel";
import "./season-data.css";

const SAVED_VIEWS_KEY = "open-fpl-season-data-views-v1";
type Tool = "Table" | "Graph" | "Compare" | "Maps";
const toolItems = (["Table", "Graph", "Compare", "Maps"] as const).map(
  (id) => ({ id, label: id }),
);
const modeItems = (["players", "teams"] as const).map((id) => ({
  id,
  label: id === "players" ? "Players" : "Teams",
}));
const groupItems = [...STATS_GROUPS, "Custom" as const].map((id) => ({
  id,
  label: id,
}));
const sourceTime = (source: Source) =>
  source.fetched_at
    ? new Date(source.fetched_at).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }) + " UTC"
    : "Extraction time unavailable";

function StatsScatter({
  rows,
  metrics,
  xKey,
  yKey,
  per90,
  selected,
  onX,
  onY,
  onPlayer,
  isPlayer,
}: {
  rows: StatRow[];
  metrics: readonly StatsMetric[];
  xKey: string;
  yKey: string;
  per90: boolean;
  selected: number[];
  onX: (key: string) => void;
  onY: (key: string) => void;
  onPlayer: (row: StatRow) => void;
  isPlayer: boolean;
}) {
  const xMetric = metrics.find((metric) => metric.key === xKey) ?? metrics[0];
  const yMetric =
    metrics.find((metric) => metric.key === yKey) ?? metrics[1] ?? metrics[0];
  const plot = scatterStats(rows, xMetric, yMetric, per90);
  const x = (value: number) =>
    60 + (410 * (value - plot.x.min)) / (plot.x.max - plot.x.min);
  const y = (value: number) =>
    300 - (260 * (value - plot.y.min)) / (plot.y.max - plot.y.min);
  return (
    <section className="season-data-side" aria-label="Season stats graph">
      <div className="season-data-axes">
        <label>
          X axis
          <select
            value={xMetric.key}
            onChange={(event) => onX(event.target.value)}
          >
            {metrics.map((metric) => (
              <option key={metric.key} value={metric.key}>
                {statLabel(metric, per90)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Y axis
          <select
            value={yMetric.key}
            onChange={(event) => onY(event.target.value)}
          >
            {metrics.map((metric) => (
              <option key={metric.key} value={metric.key}>
                {statLabel(metric, per90)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <svg
        className="season-data-scatter"
        viewBox="0 0 510 360"
        role="group"
        aria-label={`${statLabel(yMetric, per90)} against ${statLabel(xMetric, per90)}`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((step) => (
          <g key={step}>
            <line
              x1="60"
              x2="470"
              y1={300 - step * 260}
              y2={300 - step * 260}
              className="season-data-grid"
            />
            <text x="51" y={304 - step * 260} textAnchor="end">
              {formatStat(
                plot.y.min + step * (plot.y.max - plot.y.min),
                { ...yMetric, decimals: 1 },
                false,
              )}
            </text>
            <text x={60 + step * 410} y="321" textAnchor="middle">
              {formatStat(
                plot.x.min + step * (plot.x.max - plot.x.min),
                { ...xMetric, decimals: 1 },
                false,
              )}
            </text>
          </g>
        ))}
        <text x="265" y="349" textAnchor="middle">
          {statLabel(xMetric, per90)}
        </text>
        <text transform="translate(15 170) rotate(-90)" textAnchor="middle">
          {statLabel(yMetric, per90)}
        </text>
        {plot.points.map((point) => (
          <g key={point.row.id}>
            <circle
              cx={x(point.x)}
              cy={y(point.y)}
              r={selected.includes(point.row.id) ? 6 : 4}
              className={selected.includes(point.row.id) ? "selected" : ""}
              tabIndex={0}
              role="button"
              aria-label={`${point.row.name}: ${statLabel(xMetric, per90)} ${formatStat(point.x, xMetric, per90)}, ${statLabel(yMetric, per90)} ${formatStat(point.y, yMetric, per90)}`}
              onClick={() => onPlayer(point.row)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPlayer(point.row);
                }
              }}
            >
              <title>
                {point.row.full_name} · {point.row.team_short}\n
                {statLabel(xMetric, per90)}:{" "}
                {formatStat(point.x, xMetric, per90)}\n
                {statLabel(yMetric, per90)}:{" "}
                {formatStat(point.y, yMetric, per90)}
              </title>
            </circle>
            {selected.includes(point.row.id) && (
              <text
                x={x(point.x) + 9}
                y={y(point.y) - 8}
                className="season-data-point-label"
              >
                {point.row.name}
              </text>
            )}
          </g>
        ))}
        {!plot.points.length && (
          <text x="265" y="168" textAnchor="middle">
            No paired observations
          </text>
        )}
      </svg>
      <p className="muted season-data-note">
        {plot.points.length} plotted
        {plot.missing ? ` · ${plot.missing} missing an axis value` : ""}.{" "}
        {isPlayer
          ? "Select a point for player details."
          : "Select a point to filter its team."}
      </p>
    </section>
  );
}

function StatsComparison({
  rows,
  columns,
  per90,
  fullNames,
  onFullNames,
  onClear,
  onRemove,
  onDetail,
  isPlayer,
}: {
  rows: StatRow[];
  columns: StatsMetric[];
  per90: boolean;
  fullNames: boolean;
  isPlayer: boolean;
  onFullNames: (value: boolean) => void;
  onClear: () => void;
  onRemove: (id: number) => void;
  onDetail: (id: number) => void;
}) {
  return (
    <section
      className="season-data-compare"
      aria-label="Season stats comparison"
    >
      <header>
        <strong>Compare · {rows.length}</strong>
        <label>
          <input
            type="checkbox"
            checked={fullNames}
            onChange={(event) => onFullNames(event.target.checked)}
          />
          Full names
        </label>
        <button
          className="button small"
          onClick={onClear}
          disabled={!rows.length}
        >
          Clear comparison
        </button>
      </header>
      {!rows.length ? (
        <p className="muted season-data-note">
          Use + beside a name to compare {isPlayer ? "players" : "teams"}.
        </p>
      ) : (
        <div className="season-data-compare-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Metric</th>
                {rows.map((row) => (
                  <th key={row.id}>
                    <div className="season-data-compare-name">
                      <button
                        onClick={() => isPlayer && onDetail(row.id)}
                        disabled={!isPlayer}
                      >
                        {fullNames ? row.full_name : row.name}
                      </button>
                      <button
                        aria-label={`Remove ${row.name} from comparison`}
                        onClick={() => onRemove(row.id)}
                      >
                        ×
                      </button>
                    </div>
                    <small>
                      {isPlayer
                        ? `${row.team_short} · ${row.position}`
                        : row.team_short}
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {columns.map((metric) => (
                <tr key={metric.key}>
                  <th title={metric.description}>{statLabel(metric, per90)}</th>
                  {rows.map((row) => (
                    <td className="numeric" key={row.id}>
                      {formatStat(statValue(row, metric, per90), metric, per90)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatsMaps({
  players,
  selected,
  onSelect,
}: {
  players: StatRow[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const [map, setMap] = useState<"Touches" | "Passes" | "Shots">("Touches");
  const requirements = {
    Touches:
      "Requires recorded touch coordinates, fixture times and event types, including defensive actions.",
    Passes:
      "Requires recorded pass start/end coordinates, fixture times and completion outcomes.",
    Shots:
      "Requires recorded shot coordinates, outcomes (goal/save/block/miss/post), trajectories and keeper positions.",
  };
  return (
    <section className="season-data-maps" aria-label="Season event maps">
      <label>
        Player for maps
        <select
          value={selected}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="">Select player</option>
          {players.map((player) => (
            <option key={player.id} value={player.id}>
              {player.name} · {player.team_short}
            </option>
          ))}
        </select>
      </label>
      <TabStrip
        label="Event map type"
        value={map}
        items={(["Touches", "Passes", "Shots"] as const).map((id) => ({
          id,
          label: id,
        }))}
        onChange={setMap}
      />
      <div className="season-data-map-empty">
        <strong>{map} data unavailable</strong>
        <p>{requirements[map]}</p>
        <p className="muted">
          The official FPL summary feed has no event coordinates. No event map
          can be drawn from these season totals.
        </p>
      </div>
    </section>
  );
}

export function SeasonData({
  data,
  onDetail,
}: {
  data: Bootstrap;
  onDetail: (id: number) => void;
}) {
  const [loaded, setLoaded] = useState<SeasonStats | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<StatsMode>("players");
  const [tool, setTool] = useState<Tool>("Table");
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("");
  const [team, setTeam] = useState("");
  const [minMinutes, setMinMinutes] = useState(0);
  const [per90, setPer90] = useState(false);
  const [group, setGroup] = useState<StatsGroup | "Custom">("Custom");
  const [columns, setColumns] = useState<Record<StatsMode, string[]>>({
    players: DEFAULT_PLAYER_COLUMNS,
    teams: DEFAULT_TEAM_COLUMNS,
  });
  const [sort, setSort] = useState({
    key: "total_points",
    direction: "desc" as "asc" | "desc",
  });
  const [axes, setAxes] = useState<Record<StatsMode, [string, string]>>({
    players: ["minutes", "total_points"],
    teams: ["goals_conceded", "goals_scored"],
  });
  const [selected, setSelected] = useState<Record<StatsMode, number[]>>({
    players: [],
    teams: [],
  });
  const [fullNames, setFullNames] = useState(false);
  const [mapPlayer, setMapPlayer] = useState("");
  const [editColumns, setEditColumns] = useState(false);
  const [viewName, setViewName] = useState("");
  const [activeView, setActiveView] = useState("");
  const [viewMessage, setViewMessage] = useState("");
  const [savedViews, setSavedViews] = useState<SavedStatsView[]>(() => {
    try {
      return sanitiseStatsViews(
        JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) ?? "[]"),
      );
    } catch {
      return [];
    }
  });
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    setLoaded(null);
    fetch("/api/season-data", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Stats feed unavailable (${response.status})`);
        const payload = (await response.json()) as SeasonStats;
        if (
          payload.season !== data.season ||
          !Array.isArray(payload.players) ||
          !Array.isArray(payload.teams) ||
          !payload.source
        )
          throw new Error("Stats feed does not match the current season");
        if (!controller.signal.aborted) setLoaded(payload);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error ? error.message : "Stats feed unavailable",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [data.season, data.sources.fpl_bootstrap?.fetched_at, retry]);
  const stats = useMemo(
    () => loaded ?? bootstrapSeasonStats(data),
    [loaded, data],
  );
  const metrics = mode === "players" ? PLAYER_METRICS : TEAM_METRICS;
  const allRows = useMemo(
    () => (mode === "players" ? stats.players : teamStatRows(stats.teams)),
    [stats, mode],
  );
  const visibleColumns = columns[mode]
    .map((key) => metrics.find((metric) => metric.key === key))
    .filter((metric): metric is StatsMetric => Boolean(metric));
  const filtered = filterStatRows(allRows, {
    query,
    position: mode === "players" ? position : "",
    team,
    minMinutes: mode === "players" ? minMinutes : 0,
  });
  const rows = sortStatRows(
    filtered,
    metrics.find((metric) => metric.key === sort.key) ?? null,
    sort.direction,
    per90,
  );
  const comparison = selected[mode].flatMap((id) => {
    const row = allRows.find((item) => item.id === id);
    return row ? [row] : [];
  });
  const knownIds = new Set(data.players.map((player) => player.id));
  const detail = (id: number) => {
    if (knownIds.has(id)) onDetail(id);
  };
  const setModeAndDefaults = (value: StatsMode) => {
    setMode(value);
    setSort({
      key: value === "players" ? "total_points" : "points",
      direction: "desc",
    });
    setActiveView("");
    setGroup("Custom");
  };
  const changeColumns = (next: string[]) => {
    setColumns((current) => ({ ...current, [mode]: next }));
    setGroup("Custom");
    setViewMessage("");
  };
  const toggleSelected = (id: number) =>
    setSelected((current) => ({
      ...current,
      [mode]: current[mode].includes(id)
        ? current[mode].filter((item) => item !== id)
        : [...current[mode], id],
    }));
  const persistViews = (next: SavedStatsView[]) => {
    try {
      localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
      setSavedViews(next);
      return true;
    } catch {
      setViewMessage("Browser storage is unavailable. View was not saved.");
      return false;
    }
  };
  const saveView = () => {
    const name = viewName.trim().slice(0, 48);
    if (!name) {
      setViewMessage("Name this column view first.");
      return;
    }
    const id = activeView || crypto.randomUUID();
    const next = [
      ...savedViews.filter((view) => view.id !== id),
      { id, name, mode, columns: [...columns[mode]] },
    ];
    if (persistViews(next)) {
      setActiveView(id);
      setViewName(name);
      setViewMessage("View saved on this browser.");
    }
  };
  const pickView = (id: string) => {
    setActiveView(id);
    setViewMessage("");
    const view = savedViews.find(
      (item) => item.id === id && item.mode === mode,
    );
    setViewName(view?.name ?? "");
    if (view) {
      setColumns((current) => ({ ...current, [mode]: [...view.columns] }));
      setGroup("Custom");
    }
  };
  const sortBy = (key: string) =>
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  const selectGroup = (next: StatsGroup) => {
    setGroup(next);
    setActiveView("");
    setColumns((current) => ({
      ...current,
      [mode]: metrics
        .filter((metric) => next === "All" || metric.group === next)
        .map((metric) => metric.key),
    }));
  };
  const missingCount = rows.filter((row) =>
    visibleColumns.some((metric) => statValue(row, metric, per90) == null),
  ).length;
  return (
    <div className="season-data">
      <div className="view-heading compact-view-heading">
        <div>
          <h2>Season stats</h2>
          <span className="muted">
            Official FPL · {stats.season} · season to date
          </span>
        </div>
        <span className="subtle-tag">
          {stats.players.length} players · {stats.teams.length} clubs
        </span>
      </div>
      <div className="season-data-top">
        <TabStrip
          label="Season stats entities"
          value={mode}
          items={modeItems}
          onChange={setModeAndDefaults}
        />
        <TabStrip
          label="Season stats tools"
          value={tool}
          items={toolItems}
          onChange={setTool}
        />
      </div>
      <div className="season-data-filters">
        <label className="season-data-search">
          Search
          <input
            aria-label="Search season stats"
            placeholder={
              mode === "players"
                ? "Haaland, Saka or Haaland | Saka"
                : "Arsenal, Liverpool"
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {mode === "players" && (
          <label>
            Position
            <select
              value={position}
              onChange={(event) => setPosition(event.target.value)}
            >
              <option value="">All positions</option>
              {["GKP", "DEF", "MID", "FWD"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Team
          <select
            value={team}
            onChange={(event) => setTeam(event.target.value)}
          >
            <option value="">All teams</option>
            {stats.teams.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {mode === "players" && (
          <label>
            Min minutes
            <input
              type="number"
              min="0"
              step="90"
              value={minMinutes}
              onChange={(event) =>
                setMinMinutes(Math.max(0, Number(event.target.value) || 0))
              }
            />
          </label>
        )}
        <label className="season-data-toggle">
          <input
            type="checkbox"
            checked={per90}
            onChange={(event) => setPer90(event.target.checked)}
          />
          Per 90
        </label>
        <button
          className="button small"
          onClick={() => {
            setQuery("");
            setPosition("");
            setTeam("");
            setMinMinutes(0);
          }}
        >
          Reset filters
        </button>
      </div>
      <div className="season-data-columns-bar">
        <TabStrip
          label="Season stats column groups"
          value={group}
          items={groupItems}
          onChange={(value) => {
            if (value === "Custom") {
              setGroup(value);
              setEditColumns(true);
            } else selectGroup(value);
          }}
        />
        <button
          className="button small"
          aria-expanded={editColumns}
          onClick={() => setEditColumns(!editColumns)}
        >
          Columns & saved views
        </button>
      </div>
      {editColumns && (
        <section
          className="season-data-column-editor"
          aria-label="Custom column views"
        >
          <div className="season-data-view-controls">
            <label>
              Saved views
              <select
                value={activeView}
                onChange={(event) => pickView(event.target.value)}
              >
                <option value="">New view</option>
                {savedViews
                  .filter((view) => view.mode === mode)
                  .map((view) => (
                    <option key={view.id} value={view.id}>
                      {view.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              View name
              <input
                value={viewName}
                maxLength={48}
                onChange={(event) => setViewName(event.target.value)}
                placeholder="My season stats"
              />
            </label>
            <button
              className="button small"
              onClick={saveView}
              disabled={!columns[mode].length}
            >
              {activeView ? "Update view" : "Save view"}
            </button>
            <button
              className="button small"
              disabled={!activeView}
              onClick={() => {
                if (
                  persistViews(
                    savedViews.filter((view) => view.id !== activeView),
                  )
                ) {
                  setActiveView("");
                  setViewName("");
                  setViewMessage("View deleted.");
                }
              }}
            >
              Delete view
            </button>
          </div>
          <div className="season-data-column-options">
            {[
              ...visibleColumns,
              ...metrics.filter(
                (metric) => !columns[mode].includes(metric.key),
              ),
            ].map((metric) => {
              const index = columns[mode].indexOf(metric.key);
              return (
                <div key={metric.key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={index >= 0}
                      onChange={() =>
                        changeColumns(
                          index >= 0
                            ? columns[mode].filter((key) => key !== metric.key)
                            : [...columns[mode], metric.key],
                        )
                      }
                    />
                    {metric.label}
                  </label>
                  <button
                    aria-label={`Move ${metric.label} column left`}
                    disabled={index <= 0}
                    onClick={() =>
                      changeColumns(
                        moveStatsColumn(columns[mode], metric.key, -1),
                      )
                    }
                  >
                    ←
                  </button>
                  <button
                    aria-label={`Move ${metric.label} column right`}
                    disabled={index < 0 || index === columns[mode].length - 1}
                    onClick={() =>
                      changeColumns(
                        moveStatsColumn(columns[mode], metric.key, 1),
                      )
                    }
                  >
                    →
                  </button>
                </div>
              );
            })}
          </div>
          <p role="status" className="muted season-data-note">
            {viewMessage ||
              "Checked columns appear in this order. Saved views are local to this browser."}
          </p>
        </section>
      )}
      <div
        className={`season-data-workspace ${tool === "Graph" ? "with-graph" : ""}`}
      >
        {tool === "Graph" && (
          <StatsScatter
            rows={rows}
            metrics={metrics}
            xKey={axes[mode][0]}
            yKey={axes[mode][1]}
            per90={per90}
            selected={selected[mode]}
            onX={(key) =>
              setAxes((current) => ({
                ...current,
                [mode]: [key, current[mode][1]],
              }))
            }
            onY={(key) =>
              setAxes((current) => ({
                ...current,
                [mode]: [current[mode][0], key],
              }))
            }
            onPlayer={(row) =>
              mode === "players" ? detail(row.id) : setTeam(String(row.id))
            }
            isPlayer={mode === "players"}
          />
        )}
        <div className="season-data-main">
          {tool === "Compare" && (
            <StatsComparison
              rows={comparison}
              columns={visibleColumns}
              per90={per90}
              fullNames={fullNames}
              onFullNames={setFullNames}
              onClear={() =>
                setSelected((current) => ({ ...current, [mode]: [] }))
              }
              onRemove={toggleSelected}
              onDetail={detail}
              isPlayer={mode === "players"}
            />
          )}
          {tool === "Maps" && (
            <StatsMaps
              players={stats.players}
              selected={mapPlayer}
              onSelect={setMapPlayer}
            />
          )}
          <div className="season-data-table-summary">
            <span>
              {rows.length} / {allRows.length} {mode}
              {selected[mode].length
                ? ` · ${selected[mode].length} selected`
                : ""}
            </span>
            <span>
              {per90
                ? "Counting metrics /90; minutes, prices and percentages unchanged"
                : "Season totals"}
            </span>
          </div>
          <div className="season-data-table-scroll">
            <table className="data-table season-data-table">
              <thead>
                <tr>
                  <th aria-label="Compare selection"></th>
                  <th
                    aria-sort={
                      sort.key === "name"
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button onClick={() => sortBy("name")}>
                      {mode === "players" ? "Player" : "Team"}
                      {sort.key === "name"
                        ? sort.direction === "desc"
                          ? " ↓"
                          : " ↑"
                        : ""}
                    </button>
                  </th>
                  {visibleColumns.map((metric) => (
                    <th
                      key={metric.key}
                      aria-sort={
                        sort.key === metric.key
                          ? sort.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                      title={metric.description}
                    >
                      <button onClick={() => sortBy(metric.key)}>
                        {statLabel(metric, per90)}
                        {sort.key === metric.key
                          ? sort.direction === "desc"
                            ? " ↓"
                            : " ↑"
                          : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={
                      selected[mode].includes(row.id)
                        ? "season-data-selected"
                        : ""
                    }
                  >
                    <td>
                      <button
                        className="season-data-add"
                        aria-label={`${selected[mode].includes(row.id) ? "Remove" : "Compare"} ${row.name}${selected[mode].includes(row.id) ? " from comparison" : ""}`}
                        aria-pressed={selected[mode].includes(row.id)}
                        onClick={() => {
                          toggleSelected(row.id);
                          if (tool !== "Compare") setTool("Compare");
                        }}
                      >
                        {selected[mode].includes(row.id) ? "✓" : "+"}
                      </button>
                    </td>
                    <td>
                      <button
                        className="season-data-row-name"
                        disabled={mode === "players" && !knownIds.has(row.id)}
                        onClick={() =>
                          mode === "players"
                            ? detail(row.id)
                            : setTeam(String(row.id))
                        }
                      >
                        <strong>{row.name}</strong>
                        <small>
                          {mode === "players"
                            ? `${row.team_short} · ${row.position}`
                            : row.team_short}
                        </small>
                      </button>
                    </td>
                    {visibleColumns.map((metric) => (
                      <td className="numeric" key={metric.key}>
                        {formatStat(
                          statValue(row, metric, per90),
                          metric,
                          per90,
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <p className="season-data-note muted">
                No {mode} match these filters.
              </p>
            )}
          </div>
          {!visibleColumns.length && (
            <p className="season-data-note muted">
              {mode === "teams" && group === "Goalkeeping"
                ? "The fixture feed has no team goalkeeping event stats."
                : "Choose columns in Columns & saved views."}
            </p>
          )}
          {missingCount > 0 && (
            <p className="season-data-note muted">
              — Missing source value or zero minutes for /90. {missingCount}{" "}
              rows have a missing displayed value.
            </p>
          )}
        </div>
      </div>
      <details className="season-data-source">
        <summary>
          Official FPL · {stats.source.status} · extracted{" "}
          {sourceTime(stats.source)}
        </summary>
        <p>
          Season-to-date aggregates; xG/xA describe matches played. No forecast
          fields or scenario edits are included.{" "}
          {mode === "teams"
            ? "Team results use completed fixture scores, not sums of player clean sheets. /90 uses 90 minutes per completed match."
            : "Per 90 divides counting totals by recorded minutes; zero-minute rates remain missing."}
        </p>
        <p>
          <a href={stats.source.url} target="_blank" rel="noreferrer">
            Bootstrap source
          </a>
          {stats.source.sha256
            ? ` · SHA-256 ${stats.source.sha256.slice(0, 12)}`
            : ""}
          . Extraction time is not provider publication time.
        </p>
        {stats.fixture_source && (
          <p>
            Fixtures: {stats.fixture_source.status} · extracted{" "}
            {sourceTime(stats.fixture_source)} ·{" "}
            <a href={stats.fixture_source.url} target="_blank" rel="noreferrer">
              source
            </a>
          </p>
        )}
      </details>
      {loading && (
        <p className="muted season-data-note" role="status">
          Loading official season aggregates…
        </p>
      )}
      {loadError && (
        <p className="season-data-fallback" role="status">
          {loadError}. Showing Bootstrap minutes, FPL points, price and
          ownership only.{" "}
          <button
            className="button small"
            onClick={() => setRetry((current) => current + 1)}
          >
            Retry stats feed
          </button>
        </p>
      )}
    </div>
  );
}

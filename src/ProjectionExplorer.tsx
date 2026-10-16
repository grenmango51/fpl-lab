import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownUp,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  Star,
  Upload,
} from "lucide-react";
import { FixtureDetail } from "./FixtureDetail";
import { useViewState } from "./useViewState";
import { TabStrip } from "./TabStrip";
import { matchesPlayerQuery } from "./playerSearch";
import type { TeamStrengthsSchedule } from "./planningPersistence";
import { TeamStrengths } from "./TeamStrengths";
import { FixtureSchedule } from "./FixtureSchedule";
import type { Bootstrap, Forecast, Player } from "./types";
import { fmt, money, xp } from "./lib";
import { Badge, PlayerName } from "./components";

type Metric =
  | "points"
  | "minutes"
  | "goals"
  | "assists"
  | "cs"
  | "bonus"
  | "defcon"
  | "price"
  | "ownership"
  | "baseline";
export function projectionMetric(
  player: Player,
  gw: number,
  metric: Metric,
): number {
  const forecast = player.gw[String(gw)];
  if (metric === "price") return player.price;
  if (metric === "ownership") return player.ownership;
  if (!forecast) return 0;
  if (metric === "points") return forecast.points;
  if (metric === "minutes") return forecast.xmins;
  if (metric === "goals" || metric === "assists")
    return forecast.fixtures.reduce(
      (sum, fixture) => sum + (metric === "goals" ? fixture.xg : fixture.xa),
      0,
    );
  if (metric === "cs")
    return forecast.fixtures.length
      ? (forecast.fixtures.reduce((sum, fixture) => sum + fixture.cs, 0) /
          forecast.fixtures.length) *
          100
      : 0;
  if (metric === "bonus") return forecast.components.bonus ?? 0;
  if (metric === "defcon") return player.dc_probability * 100;
  return (
    forecast.stat_scenario?.base.expected_points ??
    forecast.prediction_source?.base_points ??
    forecast.points
  );
}

export function ProjectionsView({
  data,
  gw,
  onDetail,
  onEditorTarget,
  editing,
  watch,
  onWatch,
  onCSV,
  onExport,
  selectedPlayer,
  squad,
  onTransfer,
  onCancelTransfer,
  teamStrengths,
  onTeamStrengths,
  fixtureMoves,
  onFixtureMoves,
}: {
  data: Bootstrap;
  gw: number;
  onDetail: (id: number, gw?: number) => void;
  onEditorTarget: (target: HTMLDivElement | null) => void;
  editing?: { id: number; gw: number } | null;
  watch: number[];
  onWatch: (id: number) => void;
  onCSV: () => void;
  onExport: () => void;
  selectedPlayer?: Player | null;
  squad: number[];
  onTransfer: (id: number) => void;
  onCancelTransfer: () => void;
  teamStrengths: TeamStrengthsSchedule;
  onTeamStrengths: (strengths: TeamStrengthsSchedule) => void;
  fixtureMoves: Record<string, number | null>;
  onFixtureMoves: (moves: Record<string, number | null>) => void;
}) {
  const [section, setSection] = useViewState("projections.section", "players");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [query, setQuery] = useViewState("projections.query", "");
  const [position, setPosition] = useViewState("projections.position", "ALL");
  const [team, setTeam] = useViewState("projections.team", 0);
  const [maxPrice, setMaxPrice] = useViewState("projections.maxPrice", 20);
  const [minMinutes, setMinMinutes] = useViewState("projections.minMinutes", 0);
  const [horizon, setHorizon] = useViewState("projections.horizon", 5);
  const [watched, setWatched] = useViewState("projections.watched", false);
  const [heldOnly, setHeldOnly] = useViewState("projections.heldOnly", false);
  const [metric, setMetric] = useViewState<Metric>(
    "projections.metric",
    "points",
  );
  const [sort, setSort] = useViewState("projections.sort", "average");
  const [descending, setDescending] = useViewState(
    "projections.descending",
    true,
  );
  const [page, setPage] = useState(0);
  const remaining = data.gameweeks.filter((week) => week >= gw);
  const weeks = remaining.slice(0, horizon);
  const filtersActive = Boolean(
    query ||
    position !== "ALL" ||
    team ||
    maxPrice !== 20 ||
    minMinutes ||
    watched ||
    heldOnly,
  );
  function clearFilters() {
    setQuery("");
    setPosition("ALL");
    setTeam(0);
    setMaxPrice(20);
    setMinMinutes(0);
    setWatched(false);
    setHeldOnly(false);
    setPage(0);
  }
  const average = (player: Player) =>
    weeks.reduce(
      (sum, week) => sum + projectionMetric(player, week, metric),
      0,
    ) / Math.max(1, weeks.length);
  const total = (player: Player) =>
    weeks.reduce((sum, week) => sum + xp(player, week), 0);
  useEffect(() => {
    if (selectedPlayer) {
      setPosition(selectedPlayer.position);
      setPage(0);
    }
  }, [selectedPlayer?.id]);
  useEffect(
    () => setPage(0),
    [gw, horizon, metric, team, maxPrice, minMinutes, heldOnly],
  );
  const sortValue = (player: Player) =>
    sort === "name"
      ? 0
      : sort === "price"
        ? player.price
        : sort === "ownership"
          ? player.ownership
          : sort === "total"
            ? total(player)
            : sort.startsWith("gw")
              ? projectionMetric(player, +sort.slice(2), metric)
              : average(player);
  const rows = useMemo(
    () =>
      data.players
        .filter(
          (player) =>
            (position === "ALL" || player.position === position) &&
            (!team || player.team === team) &&
            player.price <= maxPrice &&
            (player.gw[String(gw)]?.xmins ?? 0) >= minMinutes &&
            (!watched || watch.includes(player.id)) &&
            (!heldOnly || squad.includes(player.id)) &&
            matchesPlayerQuery(player, query),
        )
        .sort(
          (a, b) =>
            (sort === "name"
              ? a.name.localeCompare(b.name)
              : sortValue(a) - sortValue(b)) * (descending ? -1 : 1),
        ),
    [
      data,
      position,
      team,
      maxPrice,
      minMinutes,
      watched,
      heldOnly,
      watch,
      squad,
      query,
      sort,
      descending,
      metric,
      horizon,
      gw,
    ],
  );
  useEffect(
    () =>
      setPage((current) =>
        Math.min(current, Math.max(0, Math.ceil(rows.length / 35) - 1)),
      ),
    [rows.length],
  );
  const header = (label: string, key: string) => (
    <button
      onClick={() => {
        setSort(key);
        setDescending(sort === key ? !descending : true);
      }}
    >
      {label}
      {sort === key ? (
        <ChevronDown size={11} className={descending ? "" : "rotate"} />
      ) : (
        <ArrowDownUp size={10} />
      )}
    </button>
  );
  const metrics: { id: Metric; label: string }[] = [
    { id: "points", label: "Points" },
    { id: "minutes", label: "Minutes" },
    { id: "goals", label: "Goals" },
    { id: "assists", label: "Assists" },
    { id: "cs", label: "Clean sheets %" },
    { id: "bonus", label: "Bonus points" },
    { id: "defcon", label: "DefCon hit %" },
    { id: "price", label: "Price" },
    { id: "ownership", label: "Ownership %" },
    { id: "baseline", label: "Base model points" },
  ];
  const source = (forecast?: Forecast) =>
    forecast?.fixture_scenario && !forecast.stat_scenario
      ? "Your fixture schedule"
      : forecast?.team_strength_scenario && !forecast.stat_scenario
        ? "Your team-strength assumption"
        : forecast?.stat_scenario
          ? "Your stat scenario"
          : forecast?.minutes_scenario
            ? "Your minutes scenario"
            : forecast?.prediction_source
              ? `${forecast.prediction_source.name} · ${forecast.prediction_source.kind}`
              : "Component model";
  const scale =
    metric === "points" || metric === "baseline"
      ? 10
      : metric === "minutes"
        ? 90
        : metric === "goals" || metric === "assists"
          ? 1
          : metric === "bonus"
            ? 2
            : 100;
  return (
    <div
      className={`projection-explorer ${editing && !controlsOpen ? "projection-editing-compact" : ""}`}
    >
      <div className="projection-topline">
        <TabStrip
          label="Projection views"
          value={section}
          onChange={setSection}
          items={[
            { id: "players", label: "Players" },
            { id: "teams", label: "Teams" },
            { id: "fixtures", label: "Fixtures" },
          ]}
        />
        <div className="button-row">
          <button
            className="icon-button"
            title="Import projections"
            aria-label="Import CSV"
            onClick={onCSV}
          >
            <Upload size={15} />
          </button>
          <button
            className="icon-button"
            title="Export projections"
            aria-label="Export CSV"
            onClick={onExport}
          >
            <Download size={15} />
          </button>
        </div>
      </div>
      {editing ? (
        <button
          className="button small projection-controls-toggle"
          aria-expanded={controlsOpen}
          onClick={() => setControlsOpen(!controlsOpen)}
        >
          <ChevronDown size={13} />{" "}
          {controlsOpen
            ? "Hide controls"
            : `Filters · ${query || "All players"} · ${metric} · ${weeks.length} GWs`}
        </button>
      ) : null}
      <div className="projection-controls" hidden={section === "fixtures"}>
        {section === "players" ? (
          <label>
            Metric
            <select
              aria-label="Projection metric"
              value={metric}
              onChange={(event) => setMetric(event.target.value as Metric)}
            >
              {metrics.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Horizon
          <select
            aria-label="Projection horizon"
            value={Math.min(horizon, remaining.length)}
            onChange={(event) => setHorizon(+event.target.value)}
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
                remaining.length,
                Math.min(horizon, remaining.length),
              ]),
            ]
              .filter((value) => value <= remaining.length)
              .sort((a, b) => a - b)
              .map((value) => (
                <option value={value} key={value}>
                  {value} GWs
                </option>
              ))}
          </select>
        </label>
        <span>
          {section === "players"
            ? `${rows.length} players`
            : `${data.teams.length} clubs`}
          <br />
          <small>
            GW{weeks[0]}–{weeks.at(-1)}
          </small>
        </span>
      </div>
      {section === "players" ? (
        <>
          {selectedPlayer ? (
            <div className="replacement-banner">
              <Badge player={selectedPlayer} size={20} />
              <span>
                Transfer out <b>{selectedPlayer.name}</b>
              </span>
              <small>Choose a replacement · server checks budget</small>
            </div>
          ) : null}
          <div className="table-toolbar">
            <div className="search-box">
              <Search size={14} />
              <input
                aria-label="Search players"
                placeholder="Players or clubs · comma or | to compare"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
            </div>
            <button
              className={`icon-button ${watched ? "starred" : ""}`}
              aria-label="Filter watchlist"
              aria-pressed={watched}
              onClick={() => {
                setWatched(!watched);
                setPage(0);
              }}
            >
              <Star size={15} />
            </button>
            <button
              className={`button small ${heldOnly ? "selected" : ""}`}
              aria-pressed={heldOnly}
              onClick={() => setHeldOnly(!heldOnly)}
            >
              My squad
            </button>
          </div>
          <div className="projection-filter-bar">
            <div className="projection-position-tabs segmented">
              {["ALL", "GKP", "DEF", "MID", "FWD"].map((value) => (
                <button
                  key={value}
                  className={position === value ? "active" : ""}
                  onClick={() => {
                    setPosition(value);
                    setPage(0);
                  }}
                >
                  {value === "ALL" ? "All" : value}
                </button>
              ))}
            </div>
            {filtersActive ? (
              <button
                className="button small filter-reset"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            ) : null}
          </div>
          <details className="projection-filters compact-details">
            <summary>Filters · {rows.length} players</summary>
            <div className="field-grid">
              <label>
                Club
                <select
                  aria-label="Projection club"
                  value={team}
                  onChange={(event) => setTeam(+event.target.value)}
                >
                  <option value={0}>All clubs</option>
                  {data.teams.map((club) => (
                    <option value={club.id} key={club.id}>
                      {club.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Max price
                <select
                  aria-label="Maximum player price"
                  value={maxPrice}
                  onChange={(event) => setMaxPrice(+event.target.value)}
                >
                  {[20, 15, 12, 10, 8, 7, 6, 5, 4.5].map((value) => (
                    <option value={value} key={value}>
                      {value === 20 ? "Any" : money(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Expected minutes
                <select
                  aria-label="Minimum expected minutes"
                  value={minMinutes}
                  onChange={(event) => setMinMinutes(+event.target.value)}
                >
                  {[0, 30, 45, 60, 75].map((value) => (
                    <option value={value} key={value}>
                      {value === 0 ? "Any" : `${value}+`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
          <div className="table-container projection-scroll">
            <table className="data-table projections-table">
              <thead>
                <tr>
                  <th className="projection-player-col">
                    {header("Name", "name")}
                  </th>
                  <th>{header("£", "price")}</th>
                  <th>{header("Avg", "average")}</th>
                  {weeks.map((week) => (
                    <th key={week}>{header(`GW${week}`, `gw${week}`)}</th>
                  ))}
                  <th>{header("Σ xPts", "total")}</th>
                  {selectedPlayer ? <th>Δ xPts</th> : null}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(page * 35, page * 35 + 35).map((player) => (
                  <tr
                    key={player.id}
                    className={squad.includes(player.id) ? "held-row" : ""}
                  >
                    <td className="projection-player-col">
                      <PlayerName
                        player={player}
                        onClick={() => onDetail(player.id)}
                      />
                    </td>
                    <td>{fmt(player.price)}</td>
                    <td className="numeric">
                      <b>
                        {fmt(
                          average(player),
                          metric === "goals" || metric === "assists" ? 2 : 1,
                        )}
                      </b>
                    </td>
                    {weeks.map((week) => {
                      const value = projectionMetric(player, week, metric);
                      const forecast = player.gw[String(week)];
                      return (
                        <td key={week}>
                          <button
                            className="projection-value"
                            aria-label={`${player.name} GW${week} ${metric}`}
                            aria-pressed={
                              editing?.id === player.id && editing.gw === week
                            }
                            style={{
                              background: `rgba(${metric === "cs" ? "52, 181, 152" : "255, 106, 61"},${Math.min(0.45, Math.max(0.02, (value / scale) * 0.38))})`,
                            }}
                            onClick={() => onDetail(player.id, week)}
                            title={`${source(forecast)} · ${forecast?.fixtures.map((f) => `${f.opponent} (${f.home ? "H" : "A"})`).join(" + ") || "Blank"}`}
                          >
                            <b>
                              {fmt(
                                value,
                                metric === "goals" || metric === "assists"
                                  ? 2
                                  : 1,
                              )}
                              {forecast?.fixture_scenario ||
                              forecast?.team_strength_scenario ||
                              forecast?.stat_scenario ||
                              forecast?.minutes_scenario ? (
                                <sup>✎</sup>
                              ) : forecast?.prediction_source ? (
                                <sup>
                                  {forecast.prediction_source.kind ===
                                  "provider"
                                    ? "P"
                                    : "E"}
                                </sup>
                              ) : null}
                            </b>
                            <small>
                              {forecast?.fixtures
                                .map(
                                  (f) => `${f.opponent}${f.home ? "" : "(A)"}`,
                                )
                                .join("+") || "—"}
                            </small>
                          </button>
                        </td>
                      );
                    })}
                    <td className="numeric orange">
                      <b>{fmt(total(player))}</b>
                    </td>
                    {selectedPlayer ? (
                      <td
                        className={
                          total(player) >= total(selectedPlayer)
                            ? "green numeric"
                            : "red numeric"
                        }
                      >
                        {fmt(total(player) - total(selectedPlayer))}
                      </td>
                    ) : null}
                    <td>
                      {selectedPlayer &&
                      selectedPlayer.position_id === player.position_id &&
                      !squad.includes(player.id) ? (
                        <button
                          className="button small primary"
                          aria-label={`Transfer ${player.name} in`}
                          onClick={() => onTransfer(player.id)}
                        >
                          <ArrowRight size={12} />
                        </button>
                      ) : (
                        <button
                          className={`icon-button ${watch.includes(player.id) ? "starred" : ""}`}
                          aria-label={`Watch ${player.name}`}
                          onClick={() => onWatch(player.id)}
                        >
                          <Star
                            size={13}
                            fill={
                              watch.includes(player.id)
                                ? "currentColor"
                                : "none"
                            }
                          />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length ? (
              <p className="inline-empty">No matching players.</p>
            ) : null}
          </div>
          <div className="table-footer">
            <small>
              {rows.length ? Math.min(page * 35 + 1, rows.length) : 0}–
              {Math.min((page + 1) * 35, rows.length)} of {rows.length}
            </small>
            <div>
              <button
                className="icon-button"
                aria-label="Previous player page"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                className="icon-button"
                aria-label="Next player page"
                disabled={(page + 1) * 35 >= rows.length}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {section === "teams" ? (
            <TeamStrengths
              data={data}
              strengths={teamStrengths}
              onChange={onTeamStrengths}
              onTeam={(id) => {
                setTeam(id);
                setSection("players");
                setPage(0);
              }}
            />
          ) : null}
          {section === "fixtures" ? (
            <FixtureSchedule
              data={data}
              gw={gw}
              moves={fixtureMoves}
              onChange={onFixtureMoves}
            />
          ) : null}
          {section === "teams" ? (
            <TeamProjectionGrid
              data={data}
              weeks={weeks}
              fixtures={false}
              onDetail={onDetail}
            />
          ) : null}
        </>
      )}
      <div className="projection-player-slot" ref={onEditorTarget} />
      <details className="compact-details projection-notes">
        <summary>Sources & metric notes</summary>
        <p>
          P provider · E extrapolated · ✎ your scenario. xG/xA are unconditional
          GW totals; CS is mean fixture probability. DefCon uses the player
          hit-rate estimate. Prices and ownership stay fixed. Base points
          exclude point anchors; your minute assumptions may remain. Missing
          fixture weeks are blank.
        </p>
      </details>
    </div>
  );
}

function TeamProjectionGrid({
  data,
  weeks,
  fixtures,
  onDetail,
}: {
  data: Bootstrap;
  weeks: number[];
  fixtures: boolean;
  onDetail: (id: number, gw?: number) => void;
}) {
  const [selected, setSelected] = useState<{ team: number; gw: number } | null>(
    null,
  );
  const [metric, setMetric] = useViewState("projections.teamMetric", "goals");
  const representative = (id: number) =>
    data.players.find(
      (player) => player.team === id && player.position_id === 1,
    ) ?? data.players.find((player) => player.team === id);
  return (
    <>
      <div className="team-projection-toolbar">
        <span>{fixtures ? "Fixture outlook" : "Team expectations"}</span>
        <select
          aria-label="Team projection metric"
          value={metric}
          onChange={(event) => setMetric(event.target.value)}
        >
          <option value="goals">Expected goals</option>
          <option value="cs">Clean sheet %</option>
          <option value="difficulty">Fixture difficulty</option>
        </select>
      </div>
      <div className="table-container">
        <table className="data-table team-projection-table">
          <thead>
            <tr>
              <th>Team</th>
              {weeks.map((week) => (
                <th key={week}>GW{week}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.teams.map((team) => (
              <tr key={team.id}>
                <td>
                  <div className="team-name">
                    <Badge code={team.code} size={23} />
                    <b>{team.short_name}</b>
                  </div>
                </td>
                {weeks.map((week) => {
                  const forecast = representative(team.id)?.gw[String(week)];
                  const rows = forecast?.fixtures ?? [];
                  return (
                    <td key={week}>
                      {rows.length ? (
                        rows.map((row, index) => (
                          <button
                            onClick={() =>
                              setSelected({ team: team.id, gw: week })
                            }
                            className={`team-fixture-value fixture-difficulty-${row.difficulty}`}
                            key={row.id}
                            title={`${row.source} · ${row.source_at}`}
                          >
                            <b>
                              {fmt(
                                metric === "goals"
                                  ? row.team_goals
                                  : metric === "cs"
                                    ? (forecast?.stat_scenario?.base
                                        .clean_sheet_probabilities[index] ??
                                        row.cs) * 100
                                    : row.difficulty,
                                metric === "difficulty" ? 0 : 1,
                              )}
                              {metric === "cs" ? "%" : ""}
                            </b>
                            <small>
                              {row.opponent} ({row.home ? "H" : "A"})
                            </small>
                          </button>
                        ))
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected ? (
        <FixtureDetail
          data={data}
          team={selected.team}
          gw={selected.gw}
          onClose={() => setSelected(null)}
          onDetail={onDetail}
        />
      ) : null}
    </>
  );
}

import { useMemo, useState } from "react";
import { Badge, LineChart } from "./components";
import { FixtureDetail } from "./FixtureDetail";
import { TabStrip } from "./TabStrip";
import { useViewState } from "./useViewState";
import { fmt } from "./lib";
import type { Bootstrap, Fixture } from "./types";

export function FixtureMarkets({
  data,
  gw,
  onDetail,
}: {
  data: Bootstrap;
  gw: number;
  onDetail: (id: number, gw?: number) => void;
}) {
  const [view, setView] = useViewState("market.fixtures.view", "fixtures");
  const [metric, setMetric] = useViewState("market.fixtures.metric", "goals");
  const [team, setTeam] = useViewState("market.fixtures.team", 0);
  const [horizon, setHorizon] = useViewState("market.fixtures.horizon", 5);
  const [marketOnly, setMarketOnly] = useViewState(
    "market.fixtures.marketOnly",
    false,
  );
  const [selected, setSelected] = useState<{ team: number; gw: number } | null>(
    null,
  );
  const remaining = data.gameweeks.filter((week) => week >= gw);
  const effectiveHorizon = Math.min(horizon, remaining.length);
  const weeks = remaining.slice(0, effectiveHorizon);
  const rows = useMemo(() => {
    type Side = { team: number; fixture: Fixture; cs: number };
    const mapped = new Map<
      string,
      { gw: number; id: number; home?: Side; away?: Side }
    >();
    for (const club of data.teams) {
      const player =
        data.players.find((p) => p.team === club.id && p.position_id === 1) ??
        data.players.find((p) => p.team === club.id);
      if (!player) continue;
      for (const week of weeks) {
        const forecast = player.gw[String(week)];
        for (const [index, fixture] of (forecast?.fixtures ?? []).entries()) {
          const key = `${week}-${fixture.id}`;
          const row = mapped.get(key) ?? { gw: week, id: fixture.id };
          const side = {
            team: club.id,
            fixture,
            cs:
              forecast?.stat_scenario?.base.clean_sheet_probabilities[index] ??
              fixture.cs,
          };
          if (fixture.home) row.home = side;
          else row.away = side;
          mapped.set(key, row);
        }
      }
    }
    return [...mapped.values()]
      .filter(
        (row) =>
          (!team || row.home?.team === team || row.away?.team === team) &&
          (!marketOnly ||
            [row.home, row.away].some((side) =>
              side?.fixture.source.toLowerCase().includes("joe"),
            )),
      )
      .sort((a, b) => a.gw - b.gw || a.id - b.id);
  }, [data, gw, effectiveHorizon, team, marketOnly]);
  const lookup = new Map(data.teams.map((club) => [club.id, club]));
  const chartTeams = team
    ? [team]
    : data.teams.slice(0, 4).map((club) => club.id);
  return (
    <div className="fixture-markets">
      <div className="view-heading compact-view-heading">
        <h2>Fixture markets</h2>
        <span className="subtle-tag">FPL Joe · Elevenify</span>
      </div>
      <div className="market-controls">
        <TabStrip
          label="Fixture market display"
          value={view}
          onChange={setView}
          items={[
            { id: "fixtures", label: "Fixtures" },
            { id: "graph", label: "Graph" },
          ]}
        />
        <TabStrip
          label="Fixture market metric"
          value={metric}
          onChange={setMetric}
          items={[
            { id: "goals", label: "Goals" },
            { id: "cs", label: "Clean sheets" },
          ]}
        />
      </div>
      <div className="field-grid">
        <label>
          Team
          <select
            aria-label="Fixture market team"
            value={team}
            onChange={(event) => setTeam(+event.target.value)}
          >
            <option value={0}>All teams</option>
            {data.teams.map((club) => (
              <option key={club.id} value={club.id}>
                {club.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Horizon
          <select
            aria-label="Fixture market horizon"
            value={effectiveHorizon}
            onChange={(event) => setHorizon(+event.target.value)}
          >
            {[...new Set([1, 3, 5, 10, remaining.length, effectiveHorizon])]
              .filter((n) => n <= remaining.length)
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n} GWs
                </option>
              ))}
          </select>
        </label>
      </div>
      <label className="market-only-toggle">
        <input
          type="checkbox"
          checked={marketOnly}
          onChange={(event) => setMarketOnly(event.target.checked)}
        />
        FPL Joe fixtures only
      </label>
      {view === "graph" ? (
        <div className="panel market-chart">
          <h3>Fixture expectations</h3>
          <p className="source-caption">
            {chartTeams.map((id) => lookup.get(id)?.short_name).join(" · ")} ·
            choose a club to focus
          </p>
          <LineChart
            height={220}
            yLabel={
              metric === "goals" ? "Expected team goals" : "Mean clean-sheet %"
            }
            labels={weeks.map((week) => `GW${week}`)}
            series={chartTeams.map((id) => ({
              name: lookup.get(id)?.short_name ?? String(id),
              values: weeks.map((week) => {
                const sides = rows
                  .filter((row) => row.gw === week)
                  .flatMap((row) => [row.home, row.away])
                  .filter((side) => side?.team === id);
                if (!sides.length && (marketOnly || metric === "cs"))
                  return null;
                return metric === "goals"
                  ? sides.reduce(
                      (sum, side) => sum + (side?.fixture.team_goals ?? 0),
                      0,
                    )
                  : sides.length
                    ? sides.reduce(
                        (sum, side) => sum + (side?.cs ?? 0) * 100,
                        0,
                      ) / sides.length
                    : 0;
              }),
            }))}
          />
        </div>
      ) : (
        <div className="market-fixture-list">
          {rows.map((row) => (
            <button
              className="market-fixture-card"
              key={`${row.gw}-${row.id}`}
              onClick={() =>
                setSelected({
                  team: row.home?.team ?? row.away!.team,
                  gw: row.gw,
                })
              }
              aria-label={`GW${row.gw} ${lookup.get(row.home?.team ?? 0)?.name ?? "Home"} v ${lookup.get(row.away?.team ?? 0)?.name ?? "Away"} fixture detail`}
            >
              <span className="market-fixture-header">
                <b>GW{row.gw}</b>
                <span>
                  {row.home?.fixture.kickoff
                    ? new Date(row.home.fixture.kickoff).toLocaleDateString(
                        "en-GB",
                        { month: "short", day: "numeric" },
                      )
                    : "TBC"}
                </span>
              </span>
              <span className="market-match">
                {[row.home, row.away].map((side, index) => (
                  <span key={index}>
                    <Badge
                      code={side ? lookup.get(side.team)?.code : undefined}
                      size={28}
                    />
                    <span>
                      {side ? lookup.get(side.team)?.short_name : "—"}
                      <small>{index === 0 ? "Home" : "Away"}</small>
                    </span>
                    <strong>
                      {side
                        ? fmt(
                            metric === "goals"
                              ? side.fixture.team_goals
                              : side.cs * 100,
                            metric === "goals" ? 2 : 1,
                          )
                        : "—"}
                      {metric === "cs" ? "%" : ""}
                    </strong>
                  </span>
                ))}
              </span>
              <span className="market-fixture-source">
                {[row.home, row.away]
                  .map((side) => side?.fixture.source)
                  .filter(
                    (value, index, values) =>
                      value && values.indexOf(value) === index,
                  )
                  .join(" · ")}
                <span>Details →</span>
              </span>
            </button>
          ))}
          {!rows.length ? (
            <p className="inline-empty">
              No matching fixtures. Change the club or source filter.
            </p>
          ) : null}
        </div>
      )}
      <details className="compact-details">
        <summary>Source notes</summary>
        <p>
          Current fixture expectations; future weeks may use Elevenify or
          historical fallback. Graphs show the fixture horizon. Open a fixture
          for provider and extraction times. Player scenarios do not alter team
          inputs.
        </p>
      </details>
      {selected ? (
        <FixtureDetail
          data={data}
          team={selected.team}
          gw={selected.gw}
          onClose={() => setSelected(null)}
          onDetail={onDetail}
        />
      ) : null}
    </div>
  );
}

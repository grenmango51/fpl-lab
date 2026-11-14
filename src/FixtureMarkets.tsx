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
  const clubForecast = (clubId: number, week: number) => {
    const key = String(week);
    return (
      data.players.find(
        (p) => p.team === clubId && p.position_id === 1 && p.gw[key],
      ) ?? data.players.find((p) => p.team === clubId && p.gw[key])
    )?.gw[key];
  };
  const rows = useMemo(() => {
    type Side = { team: number; fixture: Fixture; cs: number };
    const mapped = new Map<
      string,
      { gw: number; id: number; home?: Side; away?: Side }
    >();
    for (const club of data.teams) {
      for (const week of weeks) {
        const forecast = clubForecast(club.id, week);
        for (const [index, fixture] of (forecast?.fixtures ?? []).entries()) {
          const rowKey = `${week}-${fixture.id}`;
          const row = mapped.get(rowKey) ?? { gw: week, id: fixture.id };
          const side = {
            team: club.id,
            fixture,
            cs:
              forecast?.stat_scenario?.base.clean_sheet_probabilities[index] ??
              fixture.cs,
          };
          if (fixture.home) row.home = side;
          else row.away = side;
          mapped.set(rowKey, row);
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
        <div className="toolbar-actions">
          {data.fixture_scenario ? (
            <span className="subtle-tag">Custom schedule active</span>
          ) : null}
          {data.team_strength_scenario ? (
            <span className="subtle-tag">Team strengths active</span>
          ) : null}
          <span className="subtle-tag">FPL Joe · Elevenify</span>
        </div>
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
              .filter((n) => n > 0 && n <= remaining.length)
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
      {!rows.length ? (
        <p className="inline-empty">
          No matching fixtures. Change the club or source filter.
        </p>
      ) : view === "graph" ? (
        <div className="panel market-chart">
          <h3>Fixture expectations</h3>
          <p className="source-caption">
            {chartTeams.map((id) => lookup.get(id)?.short_name).join(" · ")} ·
            choose a club to focus
          </p>
          <LineChart
            height={220}
            colors={["#ff764d", "#61ba9a", "#7c94cb", "#e0b15b"]}
            yLabel={
              metric === "goals" ? "Expected team goals" : "Mean clean-sheet %"
            }
            labels={weeks.map((week) => `GW${week}`)}
            series={chartTeams.map((id) => ({
              name: lookup.get(id)?.short_name ?? String(id),
              values: weeks.map((week) => {
                if (!clubForecast(id, week)) return null;
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
                  : Math.min(
                      100,
                      Math.max(
                        0,
                        sides.reduce(
                          (sum, side) => sum + (side?.cs ?? 0) * 100,
                          0,
                        ) / sides.length,
                      ),
                    );
              }),
            }))}
          />
        </div>
      ) : (
        <div className="market-fixture-list">
          {rows.map((row) => {
            const matchFixture = (row.home ?? row.away)?.fixture;
            const moved =
              matchFixture?.original_event !== undefined &&
              matchFixture.original_event !== matchFixture.target_event;
            return (
              <button
                type="button"
                className="market-fixture-card"
                key={`${row.gw}-${row.id}`}
                aria-haspopup="dialog"
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
                    {matchFixture?.kickoff
                      ? new Date(matchFixture.kickoff).toLocaleDateString(
                          "en-GB",
                          { month: "short", day: "numeric" },
                        )
                      : moved
                        ? "Moved"
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
                                : Math.min(100, Math.max(0, side.cs * 100)),
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
            );
          })}
        </div>
      )}
      <details className="compact-details">
        <summary>Source notes</summary>
        <p>
          FPL Joe near-term; Elevenify or historical fallback further out. Open
          a fixture for timestamps. Player scenarios do not alter team inputs.
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

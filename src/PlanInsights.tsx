import { useMemo } from "react";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { Badge } from "./components";
import { useViewState } from "./useViewState";
import { fmt, money } from "./lib";
import { planInsights } from "./planInsightModel";
import type { InsightScope } from "./planInsightModel";
import type { Bootstrap, Plan, Player } from "./types";
import "./plan-insights.css";

const componentLabels: Record<string, string> = {
  appearance: "Appearance",
  goals: "Goals",
  assists: "Assists",
  clean_sheet: "Clean sheets",
  defensive: "Defensive contributions",
  bonus: "Bonus",
  saves: "Saves",
  penalty_saves: "Penalty saves",
  deductions: "Cards / goals conceded",
  provider_adjustment: "Provider adjustment",
  solio_adjustment: "Solio points adjustment",
  solio_extrapolation: "Solio window extrapolation",
  imported_adjustment: "Imported points adjustment",
  user_points_adjustment: "Your points adjustment",
  unassigned_forecast: "Unassigned forecast residual",
};

export const round1 = (points: number) => Math.round(points * 10) / 10 || 0;

export const deltaClass = (points: number | null) => {
  if (points === null || !Number.isFinite(points)) return "";
  const rounded = round1(points);
  return rounded > 0 ? "pi-positive" : rounded < 0 ? "pi-negative" : "";
};

export const signed = (points: number | null) => {
  if (points === null || !Number.isFinite(points)) return "—";
  const rounded = round1(points);
  return `${rounded > 0 ? "+" : ""}${fmt(rounded)}`;
};

const value = (points: number | null, digits = 1) =>
  points === null ? "—" : fmt(points, digits);

const percent = (probability: number | null) =>
  probability === null ? "—" : `${fmt(probability * 100, 0)}%`;

function Name({
  player,
  onDetail,
}: {
  player: Player;
  onDetail: (id: number) => void;
}) {
  return (
    <button className="pi-player-name" onClick={() => onDetail(player.id)}>
      <Badge player={player} size={21} />
      <span>
        {player.name}
        <small>
          {player.team_short} · {player.position}
        </small>
      </span>
    </button>
  );
}

function Bar({
  label,
  points,
  max,
  subtle = false,
}: {
  label: string;
  points: number;
  max: number;
  subtle?: boolean;
}) {
  const rounded = round1(points);
  return (
    <div className={`pi-bar-row ${subtle ? "pi-bar-subtle" : ""}`}>
      <span>{label}</span>
      <div className="pi-bar-track" aria-hidden="true">
        <i
          className={rounded < 0 ? "negative" : ""}
          style={{
            width: `${Math.min(100, (Math.abs(points) / Math.max(1, max)) * 100)}%`,
          }}
        />
      </div>
      <b>{fmt(rounded)}</b>
    </div>
  );
}

export function PlanInsights({
  data,
  plan,
  selectedGW,
  lockedIds,
  onDetail,
  onLock,
}: {
  data: Bootstrap;
  plan: Plan;
  selectedGW: number;
  lockedIds?: number[];
  onDetail: (id: number) => void;
  onLock?: (id: number) => void;
}) {
  const [scope, setScope] = useViewState<InsightScope>(
    "plans.insightScope",
    "horizon",
  );
  const insight = useMemo(
    () => planInsights(data, plan, selectedGW, scope),
    [data, plan, selectedGW, scope],
  );
  const { weeks, rows, components, completeRows } = insight;
  const actualWeeks = weeks.map((week) => `GW${week.gw}`).join(", ");
  const count = weeks.length;
  const groups = [
    { label: "Appearance", keys: ["appearance"] },
    { label: "Goals & assists", keys: ["goals", "assists"] },
    { label: "Clean sheets & defending", keys: ["clean_sheet", "defensive"] },
    { label: "Bonus & saves", keys: ["bonus", "saves", "penalty_saves"] },
    { label: "Deductions", keys: ["deductions"] },
    {
      label: "Provider / your adjustments",
      keys: [
        "provider_adjustment",
        "solio_adjustment",
        "solio_extrapolation",
        "imported_adjustment",
        "user_points_adjustment",
      ],
    },
  ].map((group) => ({
    label: group.label,
    points: group.keys.reduce((sum, key) => sum + (components[key] ?? 0), 0),
  }));
  const knownComponents = new Set([
    "appearance",
    "goals",
    "assists",
    "clean_sheet",
    "defensive",
    "bonus",
    "saves",
    "penalty_saves",
    "deductions",
    "provider_adjustment",
    "solio_adjustment",
    "solio_extrapolation",
    "imported_adjustment",
    "user_points_adjustment",
  ]);
  const other = Object.entries(components).reduce(
    (sum, [key, points]) => sum + (knownComponents.has(key) ? 0 : points),
    0,
  );
  if (Math.abs(other) > 1e-8)
    groups.push({ label: "Other / unassigned", points: other });
  const dnaMax = Math.max(
    1,
    ...groups.map((group) => Math.abs(group.points)),
    insight.autosubs,
    insight.vice,
  );
  const knownRisks = rows.filter((row) => row.anyStarterAbsent !== null);
  const avgAbsence = knownRisks.length
    ? knownRisks.reduce((sum, row) => sum + row.anyStarterAbsent!, 0) /
      knownRisks.length
    : null;
  const expectedMissing = knownRisks.length
    ? knownRisks.reduce((sum, row) => sum + row.expectedMissing!, 0) /
      knownRisks.length
    : null;
  const staleScores = completeRows.filter(
    (row) => Math.abs(row.week.points - row.points!) > 0.05,
  ).length;
  const maxTeamPoints = Math.max(
    1,
    ...insight.teams.map((team) => Math.abs(team.points ?? 0)),
  );
  const loadedAt =
    data.loaded_at && !Number.isNaN(Date.parse(data.loaded_at))
      ? new Date(data.loaded_at).toLocaleString()
      : "Source time unavailable";

  return (
    <div className="plan-insights">
      <header className="pi-heading">
        <div>
          <h2>Plan insights</h2>
          <span title={actualWeeks}>
            {scope === "gameweek"
              ? `GW${selectedGW}`
              : `${count} planned gameweek${count === 1 ? "" : "s"}`}{" "}
            · Current forecasts
          </span>
        </div>
        <div className="pi-scope" aria-label="Insights period">
          {(["horizon", "gameweek"] as const).map((item) => (
            <button
              key={item}
              aria-pressed={scope === item}
              className={scope === item ? "active" : ""}
              onClick={() => setScope(item)}
            >
              {item === "horizon" ? "Horizon" : "Gameweek"}
            </button>
          ))}
        </div>
      </header>
      {!count ? (
        <p className="pi-empty">No plan for GW{selectedGW}.</p>
      ) : (
        <>
          <div className="pi-summary">
            <div>
              <small>Net xPts</small>
              <strong>{value(insight.netPoints)}</strong>
            </div>
            <div>
              <small>Vs holding</small>
              <strong className={deltaClass(insight.transferGain)}>
                {signed(insight.transferGain)}
              </strong>
            </div>
            <div>
              <small>Transfer hits</small>
              <strong>{insight.hits ? `−${fmt(insight.hits, 0)}` : "0"}</strong>
            </div>
            <div>
              <small>Transfers</small>
              <strong>
                {weeks.reduce((sum, week) => sum + week.transfers_in.length, 0)}
              </strong>
            </div>
          </div>
          {completeRows.length !== count ? (
            <p className="pi-coverage" role="status">
              Forecast coverage: {completeRows.length}/{count} weeks. Missing
              rows stay unavailable.
            </p>
          ) : null}
          <div className="pi-grid">
            <details className="pi-section" open>
              <summary>
                <h3>
                  <ShieldCheck size={15} />
                  Team health
                </h3>
                <span>Starter alternatives</span>
              </summary>
              {insight.alternatives.length ? (
                <div className="pi-alternatives">
                  {insight.alternatives.map((item) => {
                    const locked = Boolean(lockedIds?.includes(item.player.id));
                    return (
                      <div
                        className="pi-alternative"
                        key={`${item.replacement.id}-${item.player.id}`}
                      >
                        <Name player={item.replacement} onDetail={onDetail} />
                        <ArrowRight size={13} />
                        <Name player={item.player} onDetail={onDetail} />
                        <div className="pi-upgrade">
                          <b className="pi-positive">+{fmt(item.gain)}</b>
                          <small>
                            {money(item.player.price)} ·{" "}
                            {item.gameweeks.length} GW
                            {item.gameweeks.length === 1 ? "" : "s"}
                          </small>
                        </div>
                        {onLock ? (
                          <button
                            className={`pi-lock ${locked ? "active" : ""}`.trim()}
                            aria-pressed={locked}
                            onClick={() => onLock(item.player.id)}
                            title={
                              locked
                                ? `Unlock ${item.player.name} in the optimiser`
                                : `Lock ${item.player.name} in the optimiser`
                            }
                            aria-label={`Lock ${item.player.name} in the optimiser`}
                          >
                            <LockKeyhole size={13} />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="pi-empty">
                  {completeRows.length
                    ? "No clear cheaper starter upgrades."
                    : "Forecasts needed to compare starters."}
                </p>
              )}
              <details className="pi-method">
                <summary>Comparison rules</summary>
                <p>
                  Same position and club-legal, at or below current price,
                  outside planned squads, gaining &gt;0.5 xPts over started GWs.
                  Run solver to check bank, sale prices and hits.
                </p>
              </details>
            </details>

            <details className="pi-section" open>
              <summary>
                <h3>Transfer value</h3>
                <span>
                  {insight.matched.length}/{count} matched weeks
                </span>
              </summary>
              <div className="pi-comparison">
                <div>
                  <small>Hold initial squad</small>
                  <b>{value(insight.holdingPoints)}</b>
                </div>
                <ArrowRight size={15} />
                <div>
                  <small>This plan, net</small>
                  <b>
                    {value(
                      insight.matched.length
                        ? insight.matched.reduce(
                            (sum, row) => sum + row.netPoints!,
                            0,
                          )
                        : null,
                    )}
                  </b>
                </div>
                <strong className={deltaClass(insight.transferGain)}>
                  {signed(insight.transferGain)}
                </strong>
              </div>
              <div
                className="pi-mini-timeline"
                aria-label="Weekly gain against holding"
              >
                {rows.map((row) => {
                  const gain =
                    row.netPoints === null || row.holdingPoints === null
                      ? null
                      : row.netPoints - row.holdingPoints;
                  return (
                    <div
                      key={row.week.gw}
                      className={
                        row.week.gw === selectedGW ? "pi-selected-gw" : ""
                      }
                    >
                      <small>GW{row.week.gw}</small>
                      <b className={deltaClass(gain)}>{signed(gain)}</b>
                    </div>
                  );
                })}
              </div>
              <details className="pi-method">
                <summary>What is compared?</summary>
                <p>
                  Baseline holds the initial 15 (no transfers/hits, Best-XI
                  lineup and captain, same chips) across matched forecast weeks.
                  Includes lineup and captain differences.
                </p>
              </details>
            </details>

            <details className="pi-section" open>
              <summary>
                <h3>Points DNA</h3>
                <span>Gross {value(insight.componentPoints)} xPts</span>
              </summary>
              {completeRows.length ? (
                <>
                  <div className="pi-dna">
                    {groups
                      .filter((group) => Math.abs(group.points) > 1e-8)
                      .map((group) => (
                        <Bar
                          key={group.label}
                          label={group.label}
                          points={group.points}
                          max={dnaMax}
                        />
                      ))}
                    <Bar
                      label="Expected autosubs"
                      points={insight.autosubs}
                      max={dnaMax}
                      subtle
                    />
                    <Bar
                      label="Vice-captain fallback"
                      points={insight.vice}
                      max={dnaMax}
                      subtle
                    />
                  </div>
                  <div className="pi-dna-total">
                    <span>Gross − hits = net</span>
                    <b>
                      {value(insight.componentPoints)} −{" "}
                      {fmt(
                        completeRows.reduce(
                          (sum, row) => sum + row.week.hits,
                          0,
                        ),
                        0,
                      )}{" "}
                      ={" "}
                      {fmt(
                        completeRows.reduce(
                          (sum, row) => sum + row.netPoints!,
                          0,
                        ),
                      )}
                    </b>
                  </div>
                </>
              ) : (
                <p className="pi-empty">Complete squad forecasts needed.</p>
              )}
              <details className="pi-method">
                <summary>Components & scoring</summary>
                <div className="pi-component-list">
                  {Object.entries(components)
                    .filter(([, points]) => Math.abs(points) > 1e-8)
                    .map(([key, points]) => (
                      <div key={key}>
                        <span>
                          {componentLabels[key] ?? key.replaceAll("_", " ")}
                        </span>
                        <b>{fmt(points, 2)}</b>
                      </div>
                    ))}
                </div>
                <p>
                  Includes doubles, captaincy, TC and BB. Provider/manual
                  adjustments, autosubs, vice fallback and hits stay separate.{" "}
                  {completeRows.length !== count
                    ? "Complete weeks only. "
                    : ""}
                  {staleScores
                    ? "Uses refreshed forecasts rather than stored totals."
                    : ""}
                </p>
              </details>
            </details>

            <details className="pi-section" open>
              <summary>
                <h3>Bench cover</h3>
                <span>Independent appearances</span>
              </summary>
              <div className="pi-risk-summary">
                <div>
                  <b>{percent(avgAbsence)}</b>
                  <small>
                    {count === 1
                      ? "Any starter absent"
                      : "Avg weekly absence chance"}
                  </small>
                </div>
                <div>
                  <b>{value(expectedMissing, 2)}</b>
                  <small>Expected missing starters / GW</small>
                </div>
              </div>
              <div className="pi-risk-rows">
                {rows.map((row) => (
                  <div
                    key={row.week.gw}
                    className={
                      row.week.gw === selectedGW ? "pi-selected-gw" : ""
                    }
                  >
                    <span>GW{row.week.gw}</span>
                    <div className="pi-risk-track" aria-hidden="true">
                      <i
                        style={{
                          width: `${(row.anyStarterAbsent ?? 0) * 100}%`,
                        }}
                      />
                    </div>
                    <b>{percent(row.anyStarterAbsent)}</b>
                    <small>
                      {row.week.chip === "benchboost"
                        ? "BB active"
                        : `${signed(row.autosubs)} cover`}
                    </small>
                  </div>
                ))}
              </div>
              <details className="pi-method">
                <summary>Bench availability & method</summary>
                <div className="pi-component-list">
                  {rows.map((row) => (
                    <div key={row.week.gw}>
                      <span>GW{row.week.gw}: expected reserves playing</span>
                      <b>{value(row.expectedReserves, 2)} / 4</b>
                    </div>
                  ))}
                </div>
                <p>
                  1 − product of starter play probabilities (including doubles).
                  Cover xPts respect GK/formation order; assumes independence,
                  not calibrated risk.
                </p>
              </details>
            </details>

            <details className="pi-section pi-wide" open>
              <summary>
                <h3>Bank & free transfers</h3>
                <span>Saved plan resources</span>
              </summary>
              <div
                className="pi-resources"
                aria-label="Bank and free transfer timeline"
              >
                {weeks.map((week) => (
                  <div
                    className={`${week.bank < 0.5 ? "pi-tight-bank" : ""} ${week.hits ? "pi-hit-week" : ""} ${week.gw === selectedGW ? "pi-selected-gw" : ""}`.trim()}
                    key={week.gw}
                  >
                    <b>GW{week.gw}</b>
                    <strong>{money(week.bank)}</strong>
                    <span>
                      {week.free_transfers} FT → {week.next_free_transfers}
                    </span>
                    <small>
                      {week.hits
                        ? `−${week.hits} hit pts`
                        : week.chip === "wildcard"
                          ? "Wildcard"
                          : week.chip === "freehit"
                            ? "Free Hit"
                            : week.transfers_in.length
                              ? `${week.transfers_in.length} move${week.transfers_in.length === 1 ? "" : "s"}`
                              : "Roll"}
                    </small>
                  </div>
                ))}
              </div>
            </details>

            <details className="pi-section" open>
              <summary>
                <h3>Key bets</h3>
                <span>Official ownership</span>
              </summary>
              <div className="pi-exposure-head">
                <span>Player</span>
                <span>Copies</span>
                <span>Owned</span>
                <span>xPts</span>
              </div>
              <div className="pi-exposures">
                {insight.exposures.slice(0, 6).map((item) => (
                  <div key={item.player.id}>
                    <Name player={item.player} onDetail={onDetail} />
                    <small title="Average scoring copies per planned gameweek; includes captain and chips">
                      {fmt(item.copies / count, 2)}×
                    </small>
                    <span>
                      {item.ownership === null
                        ? "—"
                        : `${fmt(item.ownership, 1)}%`}
                    </span>
                    <b>{value(item.points)}</b>
                  </div>
                ))}
              </div>
              <details className="pi-method">
                <summary>Exposure source</summary>
                <p>
                  Copies = mean scoring multiplier per GW before fallback. Owned
                  = current official FPL selection (not projected EO or rank
                  risk).
                </p>
              </details>
            </details>

            <details className="pi-section" open>
              <summary>
                <h3>Club exposure</h3>
                <span>Before fallback</span>
              </summary>
              <div className="pi-team-bars">
                {insight.teams.map((team) => (
                  <div
                    key={team.id}
                    title={`${team.name} · ${team.players} distinct players`}
                  >
                    <span>{team.short}</span>
                    <div className="pi-bar-track" aria-hidden="true">
                      <i
                        style={{
                          width: `${Math.min(100, (Math.abs(team.points ?? 0) / maxTeamPoints) * 100)}%`,
                        }}
                      />
                    </div>
                    <small>
                      {team.players} player{team.players === 1 ? "" : "s"}
                    </small>
                    <b>{value(team.points)}</b>
                  </div>
                ))}
              </div>
              <small className="pi-source-note">
                Starter, captain and chip points. Autosubs and vice fallback
                stay separate.
              </small>
            </details>
          </div>
          <details className="pi-inputs">
            <summary>Forecast coverage & sources</summary>
            <p>
              {data.model_version} · Loaded {loadedAt}
            </p>
            <p>{actualWeeks}</p>
            {rows
              .filter((row) => !row.complete)
              .map((row) => (
                <p key={row.week.gw}>
                  GW{row.week.gw}:{" "}
                  {row.missing.length
                    ? `unavailable forecasts: ${row.missing.map((id) => data.players.find((player) => player.id === id)?.name ?? `#${id}`).join(", ")}`
                    : "a complete legal squad is needed"}
                  .
                </p>
              ))}
            <p>
              {data.forecast_layers
                ?.map(
                  (layer) =>
                    `${layer.name}${typeof layer.weight === "number" && Number.isFinite(layer.weight) ? ` ${fmt(layer.weight * 100, 0)}%` : ""}`,
                )
                .join(" · ") || "Component model"}
              . Fixture/player details show direct, extrapolated and scenario
              inputs.
            </p>
          </details>
        </>
      )}
    </div>
  );
}

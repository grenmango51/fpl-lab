import { useMemo, useState } from "react";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { Badge } from "./components";
import { fmt, money } from "./lib";
import { planInsights } from "./planInsightModel";
import type { InsightScope } from "./planInsightModel";
import type { Bootstrap, Plan, Player } from "./types";
import "./plan-insights.css";

const componentLabels: Record<string, string> = {
  appearance: "Appearance", goals: "Goals", assists: "Assists",
  clean_sheet: "Clean sheets", defensive: "Defensive contributions",
  bonus: "Bonus", saves: "Saves", penalty_saves: "Penalty saves",
  deductions: "Cards / goals conceded", provider_adjustment: "Provider adjustment",
  imported_adjustment: "Imported points adjustment", user_points_adjustment: "Your points adjustment",
  unassigned_forecast: "Unassigned forecast residual",
};
const value = (points: number | null, digits = 1) => points === null ? "—" : fmt(points, digits);
const signed = (points: number | null) => points === null ? "—" : `${points >= 0 ? "+" : ""}${fmt(points)}`;
const percent = (probability: number | null) => probability === null ? "—" : `${fmt(probability * 100, 0)}%`;

function Name({ player, onDetail }: { player: Player; onDetail: (id: number) => void }) {
  return <button className="pi-player-name" onClick={() => onDetail(player.id)}><Badge player={player} size={21}/><span>{player.name}<small>{player.team_short} · {player.position}</small></span></button>;
}

function Bar({ label, points, max, subtle = false }: { label: string; points: number; max: number; subtle?: boolean }) {
  return <div className={`pi-bar-row ${subtle ? "pi-bar-subtle" : ""}`}>
    <span>{label}</span><div className="pi-bar-track" aria-hidden="true"><i className={points < 0 ? "negative" : ""} style={{width: `${Math.min(100, Math.abs(points) / Math.max(1, max) * 100)}%`}}/></div><b>{fmt(points)}</b>
  </div>;
}

export function PlanInsights({ data, plan, selectedGW, onDetail, onLock }: {
  data: Bootstrap;
  plan: Plan;
  selectedGW: number;
  onDetail: (id: number) => void;
  onLock?: (id: number) => void;
}) {
  const [scope, setScope] = useState<InsightScope>("horizon");
  const insight = useMemo(() => planInsights(data, plan, selectedGW, scope), [data, plan, selectedGW, scope]);
  const { weeks, rows, components, completeRows } = insight;
  const actualWeeks = weeks.map((week) => `GW${week.gw}`).join(", ");
  const count = weeks.length;
  const groups = [
    { label: "Appearance", keys: ["appearance"] },
    { label: "Goals & assists", keys: ["goals", "assists"] },
    { label: "Clean sheets & defending", keys: ["clean_sheet", "defensive"] },
    { label: "Bonus & saves", keys: ["bonus", "saves", "penalty_saves"] },
    { label: "Deductions", keys: ["deductions"] },
    { label: "Provider / your adjustments", keys: ["provider_adjustment", "imported_adjustment", "user_points_adjustment"] },
  ].map((group) => ({ label: group.label, points: group.keys.reduce((sum, key) => sum + (components[key] ?? 0), 0) }));
  const knownComponents = new Set(["appearance", "goals", "assists", "clean_sheet", "defensive", "bonus", "saves", "penalty_saves", "deductions", "provider_adjustment", "imported_adjustment", "user_points_adjustment"]);
  const other = Object.entries(components).reduce((sum, [key, points]) => sum + (knownComponents.has(key) ? 0 : points), 0);
  if (Math.abs(other) > 1e-8) groups.push({ label: "Other / unassigned", points: other });
  const dnaMax = Math.max(1, ...groups.map((group) => Math.abs(group.points)), insight.autosubs, insight.vice);
  const knownRisks = rows.filter((row) => row.anyStarterAbsent !== null);
  const avgAbsence = knownRisks.length ? knownRisks.reduce((sum, row) => sum + row.anyStarterAbsent!, 0) / knownRisks.length : null;
  const expectedMissing = knownRisks.length ? knownRisks.reduce((sum, row) => sum + row.expectedMissing!, 0) / knownRisks.length : null;
  const staleScores = completeRows.filter((row) => Math.abs(row.week.points - row.points!) > 0.05).length;
  const maxTeamPoints = Math.max(1, ...insight.teams.map((team) => Math.abs(team.points ?? 0)));

  return <div className="plan-insights">
    <header className="pi-heading"><div><h2>Plan insights</h2><span title={actualWeeks}>{scope === "gameweek" ? `GW${selectedGW}` : `${count} planned gameweeks`} · Current forecasts</span></div><div className="pi-scope" aria-label="Insights period">{(["horizon", "gameweek"] as const).map((item) => <button key={item} aria-pressed={scope === item} className={scope === item ? "active" : ""} onClick={() => setScope(item)}>{item === "horizon" ? "Horizon" : "Gameweek"}</button>)}</div></header>
    {!count ? <p className="pi-empty">No plan for GW{selectedGW}.</p> : <>
      <div className="pi-summary">
        <div><small>Net xPts</small><strong>{value(insight.netPoints)}</strong></div>
        <div><small>Vs holding</small><strong className={insight.transferGain !== null && insight.transferGain < 0 ? "pi-negative" : "pi-positive"}>{signed(insight.transferGain)}</strong></div>
        <div><small>Transfer hits</small><strong>{insight.hits ? `−${fmt(insight.hits, 0)}` : "0"}</strong></div>
        <div><small>Transfers</small><strong>{weeks.reduce((sum, week) => sum + week.transfers_in.length, 0)}</strong></div>
      </div>
      {completeRows.length !== count ? <p className="pi-coverage" role="status">Forecast coverage: {completeRows.length}/{count} weeks. Missing rows stay unavailable.</p> : null}
      <div className="pi-grid">
        <section className="pi-section">
          <header><h3><ShieldCheck size={15}/>Team health</h3><span>Starter alternatives</span></header>
          {insight.alternatives.length ? <div className="pi-alternatives">{insight.alternatives.map((item) => <div className="pi-alternative" key={`${item.replacement.id}-${item.player.id}`}>
            <Name player={item.replacement} onDetail={onDetail}/><ArrowRight size={13}/><Name player={item.player} onDetail={onDetail}/>
            <div className="pi-upgrade"><b className="pi-positive">+{fmt(item.gain)}</b><small>{money(item.player.price)} · {item.gameweeks.length} GW{item.gameweeks.length === 1 ? "" : "s"}</small></div>
            {onLock ? <button className="pi-lock" onClick={() => onLock(item.player.id)} title={`Lock ${item.player.name} in the optimiser`} aria-label={`Lock ${item.player.name} in the optimiser`}><LockKeyhole size={13}/></button> : null}
          </div>)}</div> : <p className="pi-empty">{completeRows.length ? "No clear cheaper starter upgrades." : "Forecasts needed to compare starters."}</p>}
          <details className="pi-method"><summary>Comparison rules</summary><p>Same position, same or lower current price, outside this plan's squads, club limit screened. More than +0.5 xPts over that player's starting weeks. Individual suggestions; bank, sale prices, hits and future transfers need a solver check.</p></details>
        </section>

        <section className="pi-section">
          <header><h3>Transfer value</h3><span>{insight.matched.length}/{count} matched weeks</span></header>
          <div className="pi-comparison"><div><small>This plan, net</small><b>{value(insight.matched.length ? insight.matched.reduce((sum, row) => sum + row.netPoints!, 0) : null)}</b></div><ArrowRight size={15}/><div><small>Hold starting squad</small><b>{value(insight.holdingPoints)}</b></div><strong className={insight.transferGain !== null && insight.transferGain < 0 ? "pi-negative" : "pi-positive"}>{signed(insight.transferGain)}</strong></div>
          <div className="pi-mini-timeline" aria-label="Weekly gain against holding">{rows.map((row) => { const gain = row.netPoints === null || row.holdingPoints === null ? null : row.netPoints - row.holdingPoints; return <div key={row.week.gw}><small>GW{row.week.gw}</small><b className={gain !== null && gain < 0 ? "pi-negative" : "pi-positive"}>{signed(gain)}</b></div>; })}</div>
          <details className="pi-method"><summary>What is compared?</summary><p>Hold the original 15 with no transfers or hits. Reselect the XI, captain and bench using the Best-XI shortcut, with the same chips. Both sides use current forecasts and identical available weeks. This includes lineup and captain choices, so it is not an isolated transfer effect.</p></details>
        </section>

        <section className="pi-section">
          <header><h3>Points DNA</h3><span>Gross {value(insight.componentPoints)} xPts</span></header>
          {completeRows.length ? <><div className="pi-dna">{groups.filter((group) => Math.abs(group.points) > 1e-8).map((group) => <Bar key={group.label} label={group.label} points={group.points} max={dnaMax}/>)}<Bar label="Expected autosubs" points={insight.autosubs} max={dnaMax} subtle/><Bar label="Vice-captain fallback" points={insight.vice} max={dnaMax} subtle/></div><div className="pi-dna-total"><span>Gross − hits = net</span><b>{value(insight.componentPoints)} − {fmt(completeRows.reduce((sum, row) => sum + row.week.hits, 0), 0)} = {fmt(completeRows.reduce((sum, row) => sum + row.netPoints!, 0))}</b></div></> : <p className="pi-empty">Complete squad forecasts needed.</p>}
          <details className="pi-method"><summary>Components & scoring</summary><div className="pi-component-list">{Object.entries(components).filter(([, points]) => Math.abs(points) > 1e-8).map(([key, points]) => <div key={key}><span>{componentLabels[key] ?? key.replaceAll("_", " ")}</span><b>{fmt(points, 2)}</b></div>)}</div><p>Fixture components include both games of doubles. Captain copies, Triple Captain and Bench Boost are counted. Provider/manual point adjustments remain separate; autosubs and vice fallback have no invented event breakdown. Hits are separate. {completeRows.length !== count ? "Only complete weeks are included here. " : ""}{staleScores ? "Saved plan totals differ; these values use refreshed forecasts." : ""}</p></details>
        </section>

        <section className="pi-section">
          <header><h3>Bench cover</h3><span>Independent appearances</span></header>
          <div className="pi-risk-summary"><div><b>{percent(avgAbsence)}</b><small>{count === 1 ? "Any starter absent" : "Avg weekly absence chance"}</small></div><div><b>{value(expectedMissing, 2)}</b><small>Expected missing starters / GW</small></div></div>
          <div className="pi-risk-rows">{rows.map((row) => <div key={row.week.gw}><span>GW{row.week.gw}</span><div className="pi-risk-track" aria-hidden="true"><i style={{width: `${(row.anyStarterAbsent ?? 0) * 100}%`}}/></div><b>{percent(row.anyStarterAbsent)}</b><small>{row.week.chip === "benchboost" ? "BB counts reserves" : `${signed(row.autosubs)} cover xPts`}</small></div>)}</div>
          <details className="pi-method"><summary>Bench availability & method</summary><div className="pi-component-list">{rows.map((row) => <div key={row.week.gw}><span>GW{row.week.gw}: expected reserves playing</span><b>{value(row.expectedReserves, 2)} / 4</b></div>)}</div><p>Chance of any absent starter is 1 − the product of starter appearance probabilities. Double-gameweek appearances account for either fixture. Bench cover points respect keeper cover, order and formation; an available bench does not guarantee cover. Independence is an approximation, not calibrated uncertainty.</p></details>
        </section>

        <section className="pi-section pi-wide">
          <header><h3>Bank & free transfers</h3><span>Saved plan resources</span></header>
          <div className="pi-resources" aria-label="Bank and free transfer timeline">{weeks.map((week) => <div className={`${week.bank < 0.5 ? "pi-tight-bank" : ""} ${week.hits ? "pi-hit-week" : ""}`} key={week.gw}><b>GW{week.gw}</b><strong>{money(week.bank)}</strong><span>{week.free_transfers} FT → {week.next_free_transfers}</span><small>{week.hits ? `−${week.hits} hit points` : week.chip === "wildcard" ? "Wildcard" : week.chip === "freehit" ? "Free Hit" : week.transfers_in.length ? `${week.transfers_in.length} moves` : "Roll"}</small></div>)}</div>
        </section>

        <section className="pi-section">
          <header><h3>Key bets</h3><span>Official ownership</span></header>
          <div className="pi-exposure-head"><span>Scoring exposure</span><span>Owned</span><span>xPts</span></div>
          <div className="pi-exposures">{insight.exposures.slice(0, 6).map((item) => <div key={item.player.id}><Name player={item.player} onDetail={onDetail}/><small title="Average scoring copies per planned gameweek; includes captain and chips">{fmt(item.copies / count, 2)}×</small><span>{item.ownership === null ? "—" : `${fmt(item.ownership, 1)}%`}</span><b>{value(item.points)}</b></div>)}</div>
          <details className="pi-method"><summary>Exposure source</summary><p>× is your average scoring copies per planned GW, before fallback. Owned is current official FPL selection, without projected captaincy or a manager sample. These are not Solio projected effective ownership or rank-risk estimates.</p></details>
        </section>

        <section className="pi-section">
          <header><h3>Club exposure</h3><span>Before fallback</span></header>
          <div className="pi-team-bars">{insight.teams.map((team) => <div key={team.id} title={`${team.name} · ${team.players} distinct players`}><span>{team.short}</span><div className="pi-bar-track" aria-hidden="true"><i style={{width: `${Math.min(100, Math.abs(team.points ?? 0) / maxTeamPoints * 100)}%`}}/></div><small>{team.players} player{team.players === 1 ? "" : "s"}</small><b>{value(team.points)}</b></div>)}</div>
          <small className="pi-source-note">Starter, captain and chip points. Autosubs and vice fallback stay separate.</small>
        </section>
      </div>
      <details className="pi-inputs"><summary>Forecast coverage & sources</summary><p>{data.model_version} · Loaded {new Date(data.loaded_at).toLocaleString()}</p><p>{actualWeeks}</p>{rows.filter((row) => !row.complete).map((row) => <p key={row.week.gw}>GW{row.week.gw}: {row.missing.length ? `unavailable forecasts: ${row.missing.map((id) => data.players.find((player) => player.id === id)?.name ?? `#${id}`).join(", ")}` : "a complete legal squad is needed"}.</p>)}<p>{data.forecast_layers?.map((layer) => `${layer.name}${Number.isFinite(layer.weight) ? ` ${fmt(layer.weight * 100, 0)}%` : ""}`).join(" · ") || "Component model"}. Fixture/player details show direct, extrapolated and human-scenario inputs.</p></details>
    </>}
  </div>;
}

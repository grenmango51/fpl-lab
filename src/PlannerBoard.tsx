import { ArrowRight, ChevronLeft, ChevronRight, Copy, GitBranch, Info, RefreshCw, Sparkles, X } from "lucide-react";
import { Pitch } from "./components";
import { chipNames, fmt, money, xp } from "./lib";
import type { Bootstrap, Chip, Plan, Player, Week } from "./types";

export function PlannerBoard({ data, plan, week, selected, busy, onWeek, onName, onHorizon, onClone, onSelect, onDetail, onBenchSwap, onCaptain, onBenchMove, onChip, onBestXI, onReset, onTransfers, onTeam, draft, previewing, onPreview }: {
  data: Bootstrap; plan: Plan; week: Week; selected: number | null; busy: boolean;
  onWeek: (gw: number) => void; onName: (name: string) => void; onHorizon: (horizon: number) => void; onClone: () => void;
  onSelect: (id: number | null) => void; onDetail: (id: number) => void; onBenchSwap: (id: number) => void;
  onCaptain: (id: number, vice?: boolean) => void; onBenchMove: (direction: number) => void;
  onChip: (chip: Chip) => void; onBestXI: () => void; onReset: () => void; onTransfers: () => void; onTeam: () => void;
  draft?: Week[]; previewing: boolean; onPreview: (previewing: boolean) => void;
}) {
  const lookup = new Map(data.players.map(player => [player.id, player]));
  const chosen: Player | undefined = selected === null ? undefined : lookup.get(selected);
  const weeks = previewing && draft?.length ? draft : plan.weeks;
  const total = weeks.reduce((sum, item) => sum + (item.net_points ?? item.points), 0);
  const firstGW = plan.weeks[0]?.gw ?? data.next_gw;
  const remaining = data.gameweeks.filter(gw => gw >= firstGW).length;
  const formation = [2, 3, 4].map(pos => week.starters.filter(id => lookup.get(id)?.position_id === pos).length).join("–");
  const index = weeks.findIndex(item => item.gw === week.gw);
  return <section className="planner-board" aria-label="Team planner">
    <header className="board-plan-header">
      <GitBranch size={14} />
      <input aria-label="Plan name" value={plan.name} onChange={event => onName(event.target.value.slice(0, 70))} />
      <button className="icon-button" aria-label="Duplicate plan" onClick={onClone}><Copy size={14} /></button>
      <select aria-label="Planner horizon" value={plan.weeks.length} onChange={event => onHorizon(+event.target.value)}>
        {[...new Set([plan.weeks.length, 3, 5, 6, 10, 14, 20, remaining])].filter(n => n <= remaining).sort((a,b) => a-b).map(n => <option key={n} value={n}>{n} GWs</option>)}
      </select>
    </header>
    <div className="board-metrics">
      <button onClick={onTeam} title="Edit starting bank and free transfers"><span>Free transfers</span><b>{week.free_transfers}<small> / 5</small></b></button>
      <button onClick={onTeam} title="Edit starting bank"><span>In the bank</span><b>{money(week.bank)}</b></button>
      <div title="Captain, expected substitutions and hits included"><span>GW{week.gw} xPts</span><b className="orange">{fmt(week.net_points ?? week.points)}</b></div>
      <div title={`GW${weeks[0]?.gw}–${weeks.at(-1)?.gw}`}><span>{weeks.length} GW total</span><b>{fmt(total)}</b></div>
    </div>
    {draft?.length ? <div className="board-comparison segmented">
      <button className={!previewing ? "active" : ""} onClick={() => onPreview(false)}>Current plan</button>
      <button className={previewing ? "active" : ""} onClick={() => onPreview(true)}>Optimised draft</button>
    </div> : null}
    <div className="board-week-bar">
      <div><button className="icon-button" aria-label="Previous gameweek" disabled={index <= 0} onClick={() => onWeek(weeks[index-1].gw)}><ChevronLeft size={17}/></button><b>GW{week.gw}</b><button className="icon-button" aria-label="Next gameweek" disabled={index < 0 || index >= weeks.length-1} onClick={() => onWeek(weeks[index+1].gw)}><ChevronRight size={17}/></button><small>{formation}</small></div>
      <button className="icon-button" aria-label="Reset this gameweek" disabled={busy || previewing} onClick={onReset}><RefreshCw size={14}/></button>
    </div>
    <Pitch week={week} players={data.players} selected={previewing ? null : selected} onSelect={previewing ? onDetail : id => onSelect(selected === id ? null : id)} onDetail={onDetail} onBenchSwap={onBenchSwap}/>
    <div className="board-chips" aria-label="Gameweek chips">
      {(["none", "wildcard", "freehit", "benchboost", "triplecaptain"] as Chip[]).map(chip => <button key={chip} className={week.chip === chip ? "active" : ""} disabled={busy || previewing || (chip !== "none" && Boolean(plan.used_chips?.some(used => used.chip === chip && (used.gw <= 19) === (week.gw <= 19))))} onClick={() => onChip(chip)} title={chipNames[chip]}>{({none:"No chip",wildcard:"WC",freehit:"FH",benchboost:"BB",triplecaptain:"TC"})[chip]}</button>)}
      <button className="best-xi" disabled={busy || previewing} onClick={onBestXI}><Sparkles size={12}/>Best XI</button>
    </div>
    {chosen && !previewing ? <section className="board-player-actions">
      <div><b>{chosen.name}</b><small>{chosen.position} · {money(chosen.price)} · {fmt(xp(chosen, week.gw))} xPts</small><button className="icon-button" aria-label="Clear player selection" onClick={() => onSelect(null)}><X size={13}/></button></div>
      <div className="button-row"><button className="button small" disabled={busy || !week.starters.includes(chosen.id)} onClick={() => onCaptain(chosen.id)}>Captain</button><button className="button small" disabled={busy || !week.starters.includes(chosen.id)} onClick={() => onCaptain(chosen.id, true)}>Vice</button><button className="button small" onClick={() => onDetail(chosen.id)}><Info size={12}/>Stats</button><button className="button primary small" onClick={onTransfers}>Transfer<ArrowRight size={12}/></button></div>
      {week.bench.includes(chosen.id) && chosen.position_id !== 1 ? <div className="button-row"><button className="button small" disabled={busy || week.bench.indexOf(chosen.id)<=1} onClick={() => onBenchMove(-1)}>Bench ↑</button><button className="button small" disabled={busy || week.bench.indexOf(chosen.id)>=3} onClick={() => onBenchMove(1)}>Bench ↓</button></div> : null}
      <small className="board-hint">Select a starter, then a bench shirt to substitute.</small>
    </section> : <div className="board-hint">{previewing ? "Draft preview · apply it to save a new branch" : "Select a shirt to captain, substitute or transfer"}</div>}
    <section className="board-transfers">
      <header><b>Transfers</b><span>{week.hits ? `−${week.hits} pts` : "No hit"}</span></header>
      {week.transfers_in.length ? week.transfers_in.map((id, i) => <div key={id}><button onClick={() => onDetail(week.transfers_out[i])}>{lookup.get(week.transfers_out[i])?.name ?? "New squad"}</button><ArrowRight size={12}/><button onClick={() => onDetail(id)} className="green">{lookup.get(id)?.name}</button></div>) : <small>Roll · {week.next_free_transfers} FT next week</small>}
    </section>
    <div className="board-timeline" aria-label="Gameweek timeline">{weeks.map(item => <button key={item.gw} className={item.gw === week.gw ? "active" : ""} onClick={() => onWeek(item.gw)} title={`${money(item.bank)} ITB · ${item.next_free_transfers} FT next`}><span>GW{item.gw}</span><b>{fmt(item.net_points ?? item.points)}</b><small>{item.chip === "none" ? item.transfers_in.length ? `${item.transfers_in.length} moves` : "Roll" : ({wildcard:"WC",freehit:"FH",benchboost:"BB",triplecaptain:"TC"})[item.chip]}</small></button>)}</div>
  </section>;
}

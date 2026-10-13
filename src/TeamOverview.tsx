import { ArrowRight, Info, Star } from "lucide-react";
import { Badge, PlayerName } from "./components";
import { fmt, money, xp } from "./lib";
import type { Bootstrap, Player, Week } from "./types";

export function TeamOverview({ data, week, selected, targets, watch, onWatch, onDetail, onSelect, onTransfer, onPlayers, onCaptain }: {
  data: Bootstrap; week: Week; selected?: Player | null; targets: Player[]; watch: number[];
  onWatch: (id: number) => void; onDetail: (id: number) => void; onSelect: (id: number) => void; onTransfer: (id: number) => void; onPlayers: () => void; onCaptain: (id: number) => void;
}) {
  const lookup = new Map(data.players.map(player => [player.id, player]));
  const squad = [...week.starters, ...week.bench].map(id => lookup.get(id)!).filter(Boolean);
  const captainOptions = squad.filter(player => week.starters.includes(player.id)).sort((a,b) => xp(b, week.gw)-xp(a,week.gw)).slice(0,4);
  return <div className="team-overview">
    <div className="view-heading compact-view-heading"><h2>Lineup</h2><span className="subtle-tag">GW{week.gw}</span></div>
    <div className="overview-captains"><header><h3>Captain comparison</h3><small>Captain xPts</small></header><div>{captainOptions.map(player => <button key={player.id} className={player.id === week.captain ? "active" : ""} onClick={() => onCaptain(player.id)}><Badge player={player} size={26}/><b>{player.name}</b><strong>{fmt(xp(player,week.gw)*(week.chip === "triplecaptain" ? 3 : 2))}</strong><span>{player.id === week.captain ? "Captain" : player.gw[String(week.gw)]?.fixtures.map(f=>`${f.opponent} ${f.home?"H":"A"}`).join(" + ") || "Blank"}</span></button>)}</div></div>
    <section className="overview-targets"><header><h3>{selected ? `Replace ${selected.name}` : "Transfer shortlist"}</h3><button onClick={onPlayers}>All players<ArrowRight size={13}/></button></header><div className="overview-target-list">{targets.slice(0,5).map(player => <div key={player.id}><PlayerName player={player} onClick={()=>onDetail(player.id)}/><span>{money(player.price)}</span><b>{fmt(xp(player,week.gw))}</b>{selected ? <button className="button small primary" onClick={()=>onTransfer(player.id)}>In</button> : <button className={`icon-button ${watch.includes(player.id)?"starred":""}`} aria-label={`Watch ${player.name}`} onClick={()=>onWatch(player.id)}><Star size={13}/></button>}</div>)}</div></section>
    <section><header className="overview-table-header"><h3>Squad projections</h3><small>Select a player to make a move</small></header><div className="table-container"><table className="data-table squad-table"><thead><tr><th>Player</th><th>Price</th><th>xMins</th><th>Fixture</th><th>xPts</th><th></th></tr></thead><tbody>{squad.map(player=>{ const forecast=player.gw[String(week.gw)]; return <tr key={player.id} className={`${week.bench.includes(player.id)?"bench-table-row":""} ${selected?.id===player.id?"selected-table-row":""}`}><td><button className="squad-name" onClick={()=>onSelect(player.id)}><Badge player={player} size={20}/><span>{player.name}<small>{player.position}{week.bench.includes(player.id)?" · Bench":""}</small></span>{player.id===week.captain?<b className="role-pill">C</b>:player.id===week.vice?<b className="role-pill">V</b>:null}</button></td><td>{money(player.price)}</td><td>{fmt(forecast?.xmins??0,0)}</td><td className="muted">{forecast?.fixtures.map(f=>`${f.opponent} (${f.home?"H":"A"})`).join(" + ")||"Blank"}</td><td className="orange numeric"><b>{fmt(xp(player,week.gw))}</b></td><td><button className="icon-button" aria-label={`Edit ${player.name} stats`} onClick={()=>onDetail(player.id)}><Info size={13}/></button></td></tr>;})}</tbody></table></div></section>
  </div>;
}

import { Copy, GitBranch, Minus, Plus, Settings2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmt, money } from "./lib";
import type { Bootstrap, Plan } from "./types";

export function PlanTree({data, plans, active, gw, onPlan, onWeek, onCreate, onDelete, onConfigure, onHorizon, onOptimise}: {
  data: Bootstrap; plans: Plan[]; active: Plan|null; gw: number; onPlan: (id:string)=>void; onWeek: (gw:number)=>void;
  onCreate: ()=>void; onDelete: ()=>void; onConfigure: ()=>void; onHorizon:(horizon:number)=>void; onOptimise:()=>void;
}) {
  const [zoom, setZoom] = useState(1);
  const [canvasSize, setCanvasSize] = useState("");
  const [displayWeeks, setDisplayWeeks] = useState(5);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mobileWeeksRef = useRef<HTMLDivElement>(null);
  const mobileSelectedWeekRef = useRef<HTMLButtonElement>(null);
  const lastFitSize = useRef("");
  const drag = useRef<{x:number;y:number;left:number;top:number}|null>(null);
  const lookup = new Map(data.players.map(player=>[player.id,player]));
  const firstGW = active?.weeks[0]?.gw ?? data.next_gw;
  const remaining = data.gameweeks.filter(week=>week>=firstGW).length;
  const calendarWeeks = [...new Set(plans.flatMap(plan=>plan.weeks.map(week=>week.gw)))].sort((a,b)=>a-b);
  const shown = Math.max(1, Math.min(displayWeeks, calendarWeeks.length || 1));
  const activeIndex = Math.max(0,calendarWeeks.indexOf(gw));
  const windowStart = Math.floor(activeIndex / shown) * shown;
  const visibleGameweeks = calendarWeeks.slice(windowStart,windowStart+shown);
  const visibleWeeks = (plan:Plan)=>plan.weeks.filter(week=>visibleGameweeks.includes(week.gw));
  const column = (gameweek:number)=>visibleGameweeks.indexOf(gameweek);
  const horizonOptions = [...new Set([active?.weeks.length ?? 0,3,5,6,10,14,20,remaining])].sort((a,b)=>a-b).filter(n=>n>0&&(n<=remaining||n===active?.weeks.length));
  const width = 395 + shown * 146;
  const height = Math.max(650,plans.length * 270 + 170);
  function fit(){const node=canvasRef.current;if(node?.clientWidth)setZoom(Math.max(.6,Math.min(1,node.clientWidth/(width+25))));}
  useEffect(()=>{
    const node=canvasRef.current;
    if(!node)return;
    const resize=()=>{
      if(!node.clientWidth||!node.clientHeight){lastFitSize.current="";setCanvasSize("");return;}
      const size=`${node.clientWidth}:${node.clientHeight}:${width}`;
      if(size===lastFitSize.current)return;
      lastFitSize.current=size;
      setCanvasSize(size);
      setZoom(Math.max(.6,Math.min(1,node.clientWidth/(width+25))));
    };
    resize();
    if(typeof ResizeObserver==="undefined")return;
    const observer=new ResizeObserver(resize);
    observer.observe(node);
    return()=>observer.disconnect();
  },[width]);
  useEffect(()=>{const node=canvasRef.current;if(!node?.clientWidth||!active)return;const planIndex=plans.findIndex(plan=>plan.id===active.id);const left=(262+(activeIndex-windowStart)*146)*zoom;const top=(150+planIndex*270-63)*zoom+65;const right=left+120*zoom;const bottom=top+126*zoom;if(left<node.scrollLeft+10||right>node.scrollLeft+node.clientWidth-10)node.scrollLeft=Math.max(0,left-node.clientWidth*.35);if(top<node.scrollTop+60||bottom>node.scrollTop+node.clientHeight-50)node.scrollTop=Math.max(0,top-node.clientHeight*.3);},[active?.id,gw,zoom,windowStart,shown,canvasSize]);
  useEffect(()=>{
    const timeline=mobileWeeksRef.current;
    const card=mobileSelectedWeekRef.current;
    if(!timeline||!card)return;
    const reveal=()=>{
      if(!timeline.clientWidth)return;
      const left=card.offsetLeft;
      if(left<timeline.scrollLeft||left+card.offsetWidth>timeline.scrollLeft+timeline.clientWidth){
        timeline.scrollLeft=Math.max(0,left-(timeline.clientWidth-card.offsetWidth)/2);
      }
    };
    reveal();
    if(typeof ResizeObserver==="undefined")return;
    const observer=new ResizeObserver(reveal);
    observer.observe(timeline);
    return()=>observer.disconnect();
  },[active?.id,gw,active?.weeks.length]);
  return <section className="plan-canvas" aria-label="Planning tree">
    <header className="tree-toolbar"><button className="button small" onClick={onConfigure}><Settings2 size={13}/>Configure</button><select aria-label="Tree gameweeks" value={displayWeeks} onChange={event=>setDisplayWeeks(+event.target.value)}>{[3,5,8,14,38].map(n=><option key={n} value={n}>{n===38?"Full season":`${n} GWs`}</option>)}</select><span className="tree-team-label">{active?.team_name ?? "My FPL team"}</span></header>
    <div className="tree-mobile">
      <div className="tree-mobile-header"><label>Scenario<select aria-label="Mobile planning scenario" value={active?.id ?? ""} disabled={!plans.length} onChange={event=>onPlan(event.target.value)}>{plans.length?plans.map(plan=><option key={plan.id} value={plan.id}>{plan.name}</option>):<option value="">No plans</option>}</select></label><button className="button small" onClick={onConfigure}><Settings2 size={14}/>Configure</button></div>
      {active?<><div className="tree-mobile-weeks" ref={mobileWeeksRef} aria-label="Scenario gameweeks">{active.weeks.map(week=>{const selected=week.gw===gw;return <button key={week.gw} ref={selected?mobileSelectedWeekRef:undefined} className={`tree-mobile-gw ${selected?"active":""}`} aria-current={selected?"step":undefined} onClick={()=>onWeek(week.gw)}><span>GW{week.gw}{week.chip!=="none"?<small>{({wildcard:"WC",freehit:"FH",benchboost:"BB",triplecaptain:"TC"})[week.chip]}</small>:null}</span><strong>{fmt(week.net_points??week.points)}<small>xPts</small></strong><div><span>{money(week.bank)}</span><span>{week.free_transfers} FT</span></div></button>;})}</div><div className="tree-mobile-options"><label>Horizon<select aria-label="Mobile plan horizon" value={active.weeks.length} onChange={event=>onHorizon(+event.target.value)}>{horizonOptions.map(n=><option key={n} value={n}>{n} GWs</option>)}</select></label><button onClick={onOptimise}><Sparkles size={13}/>Optimise GW{gw}</button></div></>:<button className="button primary tree-mobile-empty" onClick={onConfigure}>Import team</button>}
    </div>
    <div className="tree-canvas-scroll" ref={canvasRef} onPointerDown={event=>{if((event.target as HTMLElement).closest("button,input,select"))return;const node=canvasRef.current!;drag.current={x:event.clientX,y:event.clientY,left:node.scrollLeft,top:node.scrollTop};node.setPointerCapture(event.pointerId);node.classList.add("panning");}} onPointerMove={event=>{if(!drag.current)return;const node=canvasRef.current!;node.scrollLeft=drag.current.left-(event.clientX-drag.current.x);node.scrollTop=drag.current.top-(event.clientY-drag.current.y);}} onPointerUp={()=>{drag.current=null;canvasRef.current?.classList.remove("panning");}} onPointerCancel={()=>{drag.current=null;canvasRef.current?.classList.remove("panning");}}>
      <div className="tree-canvas-size" style={{width:width*zoom,height:height*zoom}}><div className="tree-canvas-inner" style={{width,height,transform:`scale(${zoom})`}}>
        <svg className="tree-connections" width={width} height={height} aria-hidden="true">
          {plans.map((plan,index)=>{const y=150+index*270;const weeks=visibleWeeks(plan);return <g key={plan.id}><path d={`M72 77 V${y} H176`}/><path className={active?.id===plan.id?"active":""} d={`M206 ${y} H${280+shown*146}`}/>{weeks.map(week=><circle key={week.gw} cx={282+column(week.gw)*146} cy={y} r="3"/>)}</g>;})}
        </svg>
        <button className="tree-base-team" style={{left:20,top:45}} onClick={onConfigure}><GitBranch size={14}/><span>Base team</span><small>{active?.entry_id ? `#${active.entry_id}` : "Local squad"}</small></button>
        {plans.map((plan,index)=>{const y=150+index*270;const weeks=visibleWeeks(plan);return <div key={plan.id}>
          <button className={`tree-scenario ${active?.id===plan.id?"active":""}`} style={{left:147,top:y-30}} onClick={()=>onPlan(plan.id)} title={plan.name}><GitBranch size={17}/><span>{index===0?"Base scenario":`Scenario ${index+1}`}</span><small>{plan.name}</small></button>
          {weeks.map(week=>{const chosen=active?.id===plan.id&&gw===week.gw;return <div className="tree-gameweek-node" key={week.gw} style={{left:262+column(week.gw)*146,top:y-63}}>
            {chosen?<button className="tree-node-optimise" onClick={onOptimise}><Sparkles size={12}/>Optimise</button>:null}
            <button className={`tree-gw-card ${chosen?"active":""}`} onClick={()=>{onPlan(plan.id);onWeek(week.gw);}}><span>GW{week.gw}</span><strong>{fmt(week.net_points??week.points)}<small>xPts</small></strong><div><span>{money(week.bank)} ITB</span><span>{week.free_transfers} FT</span></div><em>{week.chip!=="none"?({wildcard:"Wildcard",freehit:"Free Hit",benchboost:"Bench Boost",triplecaptain:"Triple Captain"})[week.chip]:week.transfers_in.length?week.transfers_in.map(id=>lookup.get(id)?.name).join(", "):"Roll transfer"}</em></button>
          </div>;})}
          <button className="tree-evaluation" style={{left:282+shown*146,top:y-26}} onClick={()=>onPlan(plan.id)}><span>Evaluation</span><b>{fmt(weeks.reduce((sum,week)=>sum+(week.net_points??week.points),0))}</b><small>{weeks.length} GW xPts</small></button>
        </div>;})}
        {!plans.length?<div className="tree-empty" style={{left:180,top:150}}><h3>Start your plan</h3><button className="button primary" onClick={onConfigure}>Import team</button></div>:null}
      </div></div>
    </div>
    <div className="tree-footer"><div><button onClick={onCreate} disabled={!active}><Plus size={14}/>Create</button><button onClick={onCreate} disabled={!active}><Copy size={14}/>Copy</button><button onClick={onDelete} disabled={plans.length<=1}><Trash2 size={14}/>Delete</button></div><div className="tree-zoom"><button aria-label="Zoom out planning tree" onClick={()=>setZoom(Math.max(.25,zoom-.1))}><Minus size={13}/></button><button aria-label="Fit planning tree" onClick={fit}>Fit</button><button onClick={()=>setZoom(1)}>{Math.round(zoom*100)}%</button><button aria-label="Zoom in planning tree" onClick={()=>setZoom(Math.min(1.5,zoom+.1))}><Plus size={13}/></button></div></div>
    {active ? <details className="tree-plan-config"><summary>Plan horizon · {active.weeks.length} GWs</summary><select aria-label="Tree plan horizon" value={active.weeks.length} onChange={event=>onHorizon(+event.target.value)}>{horizonOptions.map(n=><option key={n} value={n}>{n} GWs</option>)}</select></details>:null}
  </section>;
}

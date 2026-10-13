import { useState } from "react";
import { RotateCcw, X } from "lucide-react";
import type { Player, StatScenario } from "./types";
import { fmt } from "./lib";

export function StatScenarioEditor({player,weeks,gw,schedule,onSchedule,onNotify}: {
  player:Player; weeks:number[]; gw:number; schedule:Record<string,StatScenario>; onSchedule:(schedule:Record<string,StatScenario>)=>void; onNotify:(message:string)=>void;
}) {
  const [selectedGW,setSelectedGW]=useState(gw);
  const [scope,setScope]=useState("selected");
  const stringDraft=(row:StatScenario = {}) => Object.fromEntries(Object.entries(row).map(([key,value])=>[key,String(value*(key==="clean_sheet_probability"?100:1))])) as Partial<Record<keyof StatScenario,string>>;
  const [draft,setDraft]=useState<Partial<Record<keyof StatScenario,string>>>(stringDraft(schedule[String(gw)]));
  const forecast=player.gw[String(selectedGW)];
  const defaults:StatScenario={expected_points:forecast?.points??0,xg:forecast?.fixtures.reduce((sum,item)=>sum+item.xg,0)??0,xa:forecast?.fixtures.reduce((sum,item)=>sum+item.xa,0)??0,clean_sheet_probability:forecast?.fixtures.length?forecast.fixtures.reduce((sum,item)=>sum+item.cs,0)/forecast.fixtures.length:0};
  const fields:{key:keyof StatScenario;label:string;min:number;max:number;step:number}[]=[{key:"expected_points",label:"Expected points",min:-5,max:60,step:.1},{key:"xg",label:"Expected goals",min:0,max:10,step:.05},{key:"xa",label:"Expected assists",min:0,max:10,step:.05},{key:"clean_sheet_probability",label:"Clean sheet chance",min:0,max:100,step:1}];
  function selectWeek(value:number){setSelectedGW(value);setDraft(stringDraft(schedule[String(value)]));}
  function save(){
    if(!Object.keys(draft).length){onNotify("Enable a stat to edit.");return;}
    const values:StatScenario={};
    for(const field of fields){const raw=draft[field.key];if(raw===undefined)continue;const value=Number(raw);if(raw.trim()==="" || !Number.isFinite(value) || value<field.min || value>field.max){onNotify(`${field.label}: enter ${field.min}–${field.max}.`);return;}values[field.key]=value/(field.key==="clean_sheet_probability"?100:1);}
    const chosen=scope==="all"?weeks:scope==="from"?weeks.filter(week=>week>=selectedGW):[selectedGW];
    const next={...schedule};chosen.forEach(week=>{next[String(week)]={...values};});onSchedule(next);onNotify(`${player.name}: stats saved for ${chosen.length} GW${chosen.length===1?"":"s"}.`);
  }
  return <section className="stat-scenario-editor"><header><h3>Edit player stats</h3><span className="subtle-tag">Your scenario</span></header><p className="help-text">Edit GW totals. Your assumptions feed projections and optimisation.</p>
    <div className="field-grid"><label>Gameweek<select aria-label="Stat scenario gameweek" value={selectedGW} onChange={event=>selectWeek(+event.target.value)}>{weeks.map(week=><option value={week} key={week}>GW{week}</option>)}</select></label><label>Apply to<select aria-label="Stat scenario scope" value={scope} onChange={event=>setScope(event.target.value)}><option value="selected">This GW</option><option value="from">From GW{selectedGW}</option><option value="all">All remaining GWs</option></select></label></div>
    <div className="stat-edit-fields">{fields.map(field=>{const enabled=draft[field.key]!==undefined;const percentage=field.key==="clean_sheet_probability";return <label key={field.key}><span><input aria-label={`Override ${field.label}`} type="checkbox" checked={enabled} onChange={event=>setDraft(current=>{const next={...current};if(event.target.checked)next[field.key]=String((defaults[field.key]??0)*(percentage?100:1));else delete next[field.key];return next;})}/>{field.label}</span><input aria-label={`Assumed ${field.label}`} disabled={!enabled} type="number" min={field.min} max={field.max} step={field.step} value={enabled?draft[field.key]:fmt((defaults[field.key]??0)*(percentage?100:1),percentage?0:2)} onChange={event=>setDraft(current=>({...current,[field.key]:event.target.value}))}/>{percentage?<small>%</small>:null}</label>;})}</div>
    <div className="button-row"><button className="button primary small" onClick={save}>Save stats</button><button className="button small" onClick={()=>{const next={...schedule};delete next[String(selectedGW)];onSchedule(next);setDraft({});onNotify(`GW${selectedGW}: model stats restored.`);}}><RotateCcw size={12}/>Reset GW</button><button className="button small" disabled={!Object.keys(schedule).length} onClick={()=>{onSchedule({});setDraft({});onNotify("Player stat edits cleared.");}}>Reset all</button></div>
    {Object.keys(schedule).length?<details className="minutes-assumption-list"><summary>{Object.keys(schedule).length} edited GWs</summary>{Object.entries(schedule).sort((a,b)=>+a[0]-+b[0]).map(([week,row])=><div key={week}><button onClick={()=>selectWeek(+week)}>GW{week} · {Object.entries(row).map(([key,value])=>`${key==="clean_sheet_probability"?"CS":key==="expected_points"?"xPts":key} ${fmt(value*(key==="clean_sheet_probability"?100:1),key==="clean_sheet_probability"?0:2)}${key==="clean_sheet_probability"?"%":""}`).join(" · ")}</button><button aria-label={`Clear stat edit GW${week}`} onClick={()=>{const next={...schedule};delete next[week];onSchedule(next);if(+week===selectedGW)setDraft({});}}><X size={12}/></button></div>)}</details>:null}
    <small className="help-text">xG/xA are unconditional GW totals. In doubles, CS chance applies to each fixture. Set minutes/availability first for unavailable players.</small>
  </section>;
}

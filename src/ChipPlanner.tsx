import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { api, chipNames, fmt } from "./lib";
import type { Chip, Plan, Week } from "./types";

type Recommendation = {
  recommendations: { chip: Chip; gw: number; half: number; marginal_points: number }[];
  weeks: Week[];
  improvement: number;
  status: string;
  method: string;
  limitations: string[];
};

export function ChipPlanner({ plan, forecast, busy, onApply, onNotify }: {
  plan: Plan | null;
  forecast: Record<string, unknown>;
  busy: boolean;
  onApply: (source: Plan, weeks: Week[]) => Promise<void>;
  onNotify: (message: string, error?: boolean) => void;
}) {
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<Recommendation | null>(null);
  const [source, setSource] = useState<Plan | null>(null);
  const inputKey = JSON.stringify({ plan, forecast });
  const currentInput = useRef(inputKey);
  currentInput.current = inputKey;
  useEffect(() => { setResult(null); setSource(null); }, [inputKey]);

  async function recommend() {
    if (!plan || busy || working) return;
    const frozen = structuredClone(plan);
    const requestedInput = inputKey;
    setWorking(true);
    setResult(null);
    try {
      const response = await api<Recommendation>("/chips/recommend", {
        ...structuredClone(forecast), base_squad: frozen.base_squad, bank: frozen.base_bank,
        free_transfers: frozen.free_transfers, purchase_prices: frozen.purchase_prices,
        weeks: frozen.weeks, used_chips: frozen.used_chips ?? [],
      });
      if (requestedInput !== currentInput.current) return;
      setSource(frozen);
      setResult(response);
    } catch (error) { onNotify((error as Error).message, true); }
    finally { setWorking(false); }
  }

  async function apply() {
    if (!source || !result || working || busy) return;
    setWorking(true);
    try { await onApply(source, result.weeks); setResult(null); }
    catch (error) { onNotify((error as Error).message, true); }
    finally { setWorking(false); }
  }

  return <details className="chip-planner"><summary>CHIPS <span>Auto TC / BB</span></summary><div>
    <p>Find TC / BB weeks. Transfers and lineups stay fixed.</p>
    <button className="button small" disabled={!plan || busy || working} onClick={() => void recommend()}><Sparkles size={12}/>{working ? "Checking chips…" : "Suggest chip weeks"}</button>
    {result && <section className="chip-recommendation">
      <header><b>{result.improvement >= 0 ? "+" : ""}{fmt(result.improvement)} xPts</b><small>{source?.name} · {source?.weeks.length} GWs</small></header>
      {result.recommendations.length ? result.recommendations.map(row => <div key={`${row.gw}-${row.chip}`}><span>GW{row.gw}</span><b>{chipNames[row.chip]}</b><small>+{fmt(row.marginal_points)} xPts</small></div>) : <p>No additional chip placement.</p>}
      <button className="button primary small" disabled={!source || busy || working || !result.recommendations.length} onClick={() => void apply()}>Save chip branch</button>
      <details className="compact-details"><summary>Method</summary><p>{result.method}</p>{result.limitations.map(note => <p key={note}>{note}</p>)}</details>
    </section>}
  </div></details>;
}

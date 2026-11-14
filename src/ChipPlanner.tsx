import { useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { api, chipNames, fmt } from "./lib";
import type { Chip, Plan, Week } from "./types";
import "./chip-strategy.css";

type Recommendation = {
  recommendations: {
    chip: Chip;
    gw: number;
    half: number;
    marginal_points: number;
  }[];
  weeks: Week[];
  improvement: number;
  status: string;
  method: string;
  limitations: string[];
};

const round1 = (value: number) => Math.round(value * 10) / 10 || 0;
const signed = (value: number) => {
  const rounded = round1(value);
  return `${rounded >= 0 ? "+" : ""}${fmt(rounded)}`;
};

export function chipPlannerInputKey(
  plan: Plan | null,
  forecast: Record<string, unknown>,
) {
  return JSON.stringify({
    plan: plan
      ? {
          id: plan.id,
          base_squad: plan.base_squad,
          base_bank: plan.base_bank,
          free_transfers: plan.free_transfers,
          purchase_prices: plan.purchase_prices,
          used_chips: plan.used_chips ?? [],
          weeks: plan.weeks,
        }
      : null,
    forecast,
  });
}

export function ChipPlanner({
  plan,
  forecast,
  busy,
  onApply,
  onNotify,
}: {
  plan: Plan | null;
  forecast: Record<string, unknown>;
  busy: boolean;
  onApply: (source: Plan, weeks: Week[]) => Promise<void>;
  onNotify: (message: string, error?: boolean) => void;
}) {
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<Recommendation | null>(null);
  const [source, setSource] = useState<Plan | null>(null);
  const inputKey = chipPlannerInputKey(plan, forecast);
  const currentInput = useRef(inputKey);
  currentInput.current = inputKey;
  useEffect(() => {
    setResult(null);
    setSource(null);
  }, [inputKey]);

  async function recommend() {
    if (!plan || busy || working) return;
    const frozen = structuredClone(plan);
    const requestedInput = inputKey;
    setWorking(true);
    setResult(null);
    try {
      const response = await api<Recommendation>("/chips/recommend", {
        ...structuredClone(forecast),
        base_squad: frozen.base_squad,
        bank: frozen.base_bank,
        free_transfers: frozen.free_transfers,
        purchase_prices: frozen.purchase_prices,
        weeks: frozen.weeks,
        used_chips: frozen.used_chips ?? [],
      });
      if (requestedInput !== currentInput.current) return;
      setSource(frozen);
      setResult(response);
    } catch (error) {
      onNotify((error as Error).message, true);
    } finally {
      setWorking(false);
    }
  }

  async function apply() {
    if (!source || !result || working || busy) return;
    const latestSource =
      plan?.id === source.id ? { ...source, name: plan.name } : source;
    setWorking(true);
    try {
      await onApply(latestSource, result.weeks);
      setResult(null);
    } catch (error) {
      onNotify((error as Error).message, true);
    } finally {
      setWorking(false);
    }
  }

  const displayName = plan?.id === source?.id ? plan?.name : source?.name;

  return (
    <details className="chip-planner solver-disclosure">
      <summary>
        <b>CHIPS</b>
        <span>Auto TC / BB</span>
        {working ? (
          <small className="disclosure-badge">Checking…</small>
        ) : result ? (
          <small className="disclosure-badge disclosure-ready">
            {result.recommendations.length
              ? `${result.recommendations
                  .map(
                    (row) =>
                      `${row.chip === "triplecaptain" ? "TC" : "BB"} GW${row.gw}`,
                  )
                  .join(" · ")} (${signed(result.improvement)})`
              : "No chip gain"}
          </small>
        ) : null}
        <ChevronDown
          size={15}
          className="disclosure-chevron"
          aria-hidden="true"
        />
      </summary>
      <div className="solver-disclosure-body">
        <p>Find best TC / BB weeks with transfers and lineups fixed.</p>
        <button
          className="button small"
          disabled={!plan || busy || working}
          onClick={() => void recommend()}
        >
          <Sparkles size={12} />
          {working ? "Checking chips…" : "Suggest chip weeks"}
        </button>
        {result && (
          <section className="chip-recommendation">
            <header>
              <b>{signed(result.improvement)} xPts</b>
              <small>
                {displayName} · {source?.weeks.length} GW
                {source?.weeks.length === 1 ? "" : "s"}
              </small>
            </header>
            {result.recommendations.length ? (
              result.recommendations.map((row) => (
                <div key={`${row.gw}-${row.chip}`}>
                  <span>GW{row.gw}</span>
                  <b>{chipNames[row.chip]}</b>
                  <small>{signed(row.marginal_points)} xPts</small>
                </div>
              ))
            ) : (
              <p>No additional chip placement.</p>
            )}
            <button
              className="button primary small"
              disabled={
                !source || busy || working || !result.recommendations.length
              }
              onClick={() => void apply()}
            >
              Save chip branch
            </button>
            <details className="compact-details">
              <summary>Method</summary>
              <p>{result.method}</p>
              {result.limitations.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </details>
          </section>
        )}
      </div>
    </details>
  );
}

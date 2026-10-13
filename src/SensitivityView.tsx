import { useEffect, useState } from "react";
import { Activity, Download, FlaskConical, X } from "lucide-react";
import { api, download, fmt } from "./lib";
import type {
  Bootstrap,
  Plan,
  SensitivityJob,
  SensitivitySettings,
  Week,
} from "./types";
import type { SolverSettings } from "./Views";
import { stressRunning as running, watchSensitivity } from "./sensitivity";
import { solverSettingsForHorizon } from "./planningPersistence";

const storageKey = "open-fpl-sensitivity-job";

function savedJob() {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

export function SensitivityView({
  data,
  plan,
  strategy,
  forecast,
  busy,
  onApply,
  onDetail,
}: {
  data: Bootstrap;
  plan: Plan | null;
  strategy: SolverSettings;
  forecast: Record<string, unknown>;
  busy: boolean;
  onApply: (job: SensitivityJob, weeks: Week[], name: string) => void;
  onDetail: (id: number) => void;
}) {
  const [settings, setSettings] = useState<SensitivitySettings>({
    horizon: Math.min(3, 39 - data.next_gw),
    seconds: 4,
    scenarios: 8,
    variation: 0.25,
    seed: 2026,
  });
  const [jobId, setJobId] = useState<string | null>(savedJob);
  const [job, setJob] = useState<SensitivityJob | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [frequency, setFrequency] = useState<
    "purchases" | "sales" | "captains"
  >("purchases");
  const lookup = new Map(data.players.map((p) => [p.id, p]));
  const active = sending || running(job) || Boolean(jobId && !job);
  const change = (key: keyof SensitivitySettings, value: number) =>
    setSettings((s) => ({ ...s, [key]: value }));

  useEffect(() => {
    if (!jobId) return;
    return watchSensitivity(jobId, {
      update: setJob,
      error: setError,
      missing: (message) => {
        setError(message);
        setJobId(null);
        setJob(null);
        localStorage.removeItem(storageKey);
      },
    });
  }, [jobId]);

  async function start() {
    if (!plan) return;
    const startGW = plan.weeks[0]?.gw ?? data.next_gw;
    const horizon = Math.min(settings.horizon, 39 - startGW);
    setSending(true);
    setError("");
    try {
      const result = await api<SensitivityJob>("/sensitivity", {
        ...forecast,
        ...solverSettingsForHorizon(strategy, startGW, horizon),
        ...settings,
        horizon,
        squad: plan.base_squad,
        bank: plan.base_bank,
        free_transfers: plan.free_transfers,
        purchase_prices: plan.purchase_prices,
        used_chips: plan.used_chips ?? [],
        start_gw: startGW,
        name: plan.name,
        chips: Object.fromEntries(
          plan.weeks.filter((w) => w.gw >= startGW && w.gw < startGW + horizon).map((w) => [String(w.gw), w.chip]),
        ),
      });
      setJob(result);
      setJobId(result.id);
      localStorage.setItem(storageKey, result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function cancel() {
    if (!job) return;
    try {
      setJob(await api<SensitivityJob>(`/sensitivity/${job.id}/cancel`, {}));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const summary = job?.summary;
  const n = summary?.denominator ?? 0;
  return (
    <details className="panel sensitivity-panel compact-details">
      <summary>
        Stress test
        {active && (
          <span className="compact-status">
            {" "}
            · {job?.completed ?? 0}/{job?.total ?? settings.scenarios}
          </span>
        )}
      </summary>
      <div className="panel-heading sensitivity-heading">
        <FlaskConical size={19} />
        <div>
          <h3>Strategy sensitivity</h3>
        </div>
        {job && !running(job) && (
          <button
            className="button small"
            onClick={() =>
              download(
                `open-fpl-stress-gw${job.settings.solve.start_gw}-${job.id.slice(0, 8)}.json`,
                JSON.stringify(job, null, 2),
              )
            }
          >
            <Download size={14} /> Save report
          </button>
        )}
      </div>
      <details className="compact-details">
        <summary>How it works</summary>
        <p>
          Rerun your strategy with a persistent point multiplier for each
          player. Fixtures, appearance probabilities, prices, chips and
          constraints stay fixed. The spread is an assumption you choose.
        </p>
      </details>
      <div className="field-grid stress-controls">
        <label>
          Stress horizon
          <select
            aria-label="Stress horizon"
            disabled={active}
            value={settings.horizon}
            onChange={(e) => change("horizon", +e.target.value)}
          >
            {[1, 2, 3, 4, 6]
              .filter((v) => data.next_gw + v - 1 <= 38)
              .map((v) => (
                <option key={v} value={v}>
                  {v} gameweeks
                </option>
              ))}
          </select>
        </label>
        <label>
          Forecast variation
          <select
            aria-label="Forecast variation"
            disabled={active}
            value={settings.variation}
            onChange={(e) => change("variation", +e.target.value)}
          >
            {[0, 0.1, 0.25, 0.4, 0.6].map((v) => (
              <option key={v} value={v}>
                {v === 0
                  ? "0% · repeat solves"
                  : `${v * 100}% standard deviation`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scenarios
          <select
            aria-label="Stress scenarios"
            disabled={active}
            value={settings.scenarios}
            onChange={(e) => change("scenarios", +e.target.value)}
          >
            {[3, 8, 12, 20].map((v) => (
              <option key={v} value={v}>
                {v} scenarios
              </option>
            ))}
          </select>
        </label>
        <label>
          Time per solve
          <select
            aria-label="Stress time per solve"
            disabled={active}
            value={settings.seconds}
            onChange={(e) => change("seconds", +e.target.value)}
          >
            {[2, 4, 8].map((v) => (
              <option key={v} value={v}>
                {v} seconds
              </option>
            ))}
          </select>
        </label>
        <label>
          Random seed
          <input
            aria-label="Stress random seed"
            type="number"
            min={0}
            max={2147483647}
            step={1}
            disabled={active}
            value={settings.seed}
            onChange={(e) => change("seed", +e.target.value)}
          />
        </label>
        <div className="stress-run">
          <button
            className="button primary full"
            disabled={active || busy || !plan}
            onClick={() => void start()}
          >
            <Activity size={16} />{" "}
            {active ? "Stress test in progress…" : "Stress test my strategy"}
          </button>
          <small>
            Uses the bank, FTs and chips of {plan?.name ?? "your imported plan"}
            , plus the strategy settings above.
          </small>
        </div>
      </div>
      {!plan && (
        <p className="help-text">
          Create or import a team first to test its transfer strategy.
        </p>
      )}
      {error && (
        <p role="alert" className="stress-error">
          {error}
        </p>
      )}
      {job && (
        <>
          <div className="stress-progress" role="status" aria-live="polite">
            <div>
              <b>
                {job.status === "complete"
                  ? "Stress test complete"
                  : job.status === "cancelled"
                    ? "Stopped with partial results"
                    : job.status === "failed"
                      ? "Stress test stopped"
                      : job.phase}
              </b>
              <span>
                {job.completed}/{job.total} feasible scenarios ·{" "}
                {job.settings.name} · GW{job.settings.solve.start_gw}–
                {job.settings.solve.start_gw + job.settings.solve.horizon - 1} ·{" "}
                {job.settings.variation * 100}% spread · seed{" "}
                {job.settings.seed}
              </span>
            </div>
            {running(job) && (
              <button
                className="button small"
                disabled={job.cancel_requested}
                onClick={() => void cancel()}
              >
                <X size={14} />
                {job.cancel_requested
                  ? "Finishing current solve…"
                  : "Stop test"}
              </button>
            )}
          </div>
          <progress
            aria-label="Stress test progress"
            max={job.total}
            value={job.attempted}
          />
          {job.error && (
            <p role="alert" className="stress-error">
              {job.error}
            </p>
          )}
          {job.failures.length > 0 && (
            <details className="stress-method">
              <summary>
                {job.failures.length} scenarios found no feasible result
              </summary>
              {job.failures.map((f) => (
                <p key={f.scenario}>
                  Scenario {f.scenario}: {f.message}
                </p>
              ))}
            </details>
          )}
          {job.baseline && (
            <div className="stress-reference">
              <div>
                <b>Reference plan</b>
                <span>
                  {fmt(job.baseline_value ?? 0)} discounted net xP · gap{" "}
                  {job.baseline.gap === null ? "unknown" : `${fmt(job.baseline.gap * 100)}%`}
                </span>
                <small>
                  {job.baseline.weeks[0].transfers_in
                    .map((id) => lookup.get(id)?.name ?? id)
                    .join(", ") || "Roll the first transfer"}{" "}
                  · Captain {lookup.get(job.baseline.weeks[0].captain)?.name}
                </small>
              </div>
              <button
                className="button small"
                disabled={busy}
                onClick={() => onApply(job, job.baseline!.weeks, "reference")}
              >
                Use reference as branch
              </button>
            </div>
          )}
          {n > 0 && (
            <>
              <div className="stress-metrics">
                <div>
                  <b>
                    {summary!.roll_count}/{n}
                  </b>
                  <span>Scenarios rolling the first transfer</span>
                </div>
                <div>
                  <b>{fmt(summary!.differences!.mean)}</b>
                  <span>Mean xP difference from reference under stress</span>
                </div>
                <div>
                  <b>
                    {fmt(summary!.differences!.p10)} to{" "}
                    {fmt(summary!.differences!.p90)}
                  </b>
                  <span>10th–90th percentile difference</span>
                </div>
              </div>
              <div className="stress-results">
                <div>
                  <h4>First-week selection frequency</h4>
                  <div className="segmented">
                    {(["purchases", "sales", "captains"] as const).map(
                      (key) => (
                        <button
                          key={key}
                          className={frequency === key ? "active" : ""}
                          onClick={() => setFrequency(key)}
                        >
                          {key === "purchases"
                            ? "Buy"
                            : key === "sales"
                              ? "Sell"
                              : "Captain"}
                        </button>
                      ),
                    )}
                  </div>
                  <p className="help-text">
                    Count among {n} feasible scenarios. This is not forecast
                    confidence.
                  </p>
                  {summary!.frequencies[frequency].slice(0, 12).map((row) => (
                    <button
                      className="stress-frequency"
                      key={row.id}
                      onClick={() => onDetail(row.id)}
                    >
                      <span>
                        {lookup.get(row.id)?.name ?? `Player ${row.id}`}
                        <small>{lookup.get(row.id)?.team_short}</small>
                      </span>
                      <span className="frequency-track">
                        <i style={{ width: `${row.fraction * 100}%` }} />
                      </span>
                      <b>
                        {row.count}/{n}
                      </b>
                    </button>
                  ))}
                  {!summary!.frequencies[frequency].length && (
                    <p className="help-text">
                      No first-week {frequency} in these scenarios.
                    </p>
                  )}
                </div>
                <div>
                  <h4>Alternative plans</h4>
                  <p className="help-text">
                    Grouped by first-week transfers and captain. Points use the
                    original forecasts and decay, minus hits.
                  </p>
                  {summary!.variants.slice(0, 8).map((variant, index) => (
                    <div className="stress-variant" key={variant.scenario}>
                      <div>
                        <span className="eyebrow">
                          {variant.count}/{n} SCENARIOS
                        </span>
                        <b>
                          {variant.weeks[0].transfers_in
                            .map((id) => lookup.get(id)?.name ?? id)
                            .join(" + ") || "Roll"}
                        </b>
                        <small>
                          Sell:{" "}
                          {variant.weeks[0].transfers_out
                            .map((id) => lookup.get(id)?.name ?? id)
                            .join(", ") || "None"}{" "}
                          · Captain {lookup.get(variant.weeks[0].captain)?.name}
                        </small>
                        <small>
                          {fmt(variant.base_value)} net xP · gap{" "}
                          {fmt(variant.gap * 100)}%
                        </small>
                      </div>
                      <button
                        className="button small"
                        disabled={busy}
                        onClick={() =>
                          onApply(job, variant.weeks, `variant ${index + 1}`)
                        }
                      >
                        Use as branch
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          <details className="stress-method">
            <summary>Method and frozen forecast</summary>
            <p>{job.method}</p>
            <p>
              {job.forecast.model_version} · loaded{" "}
              {new Date(job.forecast.loaded_at).toLocaleString()} · fingerprint{" "}
              {job.forecast.sha256.slice(0, 16)}
            </p>
            {job.limitations.map((text) => (
              <p key={text}>{text}</p>
            ))}
          </details>
        </>
      )}
    </details>
  );
}

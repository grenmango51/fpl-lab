import { useEffect, useState } from "react";
import { Activity, ChevronDown, Download, X } from "lucide-react";
import { api, download, fmt } from "./lib";
import { TabStrip } from "./TabStrip";
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
import "./chip-strategy.css";

const storageKey = "open-fpl-sensitivity-job";

function savedJob() {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

const round1 = (value: number) => Math.round(value * 10) / 10 || 0;
const signedMean = (value: number) => {
  const rounded = round1(value);
  return `${rounded > 0 ? "+" : ""}${fmt(rounded)}`;
};

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
  const startGW = plan?.weeks[0]?.gw ?? data.next_gw;
  const [settings, setSettings] = useState<SensitivitySettings>({
    horizon: Math.max(1, Math.min(3, 39 - startGW)),
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
  const horizonOptions = [1, 2, 3, 4, 6].filter((v) => startGW + v - 1 <= 38);
  const effectiveHorizon = horizonOptions.includes(settings.horizon)
    ? settings.horizon
    : (horizonOptions.at(-1) ?? 1);
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
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* Storage may be unavailable. */
        }
      },
    });
  }, [jobId]);

  async function start() {
    if (!plan) return;
    const horizon = Math.max(1, Math.min(effectiveHorizon, 39 - startGW));
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
          plan.weeks
            .filter((w) => w.gw >= startGW && w.gw < startGW + horizon)
            .map((w) => [String(w.gw), w.chip]),
        ),
      });
      setJob(result);
      setJobId(result.id);
      try {
        localStorage.setItem(storageKey, result.id);
      } catch {
        /* Storage may be unavailable. */
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function cancel() {
    if (!job) return;
    try {
      setJob(
        await api<SensitivityJob>(
          `/sensitivity/${encodeURIComponent(job.id)}/cancel`,
          {},
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const summary = job?.summary;
  const n = summary?.denominator ?? 0;
  const loadedAt =
    job?.forecast.loaded_at && !Number.isNaN(Date.parse(job.forecast.loaded_at))
      ? new Date(job.forecast.loaded_at).toLocaleString()
      : "Source time unavailable";

  return (
    <details className="panel sensitivity-panel solver-disclosure">
      <summary>
        <b>STRESS TEST</b>
        <span>Scenario check</span>
        {active ? (
          <small className="disclosure-badge">
            {job?.completed ?? 0}/{job?.total ?? settings.scenarios}
          </small>
        ) : job ? (
          <small className="disclosure-badge disclosure-ready">
            {n > 0
              ? `${summary!.roll_count}/${n} roll · ${n}/${job.total} ready`
              : job.status === "failed"
                ? "Stopped"
                : `${job.completed}/${job.total} ready`}
          </small>
        ) : null}
        <ChevronDown
          size={15}
          className="disclosure-chevron"
          aria-hidden="true"
        />
      </summary>
      <div className="solver-disclosure-body sensitivity-body">
        <div className="sensitivity-heading">
          <p>
            Reruns solves with persistent player point multipliers. Spread is a
            chosen assumption; fixtures, prices, chips and rules stay fixed.
          </p>
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
              <Download size={13} /> Report
            </button>
          )}
        </div>
        <div className="field-grid stress-controls">
          <label>
            Stress horizon
            <select
              aria-label="Stress horizon"
              disabled={active}
              value={effectiveHorizon}
              onChange={(e) => change("horizon", +e.target.value)}
            >
              {(horizonOptions.length ? horizonOptions : [1]).map((v) => (
                <option key={v} value={v}>
                  {v} gameweek{v === 1 ? "" : "s"}
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
                  {v === 0 ? "0% · repeat" : `${v * 100}% SD`}
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
                  {v}s
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
              <Activity size={15} />{" "}
              {active ? "Running…" : "Run stress test"}
            </button>
            <small>
              {plan
                ? `${plan.name} · ${effectiveHorizon > 1 ? `GW${startGW}–${startGW + effectiveHorizon - 1}` : `GW${startGW}`}`
                : "Import or create a plan first."}
            </small>
          </div>
        </div>
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
                      ? "Stopped · partial results"
                      : job.status === "failed"
                        ? "Stress test stopped"
                        : job.phase}
                </b>
                <span>
                  {job.completed}/{job.total} feasible · {job.settings.name} ·{" "}
                  GW{job.settings.solve.start_gw}
                  {job.settings.solve.horizon > 1
                    ? `–${job.settings.solve.start_gw + job.settings.solve.horizon - 1}`
                    : ""}{" "}
                  · {job.settings.variation * 100}% SD · seed{" "}
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
                  {job.cancel_requested ? "Finishing solve…" : "Stop"}
                </button>
              )}
            </div>
            <progress
              aria-label="Stress test progress"
              max={Math.max(1, job.total)}
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
                  {job.failures.length} infeasible scenario
                  {job.failures.length === 1 ? "" : "s"}
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
                    {job.baseline.gap === null
                      ? "unknown"
                      : `${fmt(job.baseline.gap * 100)}%`}
                  </span>
                  <small>
                    {job.baseline.weeks[0].transfers_in
                      .map((id) => lookup.get(id)?.name ?? id)
                      .join(", ") ||
                      `Roll GW${job.baseline.weeks[0].gw} transfer`}{" "}
                    · Captain{" "}
                    {lookup.get(job.baseline.weeks[0].captain)?.name ??
                      `#${job.baseline.weeks[0].captain}`}
                  </small>
                </div>
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() => onApply(job, job.baseline!.weeks, "reference")}
                >
                  Save reference
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
                    <span>Roll first transfer</span>
                  </div>
                  <div>
                    <b>
                      {summary!.differences
                        ? signedMean(summary!.differences.mean)
                        : "—"}
                    </b>
                    <span>Mean Δ xP vs reference</span>
                  </div>
                  <div>
                    <b>
                      {summary!.differences
                        ? `${fmt(round1(summary!.differences.p10))} to ${fmt(round1(summary!.differences.p90))}`
                        : "—"}
                    </b>
                    <span>P10–P90 Δ xP</span>
                  </div>
                </div>
                <div className="stress-results">
                  <div>
                    <h4>First-week picks</h4>
                    <TabStrip
                      label="First-week selection frequency"
                      value={frequency}
                      onChange={setFrequency}
                      items={[
                        { id: "purchases", label: "Buy" },
                        { id: "sales", label: "Sell" },
                        { id: "captains", label: "Captain" },
                      ]}
                    />
                    <p className="help-text">
                      Share of {n} feasible scenarios (not forecast confidence).
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
                      Grouped by first-week moves and captain; base forecasts
                      net of hits.
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
                            Out:{" "}
                            {variant.weeks[0].transfers_out
                              .map((id) => lookup.get(id)?.name ?? id)
                              .join(", ") || "None"}{" "}
                            · C:{" "}
                            {lookup.get(variant.weeks[0].captain)?.name ??
                              `#${variant.weeks[0].captain}`}
                          </small>
                          <small>
                            {fmt(variant.base_value)} net xP · gap{" "}
                            {variant.gap === null
                              ? "unknown"
                              : `${fmt(variant.gap * 100)}%`}
                          </small>
                        </div>
                        <button
                          className="button small"
                          disabled={busy}
                          onClick={() =>
                            onApply(job, variant.weeks, `variant ${index + 1}`)
                          }
                        >
                          Save branch
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
            <details className="stress-method">
              <summary>Method & frozen forecast</summary>
              <p>{job.method}</p>
              <p>
                {job.forecast.model_version} · {loadedAt} · fingerprint{" "}
                {job.forecast.sha256.slice(0, 16)}
              </p>
              {job.limitations.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </details>
          </>
        )}
      </div>
    </details>
  );
}

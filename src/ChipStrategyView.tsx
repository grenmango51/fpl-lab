import { useEffect, useMemo, useState } from "react";
import { Download, Sparkles, X } from "lucide-react";
import { api, ApiError, chipNames, download, fmt } from "./lib";
import { solverSettingsForHorizon } from "./planningPersistence";
import type { Bootstrap, Plan, SolveResult, Week } from "./types";
import type { SolverSettings } from "./Views";
import "./chip-strategy.css";

type SearchChip = "wildcard" | "freehit";
export type ChipStrategyCandidate = {
  id: string;
  chip: "none" | SearchChip;
  gw: number | null;
  status:
    | "pending"
    | "running"
    | "complete"
    | "failed"
    | "skipped-budget"
    | "skipped-cancel"
    | "skipped-failure";
  error: string | null;
  weeks?: Week[];
  solve_weeks?: Week[];
  net_points?: number;
  discounted_net_points?: number;
  improvement?: number;
  solve?: SolveResult;
};
export type ChipStrategyJob = {
  id: string;
  status:
    | "queued"
    | "running"
    | "complete"
    | "cancelled"
    | "budget-exhausted"
    | "failed";
  phase: string;
  elapsed_seconds: number;
  attempted: number;
  completed: number;
  total: number;
  cancel_requested: boolean;
  error: string | null;
  settings: {
    auto_chip: SearchChip;
    chip_half: 1 | 2;
    max_candidates: number;
    budget_seconds: number;
    name: string;
    solve: Record<string, unknown>;
  };
  forecast: {
    sha256: string;
    model_version: string | null;
    loaded_at: string | null;
  };
  scope: {
    gameweeks: number[];
    eligible_gameweeks: number[];
    selected_gameweeks: number[];
    all_eligible_selected: boolean;
  };
  candidates: ChipStrategyCandidate[];
  baseline: ChipStrategyCandidate | null;
  best: ChipStrategyCandidate | null;
  recommendation: { chip: SearchChip; gw: number; improvement: number } | null;
  method: string;
  limitations: string[];
};

const storageKey = "open-fpl-chip-strategy-v1";
type SavedSearch = { id: string; source: Plan };
function savedSearch(): SavedSearch | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return typeof value?.id === "string" &&
      Array.isArray(value?.source?.base_squad) &&
      Array.isArray(value?.source?.weeks)
      ? value
      : null;
  } catch {
    return null;
  }
}
export const chipStrategyRunning = (job: ChipStrategyJob | null) =>
  job?.status === "queued" || job?.status === "running";

export function watchChipStrategy(
  id: string,
  callbacks: {
    update: (job: ChipStrategyJob) => void;
    error: (message: string) => void;
    missing: (message: string) => void;
  },
) {
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout>;
  async function poll() {
    try {
      const job = await api<ChipStrategyJob>(
        `/chip-strategy/${encodeURIComponent(id)}`,
      );
      if (stopped) return;
      failures = 0;
      callbacks.error("");
      callbacks.update(job);
      if (chipStrategyRunning(job)) timer = setTimeout(() => void poll(), 1500);
    } catch (error) {
      if (stopped) return;
      if (error instanceof ApiError && error.status === 404) {
        callbacks.missing(error.message);
        return;
      }
      failures += 1;
      callbacks.error(
        "Connection interrupted. The search ID is saved; reconnecting…",
      );
      timer = setTimeout(
        () => void poll(),
        Math.min(30000, 1500 * 2 ** Math.min(failures, 5)),
      );
    }
  }
  void poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

const gap = (candidate: ChipStrategyCandidate | null) =>
  candidate?.solve?.gap == null
    ? "unknown"
    : `${fmt(candidate.solve.gap * 100, 2)}%`;
const sign = (value: number) => `${value >= 0 ? "+" : ""}${fmt(value)}`;

export function ChipStrategyView({
  data,
  plan,
  gw,
  strategy,
  forecast,
  busy,
  onApply,
}: {
  data: Bootstrap;
  plan: Plan | null;
  gw: number;
  strategy: SolverSettings;
  forecast: Record<string, unknown>;
  busy: boolean;
  onApply: (source: Plan, weeks: Week[], job: ChipStrategyJob) => Promise<void>;
}) {
  const [saved] = useState(savedSearch);
  const [jobId, setJobId] = useState<string | null>(saved?.id ?? null);
  const [source, setSource] = useState<Plan | null>(saved?.source ?? null);
  const [job, setJob] = useState<ChipStrategyJob | null>(null);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [chip, setChip] = useState<SearchChip>("wildcard");
  const [half, setHalf] = useState<1 | 2>(gw <= 19 ? 1 : 2);
  const [windowStart, setWindowStart] = useState(gw);
  const [windowEnd, setWindowEnd] = useState(
    Math.min(38, gw + strategy.horizon - 1),
  );
  const [candidateCount, setCandidateCount] = useState(4);
  const [seconds, setSeconds] = useState(6);
  const [budget, setBudget] = useState(120);
  const horizon = Math.max(1, Math.min(strategy.horizon, 39 - gw));
  const active = sending || chipStrategyRunning(job) || Boolean(jobId && !job);
  const allowanceUsed = Boolean(
    plan &&
    [...(plan.used_chips ?? []), ...plan.weeks].some(
      (row) => row.chip === chip && (row.gw <= 19 ? 1 : 2) === half,
    ),
  );
  const eligible = useMemo(
    () =>
      data.gameweeks.filter(
        (week) =>
          week >= gw &&
          week < gw + horizon &&
          (week <= 19 ? 1 : 2) === half &&
          !plan?.weeks.some((row) => row.gw === week && row.chip !== "none"),
      ),
    [data.gameweeks, gw, horizon, half, plan],
  );
  const first = eligible.includes(windowStart) ? windowStart : eligible[0];
  const last =
    eligible.includes(windowEnd) && windowEnd >= (first ?? 39)
      ? windowEnd
      : eligible.at(-1);
  const candidates = eligible.filter(
    (week) => week >= (first ?? 39) && week <= (last ?? 0),
  );
  const selectedWeekExists = Boolean(
    plan?.weeks.some((week) => week.gw === gw),
  );

  useEffect(() => {
    if (!jobId) return;
    return watchChipStrategy(jobId, {
      update: setJob,
      error: setError,
      missing: (message) => {
        setError(message);
        setJobId(null);
        setJob(null);
        setSource(null);
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* Storage may be disabled. */
        }
      },
    });
  }, [jobId]);

  async function start() {
    if (
      !plan ||
      !selectedWeekExists ||
      active ||
      busy ||
      allowanceUsed ||
      !candidates.length
    )
      return;
    const frozen = structuredClone(plan);
    const inputs = structuredClone(forecast);
    setSending(true);
    setError("");
    try {
      const result = await api<ChipStrategyJob>("/chip-strategy", {
        ...inputs,
        ...solverSettingsForHorizon(structuredClone(strategy), gw, horizon),
        horizon,
        start_gw: gw,
        seconds,
        auto_chip: chip,
        chip_half: half,
        max_candidates: candidateCount,
        budget_seconds: budget,
        candidate_gws: candidates,
        name: frozen.name,
        squad: frozen.base_squad,
        bank: frozen.base_bank,
        free_transfers: frozen.free_transfers,
        purchase_prices: frozen.purchase_prices,
        used_chips: frozen.used_chips ?? [],
        source_plan: {
          base_squad: frozen.base_squad,
          bank: frozen.base_bank,
          free_transfers: frozen.free_transfers,
          purchase_prices: frozen.purchase_prices,
          used_chips: frozen.used_chips ?? [],
          weeks: frozen.weeks,
        },
      });
      setSource(frozen);
      setJob(result);
      setJobId(result.id);
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ id: result.id, source: frozen }),
        );
      } catch {
        setError(
          "Search running. Browser storage is unavailable; keep this page open to save its branch.",
        );
      }
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function cancel() {
    if (!jobId) return;
    try {
      setJob(
        await api<ChipStrategyJob>(
          `/chip-strategy/${encodeURIComponent(jobId)}/cancel`,
          {},
        ),
      );
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  async function apply() {
    if (!source || !job?.best?.weeks?.length || active || busy || saving)
      return;
    setSaving(true);
    setError("");
    try {
      await onApply(
        structuredClone(source),
        structuredClone(job.best.weeks),
        job,
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const statusLabel =
    job?.status === "complete"
      ? "Search complete"
      : job?.status === "cancelled"
        ? "Stopped · partial search"
        : job?.status === "budget-exhausted"
          ? "Budget reached · partial search"
          : job?.status === "failed"
            ? "Search stopped"
            : (job?.phase ?? "Reconnecting…");
  const scope = job?.scope.gameweeks;
  return (
    <details className="chip-strategy">
      <summary>
        CHIP STRATEGY <span>Auto WC / FH</span>
        {active && (
          <small>
            {job?.attempted ?? 0}/{job?.total ?? candidateCount + 1}
          </small>
        )}
      </summary>
      <div className="chip-strategy-body">
        <p>Compare chip timing with a new transfer plan for each week.</p>
        <div className="chip-strategy-controls field-grid">
          <label>
            Chip
            <select
              aria-label="Automatic strategy chip"
              value={chip}
              disabled={active}
              onChange={(event) => setChip(event.target.value as SearchChip)}
            >
              <option value="wildcard">Wildcard</option>
              <option value="freehit">Free Hit</option>
            </select>
          </label>
          <label>
            Allowance
            <select
              aria-label="Automatic strategy half"
              value={half}
              disabled={active}
              onChange={(event) => setHalf(+event.target.value as 1 | 2)}
            >
              <option value={1}>GW1–19</option>
              <option value={2}>GW20–38</option>
            </select>
          </label>
          <label>
            Earliest week
            <select
              aria-label="First chip candidate gameweek"
              value={first ?? ""}
              disabled={active || !eligible.length}
              onChange={(event) => setWindowStart(+event.target.value)}
            >
              {!eligible.length && <option value="">No eligible weeks</option>}
              {eligible.map((week) => (
                <option key={week} value={week}>
                  GW{week}
                </option>
              ))}
            </select>
          </label>
          <label>
            Latest week
            <select
              aria-label="Last chip candidate gameweek"
              value={last ?? ""}
              disabled={active || !candidates.length}
              onChange={(event) => setWindowEnd(+event.target.value)}
            >
              {!eligible.length && <option value="">No eligible weeks</option>}
              {eligible
                .filter((week) => week >= (first ?? 39))
                .map((week) => (
                  <option key={week} value={week}>
                    GW{week}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <details className="compact-details chip-search-limits">
          <summary>Search limits</summary>
          <div className="field-grid">
            <label>
              Candidate weeks
              <select
                aria-label="Maximum chip candidate weeks"
                value={candidateCount}
                disabled={active}
                onChange={(event) => setCandidateCount(+event.target.value)}
              >
                {[2, 4, 6, 8].map((value) => (
                  <option key={value} value={value}>
                    Up to {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Time per solve
              <select
                aria-label="Chip strategy solve seconds"
                value={seconds}
                disabled={active}
                onChange={(event) => setSeconds(+event.target.value)}
              >
                {[2, 4, 6, 8, 12].map((value) => (
                  <option key={value} value={value}>
                    {value}s
                  </option>
                ))}
              </select>
            </label>
            <label>
              Total budget
              <select
                aria-label="Chip strategy budget seconds"
                value={budget}
                disabled={active}
                onChange={(event) => setBudget(+event.target.value)}
              >
                {[30, 60, 120, 240].map((value) => (
                  <option key={value} value={value}>
                    {value}s
                  </option>
                ))}
              </select>
            </label>
          </div>
          <small>
            Stops between solves. A running solve and its seed finish first.
          </small>
        </details>
        <div className="chip-strategy-run">
          <button
            className="button small"
            disabled={
              active ||
              busy ||
              saving ||
              !plan ||
              !selectedWeekExists ||
              allowanceUsed ||
              !candidates.length
            }
            onClick={() => void start()}
          >
            <Sparkles size={13} />
            {active ? "Searching chip weeks…" : "Search chip strategy"}
          </button>
          <small>
            GW{gw}–{gw + horizon - 1} · frozen forecasts and rules
          </small>
        </div>
        {allowanceUsed && (
          <p className="help-text">
            This {chipNames[chip]} allowance is already used or scheduled.
          </p>
        )}
        {!selectedWeekExists && (
          <p className="help-text">Select a gameweek in your plan first.</p>
        )}
        {error && (
          <p role="alert" className="chip-strategy-error">
            {error}
          </p>
        )}
        {job && (
          <section className="chip-strategy-result">
            <header>
              <div role="status" aria-live="polite">
                <b>{statusLabel}</b>
                <small>
                  {job.settings.name} · GW{scope?.[0]}–{scope?.at(-1)} ·{" "}
                  {fmt(job.elapsed_seconds, 0)}s
                </small>
              </div>
              {chipStrategyRunning(job) && (
                <button
                  className="button small"
                  disabled={job.cancel_requested}
                  onClick={() => void cancel()}
                >
                  <X size={12} />
                  {job.cancel_requested ? "Finishing solve…" : "Stop"}
                </button>
              )}
            </header>
            <progress
              aria-label="Chip strategy search progress"
              max={Math.max(1, job.total)}
              value={job.attempted}
            />
            {job.error && (
              <p role="alert" className="chip-strategy-error">
                {job.error}
              </p>
            )}
            <p className="chip-strategy-coverage">
              {job.completed}/{job.total} validated solves ·{" "}
              {job.scope.selected_gameweeks.length}/
              {job.scope.eligible_gameweeks.length} eligible chip weeks selected
            </p>
            {job.best && (
              <div className="chip-strategy-best">
                <b>
                  {job.recommendation
                    ? `${chipNames[job.recommendation.chip]} GW${job.recommendation.gw}`
                    : "Keep baseline chip schedule"}
                </b>
                <strong>
                  {sign(job.best.improvement ?? 0)}
                  <small>discounted net xPts vs baseline</small>
                </strong>
                <span>
                  {fmt(job.best.net_points ?? NaN)} total net xPts · gap{" "}
                  {gap(job.best)}
                </span>
              </div>
            )}
            <div className="table-container">
              <table className="data-table chip-strategy-table">
                <thead>
                  <tr>
                    <th>Placement</th>
                    <th>Net xPts</th>
                    <th>Δ discounted</th>
                    <th>Gap</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {job.candidates.map((candidate) => (
                    <tr
                      key={candidate.id}
                      className={
                        candidate.id === job.best?.id ? "best-candidate" : ""
                      }
                    >
                      <td>
                        {candidate.chip === "none"
                          ? "Baseline"
                          : `${candidate.chip === "wildcard" ? "WC" : "FH"} GW${candidate.gw}`}
                      </td>
                      <td>{fmt(candidate.net_points ?? NaN)}</td>
                      <td>
                        {candidate.improvement == null
                          ? "—"
                          : sign(candidate.improvement)}
                      </td>
                      <td>{candidate.solve ? gap(candidate) : "—"}</td>
                      <td title={candidate.error ?? undefined}>
                        {candidate.status.replaceAll("-", " ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="chip-strategy-actions">
              <button
                className="button primary small"
                disabled={
                  active ||
                  busy ||
                  saving ||
                  !source ||
                  !job.best?.weeks?.length
                }
                onClick={() => void apply()}
              >
                {saving ? "Saving…" : "Save strategy branch"}
              </button>
              <button
                className="button small"
                onClick={() =>
                  download(
                    `open-fpl-chip-strategy-${job.id.slice(0, 8)}.json`,
                    JSON.stringify(job, null, 2),
                  )
                }
              >
                <Download size={12} />
                Report
              </button>
            </div>
            <small>
              Save keeps the source branch and rechecks this plan with current
              forecasts.
            </small>
            <details className="compact-details chip-strategy-method">
              <summary>Method & frozen inputs</summary>
              <p>{job.method}</p>
              <p>
                {job.forecast.model_version} ·{" "}
                {job.forecast.loaded_at
                  ? new Date(job.forecast.loaded_at).toLocaleString()
                  : "Source time unavailable"}{" "}
                · fingerprint {job.forecast.sha256.slice(0, 16)}
              </p>
              <p>
                {job.settings.max_candidates} candidate limit ·{" "}
                {job.settings.budget_seconds}s budget · best pool{" "}
                {job.best?.solve?.candidate_count ?? "unknown"} players.
              </p>
              {job.candidates
                .filter((candidate) => candidate.error)
                .map((candidate) => (
                  <p key={candidate.id}>
                    {candidate.chip === "none"
                      ? "Baseline"
                      : `GW${candidate.gw}`}
                    : {candidate.error}
                  </p>
                ))}
              {job.limitations.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </details>
          </section>
        )}
      </div>
    </details>
  );
}

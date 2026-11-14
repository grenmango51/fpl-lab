import { useEffect, useMemo, useRef, useState } from "react";
import { useViewState } from "./useViewState";
import { TabStrip } from "./TabStrip";
import { matchesPlayerQuery } from "./playerSearch";
import {
  Search,
  SlidersHorizontal,
  Star,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  Sparkles,
  LockKeyhole,
  X,
  Info,
  TrendingUp,
  Clock3,
} from "lucide-react";
import type {
  Bootstrap,
  Plan,
  SolveResult,
  Evaluation,
  ProbabilityScore,
  Chip,
  Prospective,
} from "./types";
import { fmt, money, xp, chipNames } from "./lib";
import { Badge, Busy, LineChart, Pitch, PlayerName, Stat } from "./components";
import { ProspectiveView } from "./ProspectiveView";
import { LeadTimeView } from "./LeadTimeView";
import { PlanInsights } from "./PlanInsights.tsx";
import { PlanComparisonView } from "./PlanComparisonView";
import "./optimise-review.css";

type BaseProps = {
  data: Bootstrap;
  gw: number;
  onDetail: (id: number) => void;
  watch: number[];
  onWatch: (id: number) => void;
};
export { ProjectionsView } from "./ProjectionExplorer";

export { FixtureExplorer as FixturesView } from "./FixtureExplorer";

export type SolverSettings = {
  horizon: number;
  max_transfers: number;
  decay: number;
  ft_value: number;
  bench_weight: number;
  risk: number;
  seconds: number;
  locked: number[];
  excluded: number[];
  transfer_limits?: Record<string, number>;
  locked_by_gw?: Record<string, number[]>;
  excluded_by_gw?: Record<string, number[]>;
  captain_locks?: Record<string, number>;
};

const chipShort: Record<Exclude<Chip, "none">, string> = {
  wildcard: "WC",
  freehit: "FH",
  benchboost: "BB",
  triplecaptain: "TC",
};

export type PlayerConstraintReceipt = {
  key: string;
  kind: "locked" | "excluded";
  id: number;
  scopeLabel: string;
  weeks: string[] | null;
};

export function buildPlayerConstraintReceipts(
  settings: SolverSettings,
  gameweeks: readonly number[],
): PlayerConstraintReceipt[] {
  const receipts: PlayerConstraintReceipt[] = [];
  const lastSeasonGW = gameweeks.length ? Math.max(...gameweeks) : 38;
  for (const kind of ["locked", "excluded"] as const) {
    const globalSet = new Set(settings[kind]);
    for (const id of settings[kind]) {
      receipts.push({
        key: `${kind}-all-${id}`,
        kind,
        id,
        scopeLabel: "All GWs",
        weeks: null,
      });
    }
    const scoped =
      settings[kind === "locked" ? "locked_by_gw" : "excluded_by_gw"] ?? {};
    const byPlayer = new Map<number, number[]>();
    for (const [gwKey, ids] of Object.entries(scoped)) {
      const gwNum = Number(gwKey);
      if (!Number.isInteger(gwNum)) continue;
      for (const id of ids) {
        if (globalSet.has(id)) continue;
        const list = byPlayer.get(id) ?? [];
        list.push(gwNum);
        byPlayer.set(id, list);
      }
    }
    for (const [id, rawWeeks] of byPlayer.entries()) {
      const sorted = [...new Set(rawWeeks)].sort((a, b) => a - b);
      let start = sorted[0];
      let prev = sorted[0];
      let group = [String(sorted[0])];
      const flush = () => {
        const scopeLabel =
          group.length > 1 && prev === lastSeasonGW
            ? `GW${start} onwards`
            : start === prev
              ? `GW${start}`
              : `GW${start}–${prev}`;
        receipts.push({
          key: `${kind}-${start}-${prev}-${id}`,
          kind,
          id,
          scopeLabel,
          weeks: group,
        });
      };
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === prev + 1) {
          prev = sorted[i];
          group.push(String(prev));
        } else {
          flush();
          start = sorted[i];
          prev = sorted[i];
          group = [String(prev)];
        }
      }
      flush();
    }
  }
  return receipts;
}

function cleanWeeklyMap(map: Record<string, number[]> | undefined) {
  const output: Record<string, number[]> = {};
  for (const [gw, ids] of Object.entries(map ?? {})) {
    if (ids.length) output[gw] = ids;
  }
  return output;
}

export function OptimiseView({
  data,
  plan,
  gw,
  settings,
  onSettings,
  onSolve,
  result,
  busy,
  onApply,
  onDiscard,
  sourceName,
  onDetail,
  resultFresh,
  baselinePlan,
  onPreviewGW,
}: {
  data: Bootstrap;
  plan: Plan | null;
  gw: number;
  settings: SolverSettings;
  onSettings: (s: SolverSettings) => void;
  onSolve: (fresh: boolean) => void;
  result: SolveResult | null;
  busy: boolean;
  onApply: () => void;
  onDiscard?: () => void;
  sourceName?: string;
  onDetail: (id: number, gw?: number) => void;
  resultFresh?: boolean;
  baselinePlan?: Plan | null;
  compact?: boolean;
  onPreviewGW?: (gw: number) => void;
}) {
  const [query, setQuery] = useViewState("optimise.query", "");
  const [settingsSection, setSettingsSection] = useViewState(
    "optimise.section",
    "setup",
  );
  const [constraintScope, setConstraintScope] = useState("all");
  const [ruleGW, setRuleGW] = useState(gw);
  const [constraint, setConstraint] = useState<"locked" | "excluded">("locked");
  const [selectedGw, setSelectedGw] = useState(() =>
    result
      ? result.weeks.some((week) => week.gw === gw)
        ? gw
        : (result.weeks[0]?.gw ?? gw)
      : gw,
  );
  const [reviewing, setReviewing] = useState(Boolean(result));
  const reviewHeading = useRef<HTMLDivElement>(null);
  const prevResult = useRef(result);

  useEffect(() => {
    if (result !== prevResult.current) {
      prevResult.current = result;
      setReviewing(Boolean(result));
      if (result) {
        setSelectedGw(result.weeks[0]?.gw ?? gw);
        reviewHeading.current?.scrollIntoView({ block: "start" });
      } else {
        setSelectedGw(gw);
      }
      return;
    }
    if (!result || result.weeks.some((week) => week.gw === gw)) {
      setSelectedGw(gw);
    }
  }, [result, gw]);

  const change = (key: keyof SolverSettings, value: number) =>
    onSettings({ ...settings, [key]: value });
  const lookup = useMemo(
    () => new Map(data.players.map((p) => [p.id, p])),
    [data.players],
  );
  const remainingGameweeks = data.gameweeks.filter((week) => week >= gw).length;
  const effectiveHorizon = Math.max(
    1,
    Math.min(settings.horizon, remainingGameweeks),
  );
  const solvedWeeks = useMemo(
    () => data.gameweeks.filter((week) => week >= gw).slice(0, effectiveHorizon),
    [data.gameweeks, gw, effectiveHorizon],
  );
  const lastSeasonGW = data.gameweeks.at(-1) ?? 38;

  useEffect(() => {
    if (!solvedWeeks.includes(ruleGW)) setRuleGW(solvedWeeks[0] ?? gw);
    const scopeBaseGW = Number(constraintScope.replace(/\+$/, ""));
    if (constraintScope !== "all" && !solvedWeeks.includes(scopeBaseGW)) {
      setConstraintScope("all");
    }
  }, [gw, solvedWeeks, ruleGW, constraintScope]);

  const scopedKey = constraint === "locked" ? "locked_by_gw" : "excluded_by_gw";
  const otherScopedKey =
    scopedKey === "locked_by_gw" ? "excluded_by_gw" : "locked_by_gw";
  const otherGlobalKey = constraint === "locked" ? "excluded" : "locked";

  const scopeTargetWeeks = useMemo(() => {
    if (constraintScope === "all") return null;
    if (constraintScope.endsWith("+")) {
      const startWeek = Number(constraintScope.slice(0, -1));
      return data.gameweeks.filter((week) => week >= startWeek).map(String);
    }
    return [constraintScope];
  }, [constraintScope, data.gameweeks]);

  const constraintIds = useMemo(() => {
    if (!scopeTargetWeeks) return settings[constraint];
    if (!scopeTargetWeeks.length) return [];
    const firstList = settings[scopedKey]?.[scopeTargetWeeks[0]] ?? [];
    return firstList.filter((id) =>
      scopeTargetWeeks.every((w) =>
        (settings[scopedKey]?.[w] ?? []).includes(id),
      ),
    );
  }, [scopeTargetWeeks, settings, constraint, scopedKey]);

  const setConstraintPlayer = (id: number) => {
    const activeInScope = constraintIds.includes(id);
    if (!scopeTargetWeeks) {
      const ids = activeInScope
        ? settings[constraint].filter((value) => value !== id)
        : [...settings[constraint], id];
      const nextOtherScoped = cleanWeeklyMap(
        Object.fromEntries(
          Object.entries(settings[otherScopedKey] ?? {}).map(([w, list]) => [
            w,
            activeInScope ? list : list.filter((value) => value !== id),
          ]),
        ),
      );
      onSettings({
        ...settings,
        [constraint]: ids,
        [otherGlobalKey]: activeInScope
          ? settings[otherGlobalKey]
          : settings[otherGlobalKey].filter((value) => value !== id),
        [otherScopedKey]: nextOtherScoped,
      });
      return;
    }
    const nextScoped = { ...(settings[scopedKey] ?? {}) };
    const nextOtherScoped = { ...(settings[otherScopedKey] ?? {}) };
    for (const w of scopeTargetWeeks) {
      const current = nextScoped[w] ?? [];
      nextScoped[w] = activeInScope
        ? current.filter((value) => value !== id)
        : current.includes(id)
          ? current
          : [...current, id];
      if (!activeInScope && nextOtherScoped[w]) {
        nextOtherScoped[w] = nextOtherScoped[w].filter((value) => value !== id);
      }
    }
    onSettings({
      ...settings,
      [otherGlobalKey]: activeInScope
        ? settings[otherGlobalKey]
        : settings[otherGlobalKey].filter((value) => value !== id),
      [scopedKey]: cleanWeeklyMap(nextScoped),
      [otherScopedKey]: cleanWeeklyMap(nextOtherScoped),
    });
  };

  const removeConstraintReceipt = (receipt: PlayerConstraintReceipt) => {
    if (receipt.weeks === null) {
      onSettings({
        ...settings,
        [receipt.kind]: settings[receipt.kind].filter(
          (value) => value !== receipt.id,
        ),
      });
      return;
    }
    const key = receipt.kind === "locked" ? "locked_by_gw" : "excluded_by_gw";
    const next = { ...(settings[key] ?? {}) };
    for (const w of receipt.weeks) {
      if (next[w]) {
        next[w] = next[w].filter((value) => value !== receipt.id);
      }
    }
    onSettings({
      ...settings,
      [key]: cleanWeeklyMap(next),
    });
  };

  const playerReceipts = useMemo(
    () => buildPlayerConstraintReceipts(settings, data.gameweeks),
    [settings, data.gameweeks],
  );
  const weeklyPlayerReceipts = useMemo(
    () => playerReceipts.filter((receipt) => receipt.weeks !== null),
    [playerReceipts],
  );
  const constraintMatches = useMemo(
    () =>
      query
        ? data.players.filter((p) => matchesPlayerQuery(p, query)).slice(0, 6)
        : [],
    [data.players, query],
  );

  const presets: Record<string, Partial<SolverSettings>> = {
    Default: {
      max_transfers: 2,
      decay: 0.9,
      ft_value: 1.5,
      bench_weight: 0.08,
      risk: 0,
    },
    "High Risk": {
      max_transfers: 4,
      decay: 0.88,
      ft_value: 0.75,
      bench_weight: 0.04,
      risk: -0.25,
    },
    "Low Risk": {
      max_transfers: 1,
      decay: 0.93,
      ft_value: 2,
      bench_weight: 0.15,
      risk: 0.25,
    },
    Optimistic: {
      max_transfers: 3,
      decay: 1,
      ft_value: 1,
      bench_weight: 0.04,
      risk: 0,
    },
    "Max XI points": {
      max_transfers: 15,
      decay: 1,
      ft_value: 0,
      bench_weight: 0,
      risk: 0,
    },
    Safe: {
      max_transfers: 1,
      decay: 0.95,
      ft_value: 2.5,
      bench_weight: 0.2,
      risk: 0.2,
    },
  };
  const preset =
    Object.entries(presets).find(([, values]) =>
      Object.entries(values).every(
        ([key, value]) => settings[key as keyof SolverSettings] === value,
      ),
    )?.[0] ?? "Custom";

  const previewWeeks = result?.weeks.length
    ? result.weeks
    : (plan?.weeks.filter((week) => week.gw >= gw).slice(0, effectiveHorizon) ??
      []);
  const selectedWeek =
    previewWeeks.find((week) => week.gw === selectedGw) ?? previewWeeks[0];
  const resultPoints = result?.weeks.reduce(
    (sum, week) => sum + week.net_points,
    0,
  );
  const baselineWeeks = result?.weeks.map((week) =>
    baselinePlan?.weeks.find((baseline) => baseline.gw === week.gw),
  );
  const baselinePoints =
    resultFresh === false &&
    result?.weeks.length &&
    new Set(result.weeks.map((week) => week.gw)).size === result.weeks.length &&
    baselineWeeks?.every((week) => week && Number.isFinite(week.net_points)) &&
    Number.isFinite(resultPoints)
      ? baselineWeeks.reduce((sum, week) => sum + week!.net_points, 0)
      : null;
  const pointsChange =
    baselinePoints === null
      ? null
      : Math.round((resultPoints! - baselinePoints) * 10) / 10 || 0;
  const lockedCaptainId = settings.captain_locks?.[String(ruleGW)];

  return (
    <>
      <div className="view-heading compact-view-heading" ref={reviewHeading}>
        <div>
          <h2>Optimise</h2>
        </div>
        {result && (
          <TabStrip
            label="Optimiser view"
            value={reviewing ? "review" : "settings"}
            onChange={(value) => setReviewing(value === "review")}
            items={[
              { id: "review", label: "Review draft" },
              { id: "settings", label: "Settings" },
            ]}
          />
        )}
      </div>
      <div
        className={`solver-layout solver-with-preview ${reviewing && result ? "solver-reviewing" : ""}`}
      >
        <section className="panel solver-settings">
          <TabStrip
            className="solver-setting-tabs segmented"
            label="Optimisation settings"
            value={settingsSection}
            onChange={setSettingsSection}
            items={[
              { id: "setup", label: "Setup" },
              { id: "players", label: "Players" },
              { id: "rules", label: "Rules" },
              { id: "advanced", label: "Advanced" },
            ]}
          />
          <div hidden={settingsSection !== "setup"}>
            <details className="solver-section" open>
              <summary>PRESETS</summary>
              <div className="solver-presets">
                {[...Object.keys(presets), "Custom"].map((name) => (
                  <button
                    key={name}
                    className={preset === name ? "active" : ""}
                    onClick={() => {
                      if (name === "Custom") setSettingsSection("advanced");
                      if (presets[name])
                        onSettings({ ...settings, ...presets[name] });
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <small className="preset-caption">
                {preset === "Max XI points"
                  ? "XI + captain − hits. Equal GW weights; no bench reward."
                  : "Ownership, transfer value and bench weighting"}
              </small>
            </details>
            <div className="panel-heading">
              <SlidersHorizontal size={16} />
              <h3>Horizon</h3>
            </div>
            <div className="field-grid solver-primary-controls">
              <label>
                Horizon
                <select
                  value={effectiveHorizon}
                  onChange={(e) => change("horizon", +e.target.value)}
                >
                  {[
                    ...new Set([
                      1,
                      2,
                      3,
                      4,
                      5,
                      6,
                      8,
                      10,
                      14,
                      20,
                      28,
                      remainingGameweeks,
                      effectiveHorizon,
                    ]),
                  ]
                    .filter((v) => v <= remainingGameweeks)
                    .sort((a, b) => a - b)
                    .map((v) => (
                      <option value={v} key={v}>
                        {v} gameweek{v === 1 ? "" : "s"}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Transfers / week
                <select
                  value={settings.max_transfers}
                  onChange={(e) => change("max_transfers", +e.target.value)}
                >
                  <option value={15}>Auto · hits allowed</option>
                  {Array.from({ length: 15 }, (_, i) => i).map((v) => (
                    <option value={v} key={v}>
                      {v} transfer{v === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div hidden={settingsSection !== "players"}>
            <div className="divider" />
            <div className="panel-heading">
              <LockKeyhole size={15} />
              <h3>Players</h3>
            </div>
            <label className="constraint-scope-label">
              Apply to
              <select
                aria-label="Player constraint gameweek"
                value={constraintScope}
                onChange={(event) => setConstraintScope(event.target.value)}
              >
                <option value="all">Every solved GW</option>
                {solvedWeeks.map((week) => (
                  <option key={week} value={String(week)}>
                    GW{week}
                  </option>
                ))}
                {solvedWeeks
                  .filter((week) => week < lastSeasonGW)
                  .map((week) => (
                    <option key={`${week}+`} value={`${week}+`}>
                      GW{week} onwards
                    </option>
                  ))}
              </select>
            </label>
            <TabStrip
              label="Player constraint mode"
              value={constraint}
              onChange={setConstraint}
              items={[
                { id: "locked", label: "Include" },
                { id: "excluded", label: "Exclude" },
              ]}
            />
            <div className="search-box constraint-search">
              <Search size={14} />
              <input
                aria-label="Find a player constraint"
                placeholder="Find players · Haaland, Saka"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {query && (
              <div className="constraint-results">
                {constraintMatches.length ? (
                  constraintMatches.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setConstraintPlayer(p.id);
                        setQuery("");
                      }}
                    >
                      <Badge player={p} />
                      <span className="constraint-player-meta">
                        <b>{p.name}</b>
                        <small>
                          {p.team_short} · {p.position}
                        </small>
                      </span>
                      <span>{money(p.price)}</span>
                    </button>
                  ))
                ) : (
                  <p className="help-text">No matching players.</p>
                )}
              </div>
            )}
            {playerReceipts.length > 0 && (
              <div
                className="constraint-tags"
                aria-label="Active player constraints"
              >
                {playerReceipts.map((receipt) => (
                  <button
                    key={receipt.key}
                    className={
                      receipt.kind === "excluded" ? "constraint-excluded" : ""
                    }
                    onClick={() => removeConstraintReceipt(receipt)}
                  >
                    <span>
                      {receipt.kind === "locked" ? "In" : "Out"}:{" "}
                      {lookup.get(receipt.id)?.name ?? `#${receipt.id}`} ·{" "}
                      {receipt.scopeLabel}
                    </span>
                    <X size={12} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div hidden={settingsSection !== "rules"}>
            <details className="solver-section week-rules" open>
              <summary>GAMEWEEK RULES</summary>
              <div className="field-grid">
                <label>
                  Gameweek
                  <select
                    aria-label="Rule gameweek"
                    value={ruleGW}
                    onChange={(event) => setRuleGW(+event.target.value)}
                  >
                    {solvedWeeks.map((week) => (
                      <option key={week} value={week}>
                        GW{week}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Max transfers
                  <select
                    aria-label="Gameweek transfer limit"
                    value={settings.transfer_limits?.[String(ruleGW)] ?? "auto"}
                    onChange={(event) => {
                      const next = { ...settings.transfer_limits };
                      if (event.target.value === "auto")
                        delete next[String(ruleGW)];
                      else next[String(ruleGW)] = +event.target.value;
                      onSettings({ ...settings, transfer_limits: next });
                    }}
                  >
                    <option value="auto">Auto</option>
                    {[0, 1, 2, 3, 4, 5, 10, 15].map((value) => (
                      <option key={value} value={value}>
                        {value === 0 ? "Roll (0)" : `Max ${value}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="rule-captain-label">
                  Captain
                  <select
                    aria-label="Locked captain gameweek"
                    value={lockedCaptainId ?? "auto"}
                    onChange={(event) => {
                      const next = { ...settings.captain_locks };
                      if (event.target.value === "auto")
                        delete next[String(ruleGW)];
                      else next[String(ruleGW)] = +event.target.value;
                      onSettings({ ...settings, captain_locks: next });
                    }}
                  >
                    <option value="auto">Auto</option>
                    {[...data.players]
                      .sort((a, b) => xp(b, ruleGW) - xp(a, ruleGW))
                      .filter(
                        (player) =>
                          xp(player, ruleGW) > 0 ||
                          player.id === lockedCaptainId,
                      )
                      .map((player) => (
                        <option value={player.id} key={player.id}>
                          {player.name} · {player.team_short}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="rule-receipts">
                {Object.entries(settings.transfer_limits ?? {}).map(
                  ([week, limit]) => (
                    <span key={`t${week}`}>
                      GW{week}:{" "}
                      {limit === 0 ? "roll" : `max ${limit} transfers`}
                    </span>
                  ),
                )}
                {Object.entries(settings.captain_locks ?? {}).map(
                  ([week, id]) => (
                    <span key={`c${week}`}>
                      GW{week}: captain {lookup.get(id)?.name ?? `#${id}`}
                    </span>
                  ),
                )}
                {weeklyPlayerReceipts.map((receipt) => (
                  <span key={receipt.key}>
                    {receipt.scopeLabel}:{" "}
                    {receipt.kind === "locked" ? "include" : "exclude"}{" "}
                    {lookup.get(receipt.id)?.name ?? `#${receipt.id}`}
                  </span>
                ))}
              </div>
              <button
                className="button small"
                onClick={() =>
                  onSettings({
                    ...settings,
                    transfer_limits: {},
                    locked_by_gw: {},
                    excluded_by_gw: {},
                    captain_locks: {},
                  })
                }
              >
                Clear weekly rules
              </button>
            </details>
          </div>
          <div hidden={settingsSection !== "advanced"}>
            <details className="compact-details solver-advanced" open>
              <summary>OBJECTIVE</summary>
              <div className="field-grid">
                <label>
                  FT value
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    max="3.9"
                    value={settings.ft_value}
                    onChange={(e) => change("ft_value", +e.target.value)}
                  />
                </label>
                <label>
                  Future weight
                  <input
                    type="number"
                    step="0.01"
                    min="0.5"
                    max="1"
                    value={settings.decay}
                    onChange={(e) => change("decay", +e.target.value)}
                  />
                </label>
                <label>
                  Bench weight
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={settings.bench_weight}
                    onChange={(e) => change("bench_weight", +e.target.value)}
                  />
                </label>
                <label>
                  Solve time
                  <select
                    value={settings.seconds}
                    onChange={(e) => change("seconds", +e.target.value)}
                  >
                    {[2, 5, 15, 30, 45].map((v) => (
                      <option value={v} key={v}>
                        {v}s
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="range-label">
                Ownership preference{" "}
                <b>
                  {settings.risk === 0
                    ? "Neutral"
                    : settings.risk < 0
                      ? "Differentials"
                      : "Popular picks"}
                </b>
                <input
                  aria-label="Ownership preference"
                  type="range"
                  min="-0.3"
                  max="0.3"
                  step="0.05"
                  value={settings.risk}
                  onChange={(e) => change("risk", +e.target.value)}
                />
              </label>
              <p>
                Discounts future GWs, weights bench and saved FTs linearly, and
                treats ownership as a heuristic—not calibrated risk. Solver gap
                reflects pool optimality, not forecast accuracy.
              </p>
            </details>
            <button
              className="button full"
              disabled={busy}
              onClick={() => onSolve(true)}
            >
              New £100m squad
            </button>
          </div>
          <div className="solver-run-footer">
            <span>
              From GW{gw} · {effectiveHorizon} GW
              {effectiveHorizon === 1 ? "" : "s"}
            </span>
            <button
              className="button primary full"
              disabled={busy || !plan}
              onClick={() => onSolve(false)}
            >
              <Sparkles size={16} />
              {busy ? "Solving…" : "Optimise"}
            </button>
          </div>
        </section>
        <section className="solver-output solver-preview">
          {busy && <Busy text="Solving…" />}
          {selectedWeek ? (
            <>
              <div className="panel result-summary">
                <div>
                  <h3>
                    {fmt(
                      previewWeeks.reduce(
                        (sum, week) => sum + week.net_points,
                        0,
                      ),
                    )}
                    <span> xP</span>
                  </h3>
                  <p className="compact-status">
                    {result
                      ? sourceName
                        ? `Draft · ${sourceName}`
                        : "Draft"
                      : "Current plan"}{" "}
                    · {previewWeeks.length} GW
                    {previewWeeks.length === 1 ? "" : "s"}
                    {result && (
                      <>
                        {" · "}
                        {result.weeks.reduce(
                          (sum, week) => sum + week.transfers_in.length,
                          0,
                        )}{" "}
                        transfers
                      </>
                    )}
                    {pointsChange !== null && (
                      <span
                        className={
                          pointsChange > 0
                            ? "green"
                            : pointsChange < 0
                              ? "red"
                              : ""
                        }
                      >
                        {" · "}
                        {pointsChange > 0 ? "+" : ""}
                        {fmt(pointsChange)} xP vs baseline
                      </span>
                    )}
                  </p>
                </div>
                {result && (
                  <div className="button-row result-actions">
                    {onDiscard && (
                      <button
                        className="button"
                        disabled={busy}
                        onClick={onDiscard}
                      >
                        <X size={15} />
                        Reject
                      </button>
                    )}
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={onApply}
                    >
                      Apply
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                )}
              </div>
              <TabStrip
                className="solver-week-tabs"
                label="Preview gameweek"
                value={String(selectedWeek.gw)}
                onChange={(value) => {
                  setSelectedGw(Number(value));
                  onPreviewGW?.(Number(value));
                }}
                items={previewWeeks.map((week) => ({
                  id: String(week.gw),
                  label: (
                    <>
                      <b>GW{week.gw}</b>
                      <span>{fmt(week.net_points)}</span>
                      {week.chip !== "none" && (
                        <small>{chipShort[week.chip]}</small>
                      )}
                    </>
                  ),
                }))}
              />
              <div className="panel result-week solver-selected-week">
                <div className="result-week-top">
                  <b>GW{selectedWeek.gw}</b>
                  {selectedWeek.chip !== "none" && (
                    <span>{chipNames[selectedWeek.chip]}</span>
                  )}
                  <strong>
                    {fmt(selectedWeek.net_points)}
                    <small> xP</small>
                  </strong>
                </div>
                <Pitch
                  week={selectedWeek}
                  players={data.players}
                  selected={null}
                  onSelect={(id) => onDetail(id, selectedWeek.gw)}
                  onDetail={(id) => onDetail(id, selectedWeek.gw)}
                  onBenchSwap={onDetail}
                />
                <div className="result-transfers">
                  {selectedWeek.transfers_in.length ? (
                    selectedWeek.transfers_in.map((id, index) => (
                      <div key={id}>
                        <button
                          disabled={!selectedWeek.transfers_out[index]}
                          onClick={() =>
                            onDetail(
                              selectedWeek.transfers_out[index],
                              selectedWeek.gw,
                            )
                          }
                        >
                          {lookup.get(selectedWeek.transfers_out[index])
                            ?.name ?? "New squad"}
                        </button>
                        <ArrowUpRight size={14} />
                        <button
                          className="green"
                          onClick={() => onDetail(id, selectedWeek.gw)}
                        >
                          {lookup.get(id)?.name}
                        </button>
                      </div>
                    ))
                  ) : (
                    <span className="green">Roll transfer</span>
                  )}
                </div>
                <div className="result-week-foot">
                  <span>
                    Captain: <b>{lookup.get(selectedWeek.captain)?.name}</b>
                  </span>
                  <span>
                    {selectedWeek.hits ? `−${selectedWeek.hits} hit` : "No hit"}{" "}
                    · {money(selectedWeek.bank)} bank ·{" "}
                    {selectedWeek.next_free_transfers} FT next
                  </span>
                </div>
              </div>
              {result && (
                <>
                  <details className="assumptions compact-details">
                    <summary>Solver details</summary>
                    <p>
                      {result.status} · gap{" "}
                      {result.gap === null
                        ? "unknown"
                        : `${fmt(result.gap * 100, 1)}%`}{" "}
                      · {result.candidate_count} candidates
                    </p>
                    <p>
                      Objective {fmt(result.objective)} · {result.pool_count}{" "}
                      players screened
                    </p>
                    {baselinePoints !== null && (
                      <p>
                        {baselinePlan?.name ?? "Baseline"}:{" "}
                        {fmt(baselinePoints)} xP over {result.weeks.length}{" "}
                        gameweek{result.weeks.length === 1 ? "" : "s"} (net of
                        hits).
                      </p>
                    )}
                  </details>
                  <details className="assumptions compact-details">
                    <summary>Assumptions</summary>
                    {result.assumptions.map((assumption) => (
                      <p key={assumption}>
                        <Info size={13} />
                        {assumption}
                      </p>
                    ))}
                  </details>
                </>
              )}
            </>
          ) : (
            <div className="solver-intro">
              <h3>No result yet</h3>
              <p>Choose your settings, then optimise.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

const MODEL_LABELS: Record<string, string> = {
  component: "Component model",
  previous: "Previous v0.2",
  form: "Recent form",
  ppg: "Appearance PPG",
};
const FLAG_LABELS: [string, string][] = [
  ["available", "Available"],
  ["d75", "75%"],
  ["d50", "50%"],
  ["d25", "25%"],
  ["out", "Out"],
];
type ScoreSet = Record<string, ProbabilityScore | null>;

function appearanceRows(
  appearance: NonNullable<Evaluation["appearance"]>,
): [string, ScoreSet][] {
  return [
    ["All", appearance.next_gw.pplay],
    ...FLAG_LABELS.filter(([key]) => appearance.by_flag[key]).map(
      ([key, label]): [string, ScoreSet] => [
        label,
        appearance.by_flag[key].pplay,
      ],
    ),
  ];
}

function signedInterval(d: { difference: number; ci95: number[] }) {
  const sign = (n: number) => `${n >= 0 ? "+" : ""}${fmt(n, 1)}`;
  return `${sign(d.difference)} (95% CI ${sign(d.ci95[0])} to ${sign(d.ci95[1])})`;
}

export function AnalysisView({
  data,
  plans,
  active,
  evalData,
  onSnapshot,
  prospective,
  busy,
  onScore,
  selectedGW,
  lockedIds,
  settings,
  onDetail,
  onLock,
  onPlan,
}: {
  data: Bootstrap;
  plans: Plan[];
  active: Plan | null;
  evalData: Evaluation | null;
  onSnapshot: () => void;
  prospective: Prospective | null;
  busy: boolean;
  onScore: () => void;
  selectedGW: number;
  lockedIds?: number[];
  settings?: SolverSettings;
  onDetail: (id: number) => void;
  onLock: (id: number) => void;
  onPlan: (id: string) => void;
}) {
  const [section, setSection] = useViewState<
    "overview" | "benchmarks" | "sources"
  >("plans.section", "overview");
  const [scope, setScope] = useViewState<"starters" | "all">(
    "plans.benchmarkScope",
    "starters",
  );
  const metrics =
    scope === "starters" ? evalData?.models : evalData?.all_players;
  const evalGeneratedAt =
    evalData?.generated_at && !Number.isNaN(Date.parse(evalData.generated_at))
      ? new Date(evalData.generated_at).toLocaleString()
      : null;

  return (
    <>
      <div className="view-heading compact-view-heading">
        <div>
          <h2>Plans</h2>
        </div>
        <div className="toolbar-actions" hidden={section !== "benchmarks"}>
          <button className="button" onClick={onSnapshot} disabled={busy}>
            <Clock3 size={15} />
            Capture forecasts
          </button>
        </div>
      </div>
      <TabStrip
        className="segmented analysis-tabs"
        label="Analysis views"
        value={section}
        onChange={setSection}
        items={[
          { id: "overview", label: "Overview" },
          { id: "benchmarks", label: "Benchmarks" },
          { id: "sources", label: "Sources" },
        ]}
      />
      {section === "overview" ? (
        <PlanComparisonView
          plans={plans}
          activeId={active?.id}
          onPlan={onPlan}
        />
      ) : null}
      {section === "overview" && active ? (
        <PlanInsights
          data={data}
          plan={active}
          selectedGW={selectedGW}
          lockedIds={lockedIds ?? settings?.locked}
          onDetail={onDetail}
          onLock={onLock}
        />
      ) : null}
      {section === "benchmarks" && (
        <>
          <ProspectiveView
            data={data}
            report={prospective}
            onScore={onScore}
            busy={busy}
          />
          <LeadTimeView
            data={data}
            captureKey={prospective?.captures?.[0]?.filename ?? ""}
          />
          <div className="section-title">
            <div>
              <h3>Historical benchmark</h3>
              <span className="compact-status">2025/26 holdout</span>
            </div>
            <TabStrip
              label="Historical benchmark cohort"
              value={scope}
              onChange={setScope}
              items={[
                { id: "starters", label: "Recent starters" },
                { id: "all", label: "All players" },
              ]}
            />
          </div>
          {evalData?.available && metrics ? (
            <>
              <div className="benchmark-stats">
                {Object.entries(metrics).map(([name, m]) => (
                  <div
                    className={`panel benchmark-card ${name === "Component model" ? "ours" : ""}`}
                    key={name}
                  >
                    <span>{name}</span>
                    <strong>
                      {fmt(m.rmse, 3)}
                      <small> RMSE</small>
                    </strong>
                    <p>
                      MAE {fmt(m.mae, 3)} · bias {m.bias >= 0 ? "+" : ""}
                      {fmt(m.bias, 3)}
                    </p>
                    <small>
                      {m.count.toLocaleString()} player-fixture forecasts
                    </small>
                  </div>
                ))}
              </div>
              <div className="analysis-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h3>Error across gameweeks</h3>
                    <span>Lower is better</span>
                  </div>
                  <LineChart
                    yLabel={`${evalData.gameweeks?.[0]?.rmse ? "RMSE" : "MAE"} (points)`}
                    series={[
                      {
                        name: "Component model",
                        values: evalData.gameweeks!.map(
                          (v) => v.rmse?.component ?? v.component,
                        ),
                      },
                      {
                        name: "Previous v0.2",
                        values: evalData.gameweeks!.map(
                          (v) =>
                            v.rmse?.previous ?? v.previous ?? v.ml ?? null,
                        ),
                      },
                      {
                        name: "Recent form",
                        values: evalData.gameweeks!.map(
                          (v) => v.rmse?.form ?? v.form,
                        ),
                      },
                    ]}
                    labels={evalData.gameweeks!.map((v) => `GW${v.gw}`)}
                  />
                  <p className="source-caption">
                    Source: vaastav FPL archives · 2025/26 · recent-starter
                    cohort
                  </p>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h3>By position</h3>
                    <span>Component model</span>
                  </div>
                  <div className="position-metrics">
                    {evalData.positions!.map((p) => (
                      <div key={p.position}>
                        <span>{p.position}</span>
                        <div>
                          <i style={{ width: `${(p.rmse / 5) * 100}%` }} />
                        </div>
                        <b>{fmt(p.rmse, 2)}</b>
                        <small>{p.count.toLocaleString()} rows</small>
                      </div>
                    ))}
                  </div>
                  <p className="source-caption">
                    RMSE in points · same held-out starter cohort
                  </p>
                </section>
              </div>
              {evalData.budget_squads || evalData.appearance ? (
                <div className="analysis-grid">
                  {evalData.budget_squads ? (
                    <section className="panel">
                      <div className="panel-heading">
                        <h3>Decisions</h3>
                        <span>Actual points · higher is better</span>
                      </div>
                      <div className="table-container">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>MODEL</th>
                              <th>SQUAD PTS/GW</th>
                              <th>CAPTAIN PTS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(MODEL_LABELS).map(([key, name]) => (
                              <tr key={key}>
                                <td>{name}</td>
                                <td>
                                  {fmt(evalData.budget_squads?.[key] ?? NaN, 1)}
                                </td>
                                <td>
                                  {fmt(evalData.captains?.[key] ?? NaN, 0)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="source-caption">
                        Best £100m squad each GW, no transfers
                        {evalData.decision_differences?.previous
                          ? ` · vs v0.2 ${signedInterval(evalData.decision_differences.previous.budget_squad)} pts/GW`
                          : ""}
                      </p>
                    </section>
                  ) : null}
                  {evalData.appearance ? (
                    <section className="panel">
                      <div className="panel-heading">
                        <h3>Appearance probability</h3>
                        <span>Log loss · lower is better</span>
                      </div>
                      <div className="table-container">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>FLAG AT DEADLINE</th>
                              <th>V0.3</th>
                              <th>V0.2</th>
                              <th>ROWS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {appearanceRows(evalData.appearance).map(
                              ([label, s]) => (
                                <tr key={label}>
                                  <td>{label}</td>
                                  <td>
                                    {fmt(
                                      s["Component model"]?.log_loss ?? NaN,
                                      3,
                                    )}
                                  </td>
                                  <td>
                                    {fmt(s["Previous v0.2"]?.log_loss ?? NaN, 3)}
                                  </td>
                                  <td>
                                    {s[
                                      "Component model"
                                    ]?.count.toLocaleString() ?? "—"}
                                  </td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                      <p className="source-caption">
                        Next-GW appearance · same archived flags for both models
                      </p>
                    </section>
                  ) : null}
                </div>
              ) : null}
              <details className="panel methodology compact-details">
                <summary>Method and limitations</summary>
                <p>{evalData.method}</p>
                <p>Features update only after each gameweek.</p>
                <p className="orange">
                  Paid-provider competitiveness is unproven. Live forecasts use
                  current market, Elevenify and optional FPL Form inputs; this
                  backtest tests the component model with historical team
                  estimates. The live blend and extrapolation require
                  prospective evaluation.
                </p>
                <div className="method-notes">
                  {evalData.limitations?.map((l) => (
                    <p key={l}>
                      <Info size={13} />
                      {l}
                    </p>
                  ))}
                </div>
                <small>
                  {evalGeneratedAt
                    ? `Evaluation generated ${evalGeneratedAt} · `
                    : ""}
                  Live model: {data.model_version}.
                </small>
              </details>
            </>
          ) : (
            <section className="panel">
              <Busy
                text={evalData?.message ?? "Loading historical evaluation…"}
              />
            </section>
          )}
        </>
      )}
      {section === "sources" && (
        <>
          <section className="panel sources-panel">
            <div className="panel-heading">
              <h3>Sources</h3>
              <span>
                {data.history_rows.toLocaleString()} historical records
              </span>
            </div>
            <div className="source-list">
              {Object.entries(data.sources)
                .filter(([key]) => !key.startsWith("fpl_live_"))
                .map(([key, source]) => {
                  const degraded =
                    source.status === "stale" ||
                    source.status === "unavailable";
                  return (
                    <div key={key}>
                      <span
                        className={`status-dot ${degraded ? "stale" : ""}`}
                      />
                      <div>
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {key.replaceAll("_", " ")}
                        </a>
                        <small>
                          {source.fetched_at
                            ? new Date(source.fetched_at).toLocaleString()
                            : "Unavailable"}{" "}
                          · {source.sha256?.slice(0, 12) ?? "No hash"}
                        </small>
                      </div>
                      <span
                        className={`source-state ${degraded ? "orange" : ""}`.trim()}
                      >
                        {source.status}
                      </span>
                    </div>
                  );
                })}
            </div>
          </section>
          <details className="panel methodology compact-details">
            <summary>Forecast limitations</summary>
            <div className="method-notes">
              {data.limitations.map((limitation) => (
                <p key={limitation}>
                  <Info size={13} />
                  {limitation}
                </p>
              ))}
            </div>
            <small>Model {data.model_version}</small>
          </details>
        </>
      )}
    </>
  );
}

export function MarketView({ data, gw, onDetail, watch, onWatch }: BaseProps) {
  const [query, setQuery] = useViewState("market.prices.query", ""),
    [sort, setSort] = useViewState("market.prices.sort", "net");
  const [page, setPage] = useViewState("market.prices.page", 0);
  const players = data.players
    .filter((p) => matchesPlayerQuery(p, query))
    .sort((a, b) =>
      sort === "price"
        ? b.price_change - a.price_change
        : sort === "signal"
          ? Number(b.price_change_percent ?? -100) -
            Number(a.price_change_percent ?? -100)
          : b.transfers_in -
            b.transfers_out -
            (a.transfers_in - a.transfers_out),
    );
  const totalIn = data.players.reduce((n, p) => n + p.transfers_in, 0);
  const selectedPage = Math.min(
    page,
    Math.max(0, Math.ceil(players.length / 35) - 1),
  );
  return (
    <>
      <div className="view-heading compact-view-heading">
        <div>
          <h2>Prices & transfers</h2>
        </div>
        <span className="engine-label">
          <TrendingUp size={16} />
          Official FPL
        </span>
      </div>
      <div className="market-stats">
        <Stat label="Transfers in" value={totalIn.toLocaleString()} />
        <Stat
          label="Most bought"
          value={
            [...data.players].sort((a, b) => b.transfers_in - a.transfers_in)[0]
              ?.name
          }
        />
        <Stat
          label="Most sold"
          value={
            [...data.players].sort(
              (a, b) => b.transfers_out - a.transfers_out,
            )[0]?.name
          }
        />
        <Stat
          label="Price changes"
          value={data.players.filter((p) => p.price_change !== 0).length}
        />
      </div>
      <div className="table-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            placeholder="Players or clubs · Haaland, Saka"
            aria-label="Search market players"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <select
          aria-label="Sort market"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(0);
          }}
        >
          <option value="net">Net transfers</option>
          <option value="price">Price change</option>
          <option value="signal">Official price signal</option>
        </select>
      </div>
      <div className="table-container price-scroll">
        <table className="data-table price-table">
          <thead>
            <tr>
              <th>
                <span className="sr-only">Watch</span>
              </th>
              <th>PLAYER</th>
              <th>PRICE</th>
              <th>GW CHANGE</th>
              <th>TRANSFERS IN</th>
              <th>TRANSFERS OUT</th>
              <th>NET</th>
              <th>OFFICIAL SIGNAL</th>
              <th>GW{gw} xP</th>
            </tr>
          </thead>
          <tbody>
            {players
              .slice(selectedPage * 35, (selectedPage + 1) * 35)
              .map((p) => {
                const watched = watch.includes(p.id);
                return (
                  <tr key={p.id}>
                    <td>
                      <button
                        className={`icon-button ${watched ? "starred" : ""}`}
                        onClick={() => onWatch(p.id)}
                        aria-label={`Watch ${p.name}`}
                        aria-pressed={watched}
                      >
                        <Star
                          size={14}
                          fill={watched ? "currentColor" : "none"}
                        />
                      </button>
                    </td>
                    <td>
                      <PlayerName player={p} onClick={() => onDetail(p.id)} />
                    </td>
                    <td>{money(p.price)}</td>
                    <td
                      className={
                        p.price_change > 0
                          ? "green"
                          : p.price_change < 0
                            ? "red"
                            : "muted"
                      }
                    >
                      {p.price_change > 0 ? "+" : ""}
                      {fmt(p.price_change)}
                    </td>
                    <td className="numeric">
                      {p.transfers_in.toLocaleString()}
                    </td>
                    <td className="muted numeric">
                      {p.transfers_out.toLocaleString()}
                    </td>
                    <td
                      className={`numeric ${p.transfers_in >= p.transfers_out ? "green" : "red"}`}
                    >
                      {p.transfers_in >= p.transfers_out ? "+" : ""}
                      {(p.transfers_in - p.transfers_out).toLocaleString()}
                    </td>
                    <td className="numeric">
                      {p.price_change_percent === null
                        ? "—"
                        : `${p.price_change_percent}%`}
                    </td>
                    <td className="orange numeric">{fmt(xp(p, gw))}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {!players.length ? (
        <p className="inline-empty">No matching players.</p>
      ) : null}
      <div className="table-footer">
        <span>
          {players.length ? selectedPage * 35 + 1 : 0}–
          {Math.min((selectedPage + 1) * 35, players.length)} of{" "}
          {players.length}
        </span>
        <div className="button-row">
          <button
            className="icon-button"
            aria-label="Previous market page"
            disabled={selectedPage === 0}
            onClick={() => setPage(selectedPage - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Next market page"
            disabled={(selectedPage + 1) * 35 >= players.length}
            onClick={() => setPage(selectedPage + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <details className="compact-details">
        <summary>Price signal</summary>
        <p>
          The official FPL signal is not a calibrated probability of a price
          change.
        </p>
      </details>
    </>
  );
}

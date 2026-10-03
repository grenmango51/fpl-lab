import { useMemo, useState } from "react";
import {
  Search,
  SlidersHorizontal,
  Download,
  Upload,
  Star,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowDownUp,
  ArrowUpRight,
  Sparkles,
  LockKeyhole,
  X,
  ShieldCheck,
  Info,
  Activity,
  TrendingUp,
  Clock3,
} from "lucide-react";
import type {
  Bootstrap,
  Player,
  Plan,
  SolveResult,
  Evaluation,
  Chip,
  Prospective,
} from "./types";
import { api, fmt, money, xp, chipNames } from "./lib";
import { Badge, Busy, LineChart, PlayerName, Stat } from "./components";
import { ProspectiveView } from "./ProspectiveView";
import { LeadTimeView } from "./LeadTimeView";

type BaseProps = {
  data: Bootstrap;
  gw: number;
  onDetail: (id: number) => void;
  watch: number[];
  onWatch: (id: number) => void;
};
export function ProjectionsView({
  data,
  gw,
  onDetail,
  watch,
  onWatch,
  onCSV,
  onExport,
}: { onCSV: () => void; onExport: () => void } & BaseProps) {
  const [query, setQuery] = useState(""),
    [position, setPosition] = useState("ALL"),
    [team, setTeam] = useState(0),
    [budget, setBudget] = useState(20),
    [minMins, setMinMins] = useState(0),
    [horizon, setHorizon] = useState(6),
    [watchOnly, setWatchOnly] = useState(false),
    [sort, setSort] = useState("total"),
    [descending, setDescending] = useState(true),
    [page, setPage] = useState(0);
  const weeks = data.gameweeks.filter((w) => w >= gw).slice(0, horizon);
  const total = (p: Player) => weeks.reduce((n, w) => n + xp(p, w), 0);
  const value = (p: Player, key: string) =>
    key === "total"
      ? total(p)
      : key === "price"
        ? p.price
        : key === "ownership"
          ? p.ownership
          : key === "xmins"
            ? p.xmins
            : key === "value"
              ? total(p) / p.price
              : key.startsWith("gw")
                ? xp(p, Number(key.slice(2)))
                : 0;
  const rows = useMemo(
    () =>
      data.players
        .filter(
          (p) =>
            (position === "ALL" || p.position === position) &&
            (!team || p.team === team) &&
            p.price <= budget &&
            p.xmins >= minMins &&
            (!watchOnly || watch.includes(p.id)) &&
            `${p.name} ${p.full_name} ${p.team_name}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort(
          (a, b) => (value(a, sort) - value(b, sort)) * (descending ? -1 : 1),
        ),
    [
      data,
      position,
      team,
      budget,
      minMins,
      watchOnly,
      watch,
      query,
      sort,
      descending,
      horizon,
      gw,
    ],
  );
  const sortHeader = (label: string, key: string) => (
    <button
      onClick={() => {
        setSort(key);
        setDescending(sort === key ? !descending : true);
      }}
    >
      {label}
      {sort === key ? (
        <ChevronDown size={12} className={!descending ? "rotate" : ""} />
      ) : (
        <ArrowDownUp size={11} />
      )}
    </button>
  );
  return (
    <>
      <div className="view-heading">
        <div>
          <span className="eyebrow">THE PLAYER EXPLORER</span>
          <h2>
            Find your next difference-maker<span>.</span>
          </h2>
          <p>Every player. Every fixture. The reasoning behind every point.</p>
        </div>
        <div className="button-row">
          <button className="button" onClick={onCSV}>
            <Upload size={15} />
            Import model
          </button>
          <button className="button" onClick={onExport}>
            <Download size={15} />
            Export CSV
          </button>
        </div>
      </div>
      <div className="table-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            aria-label="Search players"
            placeholder="Search players or clubs…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <div className="segmented">
          {["ALL", "GKP", "DEF", "MID", "FWD"].map((pos) => (
            <button
              key={pos}
              className={pos === position ? "active" : ""}
              onClick={() => {
                setPosition(pos);
                setPage(0);
              }}
            >
              {pos === "ALL" ? "All players" : pos}
            </button>
          ))}
        </div>
        <button
          className={`button small ${watchOnly ? "selected" : ""}`}
          onClick={() => {
            setWatchOnly(!watchOnly);
            setPage(0);
          }}
        >
          <Star size={14} />
          Watchlist
        </button>
      </div>
      <div className="filter-row">
        <label>
          Club
          <select
            value={team}
            onChange={(e) => {
              setTeam(Number(e.target.value));
              setPage(0);
            }}
          >
            <option value={0}>All clubs</option>
            {data.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Max price
          <select
            value={budget}
            onChange={(e) => {
              setBudget(Number(e.target.value));
              setPage(0);
            }}
          >
            {[20, 15, 12, 10, 8, 7, 6, 5, 4.5].map((v) => (
              <option key={v} value={v}>
                {v === 20 ? "Any price" : money(v)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Expected minutes
          <select
            value={minMins}
            onChange={(e) => {
              setMinMins(Number(e.target.value));
              setPage(0);
            }}
          >
            {[0, 30, 45, 60, 75].map((v) => (
              <option key={v} value={v}>
                {v === 0 ? "Any minutes" : `${v}+ minutes`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Forecast horizon
          <select
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
          >
            {[...new Set([1, 3, 6, 10, 14, 28, data.gameweeks.length])]
              .filter((v) => v <= data.gameweeks.length)
              .map((v) => (
                <option key={v} value={v}>
                  {v} gameweek{v > 1 ? "s" : ""}
                </option>
              ))}
          </select>
        </label>
        <span className="result-count">
          {rows.length} players <span>·</span> GW{weeks[0]}–{weeks.at(-1)}
        </span>
      </div>
      <div className="table-container">
        <table className="data-table projections-table">
          <thead>
            <tr>
              <th></th>
              <th className="name-col">PLAYER</th>
              <th>{sortHeader("PRICE", "price")}</th>
              <th>{sortHeader("OWNED", "ownership")}</th>
              <th>{sortHeader("xMINS", "xmins")}</th>
              {weeks.slice(0, 8).map((w) => (
                <th key={w}>{sortHeader(`GW${w}`, `gw${w}`)}</th>
              ))}
              <th className="total-col">{sortHeader("TOTAL", "total")}</th>
              <th>{sortHeader("xP / £m", "value")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(page * 40, page * 40 + 40).map((p) => (
              <tr key={p.id}>
                <td>
                  <button
                    className={`icon-button ${watch.includes(p.id) ? "starred" : ""}`}
                    onClick={() => onWatch(p.id)}
                    aria-label={`Watch ${p.name}`}
                  >
                    <Star
                      size={14}
                      fill={watch.includes(p.id) ? "currentColor" : "none"}
                    />
                  </button>
                </td>
                <td>
                  <PlayerName player={p} onClick={() => onDetail(p.id)} />
                </td>
                <td className="numeric">£{fmt(p.price)}</td>
                <td className="muted numeric">{fmt(p.ownership)}%</td>
                <td className="numeric">
                  {fmt(p.xmins, 0)}
                  {p.overridden && <i className="override-dot" />}
                </td>
                {weeks.slice(0, 8).map((w) => (
                  <td key={w}>
                    <button
                      className={`forecast-cell points-level-${Math.min(4, Math.floor(xp(p, w) / 2))}`}
                      onClick={() => onDetail(p.id)}
                      title={
                        p.gw[String(w)]?.prediction_source
                          ? `${p.gw[String(w)].prediction_source!.name} · ${p.gw[String(w)].prediction_source!.kind} · ${(p.gw[String(w)].prediction_source!.weight * 100).toFixed(0)}% influence`
                          : "Component model"
                      }
                    >
                      <b>
                        {fmt(xp(p, w))}
                        {p.gw[String(w)]?.prediction_source && (
                          <sup className="source-mark">
                            {p.gw[String(w)].prediction_source!.kind ===
                            "provider"
                              ? "P"
                              : "E"}
                          </sup>
                        )}
                      </b>
                      <small>
                        {p.gw[String(w)]?.fixtures
                          .map((f) => `${f.opponent}${f.home ? "" : " (A)"}`)
                          .join(" + ") || "—"}
                      </small>
                    </button>
                  </td>
                ))}
                <td className="total-col numeric">{fmt(total(p))}</td>
                <td className="muted numeric">{fmt(total(p) / p.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="inline-empty">No players match these filters.</div>
        )}
      </div>
      <div className="table-footer">
        <span>
          P: provider blend · E: extrapolated · Probabilities uncalibrated ·
          Select a player to inspect their forecast
        </span>
        <div>
          <span>
            {Math.min(rows.length, page * 40 + 1)}–
            {Math.min(rows.length, (page + 1) * 40)} of {rows.length}
          </span>
          <button
            className="icon-button"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-button"
            disabled={(page + 1) * 40 >= rows.length}
            onClick={() => setPage(page + 1)}
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </>
  );
}

export function FixturesView({ data, gw }: { data: Bootstrap; gw: number }) {
  const [metric, setMetric] = useState("difficulty"),
    [horizon, setHorizon] = useState(10),
    [sort, setSort] = useState("alphabetical");
  const weeks = data.gameweeks.filter((w) => w >= gw).slice(0, horizon);
  const representative = (team: number) =>
    data.players.find((p) => p.team === team);
  const teamScore = (id: number) =>
    weeks.reduce(
      (n, w) =>
        n +
        (representative(id)?.gw[String(w)]?.fixtures.reduce(
          (a, f) =>
            a +
            (metric === "cs"
              ? f.cs
              : metric === "goals"
                ? f.team_goals
                : 6 - f.difficulty),
          0,
        ) ?? 0),
      0,
    );
  const teams = [...data.teams].sort((a, b) =>
    sort === "alphabetical"
      ? a.name.localeCompare(b.name)
      : teamScore(b.id) - teamScore(a.id),
  );
  return (
    <>
      <div className="view-heading">
        <div>
          <span className="eyebrow">THE FIXTURE LANDSCAPE</span>
          <h2>
            Know where the opportunity is<span>.</span>
          </h2>
          <p>
            Official fixtures, market goal expectations, and clean-sheet
            probabilities.
          </p>
        </div>
        <div className="segmented">
          {[
            ["difficulty", "Difficulty"],
            ["goals", "Goals"],
            ["cs", "Clean sheets"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={metric === key ? "active" : ""}
              onClick={() => setMetric(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-row">
        <label>
          Horizon
          <select value={horizon} onChange={(e) => setHorizon(+e.target.value)}>
            {[...new Set([6, 10, 14, 28, data.gameweeks.length])]
              .filter((v) => v <= data.gameweeks.length)
              .map((v) => (
                <option key={v} value={v}>
                  {v} gameweeks
                </option>
              ))}
          </select>
        </label>
        <label>
          Sort teams
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="alphabetical">Alphabetical</option>
            <option value="opportunity">Best opportunity</option>
          </select>
        </label>
        <span className="fixture-legend">
          <i className="fdr-1" />
          Favourable
          <i className="fdr-3" />
          Neutral
          <i className="fdr-5" />
          Difficult
        </span>
      </div>
      <div className="table-container">
        <table className="data-table fixture-table">
          <thead>
            <tr>
              <th>CLUB</th>
              {weeks.map((w) => (
                <th key={w}>GW{w}</th>
              ))}
              <th>{metric === "difficulty" ? "AVG FDR" : "TOTAL"}</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => {
              const p = representative(t.id);
              return (
                <tr key={t.id}>
                  <td>
                    <div className="club-cell">
                      <Badge code={t.code} />
                      <b>{t.name}</b>
                    </div>
                  </td>
                  {weeks.map((w) => {
                    const fs = p?.gw[String(w)]?.fixtures ?? [];
                    return (
                      <td key={w}>
                        {fs.map((f) => (
                          <div
                            className={`fixture-chip fdr-${f.difficulty}`}
                            key={f.id}
                            title={`${t.name} v ${f.opponent} · ${f.source} · Updated ${f.source_at}`}
                          >
                            <b>
                              {f.opponent} <span>({f.home ? "H" : "A"})</span>
                            </b>
                            <small>
                              {metric === "cs"
                                ? `${fmt(f.cs * 100, 0)}% CS`
                                : metric === "goals"
                                  ? `${fmt(f.team_goals, 2)} xG`
                                  : `FDR ${f.difficulty}`}
                            </small>
                          </div>
                        ))}
                        {!fs.length && <span className="muted">Blank</span>}
                      </td>
                    );
                  })}
                  <td className="numeric">
                    {metric === "difficulty"
                      ? fmt(6 - teamScore(t.id) / Math.max(weeks.length, 1))
                      : metric === "cs"
                        ? fmt(teamScore(t.id), 2)
                        : fmt(teamScore(t.id), 1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="source-caption">
        <Info size={14} />
        FDR: official FPL difficulty. Goals / CS: FPL Joe market projections,
        then Elevenify, then an explicitly labelled historical fallback. Hover a
        fixture for its source.
      </div>
    </>
  );
}

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
};
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
  onDetail,
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
  onDetail: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [constraint, setConstraint] = useState<"locked" | "excluded">("locked");
  const change = (key: keyof SolverSettings, value: number) =>
    onSettings({ ...settings, [key]: value });
  const lookup = new Map(data.players.map((p) => [p.id, p]));
  const setConstraintPlayer = (id: number) =>
    onSettings({
      ...settings,
      [constraint]: settings[constraint].includes(id)
        ? settings[constraint].filter((v) => v !== id)
        : [...settings[constraint], id],
    });
  return (
    <>
      <div className="view-heading">
        <div>
          <span className="eyebrow">THE OPTIMISER</span>
          <h2>
            A better plan. Within your rules<span>.</span>
          </h2>
          <p>
            HiGHS integer optimisation across gameweeks, with budgets,
            transfers, lineups and captaincy.
          </p>
        </div>
        <span className="engine-label">
          <ShieldCheck size={16} />
          Constraint-checked on the server
        </span>
      </div>
      <div className="solver-layout">
        <section className="panel solver-settings">
          <div className="panel-heading">
            <SlidersHorizontal size={16} />
            <h3>Your strategy</h3>
          </div>
          <div className="field-grid">
            <label>
              Planning horizon
              <select
                value={settings.horizon}
                onChange={(e) => change("horizon", +e.target.value)}
              >
                {[1, 3, 4, 6, 8, 10, 14]
                  .filter((v) => gw + v - 1 <= data.gameweeks.at(-1)!)
                  .map((v) => (
                    <option value={v} key={v}>
                      {v} gameweeks
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
                {[0, 1, 2, 3, 5].map((v) => (
                  <option value={v} key={v}>
                    {v} transfers
                  </option>
                ))}
              </select>
            </label>
            <label>
              Saved FT value
              <input
                type="number"
                step="0.25"
                min="0"
                max="3.9"
                value={settings.ft_value}
                onChange={(e) => change("ft_value", +e.target.value)}
              />
              <small>Points value of keeping flexibility</small>
            </label>
            <label>
              Future-week weight
              <input
                type="number"
                step="0.01"
                min="0.5"
                max="1"
                value={settings.decay}
                onChange={(e) => change("decay", +e.target.value)}
              />
              <small>Each later GW is multiplied by this</small>
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
              <small>Linear approximation for bench usage</small>
            </label>
            <label>
              Solve time
              <select
                value={settings.seconds}
                onChange={(e) => change("seconds", +e.target.value)}
              >
                {[5, 15, 30, 45].map((v) => (
                  <option value={v} key={v}>
                    {v} seconds
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
          <div className="divider" />
          <div className="panel-heading">
            <LockKeyhole size={15} />
            <h3>Player constraints</h3>
          </div>
          <div className="segmented">
            <button
              className={constraint === "locked" ? "active" : ""}
              onClick={() => setConstraint("locked")}
            >
              Keep / include
            </button>
            <button
              className={constraint === "excluded" ? "active" : ""}
              onClick={() => setConstraint("excluded")}
            >
              Exclude
            </button>
          </div>
          <div className="constraint-tags">
            {settings[constraint].map((id) => (
              <button key={id} onClick={() => setConstraintPlayer(id)}>
                {lookup.get(id)?.name}
                <X size={12} />
              </button>
            ))}
          </div>
          <div className="search-box">
            <Search size={14} />
            <input
              aria-label="Find a player constraint"
              placeholder="Add a player constraint…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {query && (
            <div className="constraint-results">
              {data.players
                .filter((p) =>
                  p.name.toLowerCase().includes(query.toLowerCase()),
                )
                .slice(0, 6)
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setConstraintPlayer(p.id);
                      setQuery("");
                    }}
                  >
                    <Badge player={p} />
                    {p.name}
                    <span>{money(p.price)}</span>
                  </button>
                ))}
            </div>
          )}
          <button
            className="button primary full"
            disabled={busy || !plan}
            onClick={() => onSolve(false)}
          >
            <Sparkles size={16} />
            {busy ? "Searching feasible plans…" : "Optimise my plan"}
          </button>
          <button
            className="button full"
            disabled={busy}
            onClick={() => onSolve(true)}
          >
            Build a fresh £100m squad
          </button>
          <p className="help-text">
            Chips follow your planned schedule. The solver screens the candidate
            pool and reports its gap; forecast accuracy remains a separate
            question.
          </p>
        </section>
        <section className="solver-output">
          {busy && (
            <Busy text="Exploring transfers, formations and captain choices…" />
          )}
          {result ? (
            <>
              <div className="panel result-summary">
                <div>
                  <span className="eyebrow">BEST FEASIBLE PLAN</span>
                  <h3>
                    {result.weeks
                      .reduce((n, w) => n + w.net_points, 0)
                      .toFixed(1)}
                    <span> projected points</span>
                  </h3>
                  <p>
                    {result.status} · gap {fmt(result.gap * 100, 1)}% ·{" "}
                    {result.candidate_count} candidates
                  </p>
                </div>
                <button className="button primary" onClick={onApply}>
                  Use this plan
                  <ArrowUpRight size={16} />
                </button>
              </div>
              {result.weeks.map((w) => (
                <div className="panel result-week" key={w.gw}>
                  <div className="result-week-top">
                    <b>GW{w.gw}</b>
                    <span>{chipNames[w.chip]}</span>
                    <strong>
                      {fmt(w.net_points)}
                      <small> xP</small>
                    </strong>
                  </div>
                  <div className="result-transfers">
                    {w.transfers_in.length ? (
                      w.transfers_in.map((id, i) => (
                        <div key={id}>
                          <button
                            onClick={() =>
                              w.transfers_out[i] && onDetail(w.transfers_out[i])
                            }
                          >
                            {lookup.get(w.transfers_out[i])?.name ??
                              "New squad"}
                          </button>
                          <ArrowUpRight size={14} />
                          <button
                            className="green"
                            onClick={() => onDetail(id)}
                          >
                            {lookup.get(id)?.name}
                          </button>
                        </div>
                      ))
                    ) : (
                      <span className="green">
                        Roll the transfer · keep your flexibility
                      </span>
                    )}
                  </div>
                  <div className="result-week-foot">
                    <span>
                      Captain: <b>{lookup.get(w.captain)?.name}</b>
                    </span>
                    <span>
                      {w.hits ? `−${w.hits} hit` : "No hit"} · {money(w.bank)}{" "}
                      bank · {w.next_free_transfers} FT next
                    </span>
                  </div>
                </div>
              ))}
              <div className="assumptions">
                <h4>What this solve assumes</h4>
                {result.assumptions.map((a) => (
                  <p key={a}>
                    <Info size={13} />
                    {a}
                  </p>
                ))}
              </div>
            </>
          ) : (
            <div className="solver-intro">
              <Sparkles size={35} />
              <h3>Give your next move a second opinion.</h3>
              <p>
                Set your horizon and constraints, then search for a legal
                multiweek plan. Compare it against your own branch before
                applying it.
              </p>
              <div className="solver-promise">
                <ShieldCheck size={17} />
                15 players · £100m budget · 3 per club · legal formations
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export function AnalysisView({
  data,
  plans,
  active,
  evalData,
  onSnapshot,
  prospective,
  onScore,
}: {
  data: Bootstrap;
  plans: Plan[];
  active: Plan | null;
  evalData: Evaluation | null;
  onSnapshot: () => void;
  prospective: Prospective | null;
  onScore: () => void;
}) {
  const [scope, setScope] = useState<"starters" | "all">("starters");
  const metrics =
    scope === "starters" ? evalData?.models : evalData?.all_players;
  const comparison = plans.filter((p) => p.weeks.length);
  return (
    <>
      <div className="view-heading">
        <div>
          <span className="eyebrow">THE EVIDENCE</span>
          <h2>
            Good decisions need receipts<span>.</span>
          </h2>
          <p>
            Compare plans, inspect sources, and measure forecasts before
            trusting them.
          </p>
        </div>
        <button className="button" onClick={onSnapshot}>
          <Clock3 size={15} />
          Freeze pre-deadline forecast
        </button>
      </div>
      <ProspectiveView data={data} report={prospective} onScore={onScore} />
      <LeadTimeView
        data={data}
        captureKey={prospective?.captures?.[0]?.filename ?? ""}
      />
      {comparison.length > 0 && (
        <section className="panel analysis-plan">
          <div className="panel-heading">
            <Activity size={16} />
            <h3>Your planning branches</h3>
            <span>Projected points by gameweek</span>
          </div>
          <LineChart
            series={comparison.slice(0, 4).map((p) => ({
              name: p.name,
              values: p.weeks.map((w) => w.net_points ?? w.points),
            }))}
            labels={active?.weeks.map((w) => `GW${w.gw}`) ?? []}
          />
          <div className="branch-comparison">
            {comparison.map((p) => (
              <div key={p.id}>
                <span>{p.name}</span>
                <b>
                  {fmt(
                    p.weeks.reduce((n, w) => n + (w.net_points ?? w.points), 0),
                  )}{" "}
                  xP
                </b>
                <small>
                  {p.weeks.length} GWs ·{" "}
                  {p.weeks.reduce((n, w) => n + w.hits, 0)} hit points
                </small>
              </div>
            ))}
          </div>
          <p className="source-caption">
            Compare totals only over matching gameweek ranges. Current
            forecasts; captain included, automatic substitutions excluded.
          </p>
        </section>
      )}
      <div className="section-title">
        <div>
          <h3>Historical benchmark</h3>
          <p>2025/26 held out. Features update only after each gameweek.</p>
        </div>
        <div className="segmented">
          <button
            className={scope === "starters" ? "active" : ""}
            onClick={() => setScope("starters")}
          >
            Projected 45+ mins
          </button>
          <button
            className={scope === "all" ? "active" : ""}
            onClick={() => setScope("all")}
          >
            All players
          </button>
        </div>
      </div>
      {evalData?.available && metrics ? (
        <>
          <div className="benchmark-stats">
            {Object.entries(metrics).map(([name, m]) => (
              <div
                className={`panel benchmark-card ${name === "Component model" ? "ours" : ""}`}
                key={name}
              >
                <span className="eyebrow">{name}</span>
                <strong>
                  {fmt(m.mae, 3)}
                  <small> MAE</small>
                </strong>
                <p>
                  RMSE {fmt(m.rmse, 3)} · bias {m.bias >= 0 ? "+" : ""}
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
                yLabel="MAE (points)"
                series={[
                  {
                    name: "Component model",
                    values: evalData.gameweeks!.map((v) => v.component),
                  },
                  {
                    name: "ML challenger",
                    values: evalData.gameweeks!.map((v) => v.ml),
                  },
                  {
                    name: "Recent form",
                    values: evalData.gameweeks!.map((v) => v.form),
                  },
                ]}
                labels={evalData.gameweeks!.map((v) => `GW${v.gw}`)}
              />
              <p className="source-caption">
                Source: vaastav FPL archives · 2025/26 · projected 45+ minutes
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
                      <i style={{ width: `${(p.mae / 5) * 100}%` }} />
                    </div>
                    <b>{fmt(p.mae, 2)}</b>
                    <small>{p.count.toLocaleString()} rows</small>
                  </div>
                ))}
              </div>
              <p className="source-caption">
                MAE in points · same held-out starter cohort
              </p>
            </section>
          </div>
          <section className="panel methodology">
            <div className="panel-heading">
              <ShieldCheck size={16} />
              <h3>What this proves — and what remains open</h3>
            </div>
            <p>{evalData.method}</p>
            <p className="orange">
              Paid-provider competitiveness is unproven. Live forecasts use
              current market, Elevenify and optional FPL Form inputs; this
              backtest tests the component model with historical team estimates.
              The live blend and extrapolation require prospective evaluation.
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
              Evaluation generated{" "}
              {new Date(evalData.generated_at!).toLocaleString()} · Live model:{" "}
              {data.model_version}. ML challenger stays in research.
            </small>
          </section>
        </>
      ) : (
        <section className="panel">
          <Busy text={evalData?.message ?? "Loading historical evaluation…"} />
          <p className="help-text">
            Evaluation results appear here once the walk-forward run completes.
            No accuracy claim is assumed.
          </p>
        </section>
      )}
      <section className="panel sources-panel">
        <div className="panel-heading">
          <h3>Data provenance</h3>
          <span>{data.history_rows.toLocaleString()} historical records</span>
        </div>
        <div className="source-list">
          {Object.entries(data.sources)
            .filter(([key]) => !key.startsWith("fpl_live_"))
            .map(([key, source]) => (
              <div key={key}>
                <span
                  className={`status-dot ${source.status === "stale" || source.status === "unavailable" ? "stale" : ""}`}
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
                <span className="source-state">{source.status}</span>
              </div>
            ))}
        </div>
      </section>
    </>
  );
}

export function MarketView({ data, gw, onDetail, watch, onWatch }: BaseProps) {
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState("net");
  const players = data.players
    .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
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
  return (
    <>
      <div className="view-heading">
        <div>
          <span className="eyebrow">THE MARKET PULSE</span>
          <h2>
            Follow the movement<span>.</span>
          </h2>
          <p>
            Official transfer counts and price signals. Keep value in your
            planning equation.
          </p>
        </div>
        <span className="engine-label">
          <TrendingUp size={16} />
          Official FPL feed
        </span>
      </div>
      <div className="market-stats">
        <Stat
          label="TRANSFERS IN THIS GW"
          value={totalIn.toLocaleString()}
          note="Across the whole player pool"
        />
        <Stat
          label="MOST BOUGHT"
          value={
            [...data.players].sort((a, b) => b.transfers_in - a.transfers_in)[0]
              ?.name
          }
          note="Official gameweek transfers"
        />
        <Stat
          label="MOST SOLD"
          value={
            [...data.players].sort(
              (a, b) => b.transfers_out - a.transfers_out,
            )[0]?.name
          }
          note="Official gameweek transfers"
        />
        <Stat
          label="PRICE CHANGES"
          value={data.players.filter((p) => p.price_change !== 0).length}
          note="Players whose price moved this GW"
        />
      </div>
      <div className="table-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            placeholder="Search market…"
            aria-label="Search market players"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Sort market"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="net">Net transfers</option>
          <option value="price">Price change</option>
          <option value="signal">Official price signal</option>
        </select>
      </div>
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th></th>
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
            {players.slice(0, 80).map((p) => (
              <tr key={p.id}>
                <td>
                  <button
                    className={`icon-button ${watch.includes(p.id) ? "starred" : ""}`}
                    onClick={() => onWatch(p.id)}
                    aria-label={`Watch ${p.name}`}
                  >
                    <Star size={14} />
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
                <td className="numeric">{p.transfers_in.toLocaleString()}</td>
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
            ))}
          </tbody>
        </table>
      </div>
      <p className="source-caption">
        <Info size={14} />
        The official price signal is displayed as published by FPL. It is not a
        calibrated probability of a price change. Showing the top 80 matching
        players.
      </p>
    </>
  );
}

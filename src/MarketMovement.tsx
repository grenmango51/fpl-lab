import { useEffect, useMemo, useState } from "react";
import "./MarketMovement.css";

type Point = { extracted_at: string; provider_at: string | null; provider_time_kind: string; value: number | null; sha256: string; mapping_sha256: string; fixture_mapping_sha256: string };
type Series = { season: string; fixture_id: number; gameweek: number; home: string; away: string; team: string; source: string; metric: string; unit: string; points: Point[]; latest: Point; previous: Point | null; delta: number | null; state: string };
type History = { series: Series[]; coverage: { snapshots: number; fixtures: number; series: number; comparable_series: number; teams: string[]; gameweeks: number[]; first_extracted_at: string | null; last_extracted_at: string | null }; notes: string[]; diagnostics: Record<string, number> };
const date = (at: string | null) => at ? new Date(at).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Unknown";
const provider = (source: string) => source === "fpljoe" ? "FPL Joe" : "Elevenify sheet";
const value = (n: number | null, cs: boolean) => n === null ? "—" : `${n.toFixed(cs ? 1 : 2)}${cs ? "%" : ""}`;

function HistoryGraph({ rows, cs }: { rows: Series[]; cs: boolean }) {
  const points = rows.flatMap(row => row.points);
  const times = points.map(p => new Date(p.extracted_at).getTime());
  const first = Math.min(...times), last = Math.max(...times);
  const max = cs ? 100 : Math.max(1, ...points.map(p => p.value ?? 0)) * 1.1;
  const x = (at: string) => 48 + (new Date(at).getTime() - first) / Math.max(1, last - first) * 620;
  const y = (n: number) => 178 - n / max * 150;
  const colors = ["#ff764d", "#61ba9a"];
  return <div className="movement-graph"><svg viewBox="0 0 700 220" role="img" aria-label={`${cs ? "Clean-sheet percent" : "Expected goals"} over extraction time`}>
    {[0, 0.5, 1].map(f => <g key={f}><line x1="48" x2="668" y1={y(max * f)} y2={y(max * f)} stroke="#28354b" /><text x="40" y={y(max * f) + 4} textAnchor="end">{(max * f).toFixed(cs ? 0 : 1)}{cs ? "%" : ""}</text></g>)}
    {rows.map((row, i) => <g key={row.team}>{row.points.map((p, j) => {
      const prev = row.points[j - 1];
      return <g key={`${p.extracted_at}-${j}`}>{p.value !== null && prev?.value != null && <line x1={x(prev.extracted_at)} y1={y(prev.value)} x2={x(p.extracted_at)} y2={y(p.value)} stroke={colors[i % 2]} strokeWidth="2" />}{p.value !== null && <circle cx={x(p.extracted_at)} cy={y(p.value)} r="4" fill={colors[i % 2]}><title>{row.team} · {date(p.extracted_at)} · {value(p.value, cs)}</title></circle>}</g>;
    })}</g>)}
    <text x="48" y="205">{date(Number.isFinite(first) ? new Date(first).toISOString() : null)}</text><text x="668" y="205" textAnchor="end">{date(Number.isFinite(last) ? new Date(last).toISOString() : null)}</text>
  </svg><div className="movement-legend">{rows.map((row, i) => <span key={row.team} style={{ color: colors[i % 2] }}>{row.team} · {row.points.filter(p => p.value !== null).length} observations</span>)}</div><p>Dots are archived observations. Gaps remain missing; lines only join adjacent observations.</p></div>;
}

export function MarketMovement({ gw }: { gw: number }) {
  const [history, setHistory] = useState<History | null>(null), [error, setError] = useState("");
  const [week, setWeek] = useState(String(gw)), [team, setTeam] = useState(""), [source, setSource] = useState("fpljoe");
  const [window, setWindow] = useState("all"), [metric, setMetric] = useState("goals"), [fixture, setFixture] = useState("");
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => { setWeek(String(gw)); }, [gw]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch("/api/market-history", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`Market history unavailable (${response.status})`);
      const result = await response.json() as History; setHistory(result);
    }).catch((e: Error) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [revision]);
  const rows = useMemo(() => {
    const cutoff = window === "all" ? null : Date.now() - Number(window) * 86400000;
    return (history?.series ?? []).filter(row => (!week || row.gameweek === Number(week)) && (!team || row.team === team) && row.source === source && row.metric === metric).map(row => {
      const points = row.points.filter(p => cutoff === null || new Date(p.extracted_at).getTime() >= cutoff);
      const latest = points.at(-1), previous = [...points.slice(0, -1)].reverse().find(p => p.value !== null) ?? null;
      return latest ? { ...row, points, latest, previous, delta: latest.value !== null && previous ? latest.value - previous.value! : null, state: latest.value === null ? "missing_latest" : previous ? "comparable" : "single_snapshot" } : null;
    }).filter((row): row is Series => row !== null);
  }, [history, week, team, source, metric, window]);
  const fixtures = [...new Map(rows.map(row => [String(row.fixture_id), row])).values()];
  const selected = fixtures.find(row => String(row.fixture_id) === fixture) ?? fixtures[0];
  const chartRows = selected ? rows.filter(row => row.fixture_id === selected.fixture_id) : [];
  const cs = metric === "clean_sheet_probability";
  function download(format: "json" | "csv") {
    const quote = (s: unknown) => `"${String(s ?? "").replaceAll('"', '""')}"`;
    const text = format === "json" ? JSON.stringify({ coverage: history?.coverage, series: rows, notes: history?.notes }, null, 2) : [
      "season,fixture_id,gameweek,home,away,team,source,metric,unit,extracted_at,provider_at,provider_time_kind,value,sha256,mapping_sha256,fixture_mapping_sha256",
      ...rows.flatMap(row => row.points.map(p => [row.season, row.fixture_id, row.gameweek, row.home, row.away, row.team, row.source, row.metric, row.unit, p.extracted_at, p.provider_at, p.provider_time_kind, p.value, p.sha256, p.mapping_sha256, p.fixture_mapping_sha256].map(quote).join(","))),
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([text], { type: format === "json" ? "application/json" : "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `open-fpl-market-history.${format}`; a.click(); URL.revokeObjectURL(url);
  }
  async function capture() {
    setBusy(true); setError("");
    try { const r = await fetch("/api/market-history/capture", { method: "POST" }); if (!r.ok) throw new Error(`Capture unavailable (${r.status})`); setRevision(n => n + 1); }
    catch (e) { setError(e instanceof Error ? e.message : "Capture failed"); } finally { setBusy(false); }
  }
  return <section className="market-movement"><div className="movement-heading"><h2>Market movement</h2><span>Archived public inputs</span></div>
    <div className="movement-filters"><label>Gameweek<select aria-label="Movement gameweek" value={week} onChange={e => setWeek(e.target.value)}><option value="">All GWs</option>{history?.coverage.gameweeks.map(w => <option key={w} value={w}>GW{w}</option>)}</select></label><label>Team<select value={team} onChange={e => setTeam(e.target.value)}><option value="">All clubs</option>{history?.coverage.teams.map(t => <option key={t}>{t}</option>)}</select></label><label>Source<select value={source} onChange={e => setSource(e.target.value)}><option value="fpljoe">FPL Joe</option><option value="elevenify_sheet">Elevenify sheet</option></select></label><label>Window<select value={window} onChange={e => setWindow(e.target.value)}><option value="all">All archives</option><option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option></select></label></div>
    <div className="movement-actions"><div className="segmented"><button className={!cs ? "active" : ""} onClick={() => setMetric("goals")}>Goals</button><button className={cs ? "active" : ""} onClick={() => setMetric("clean_sheet_probability")}>Clean sheets</button></div><button disabled={busy} onClick={capture}>{busy ? "Saving…" : "Save cached inputs"}</button><button disabled={!rows.length} onClick={() => download("csv")}>CSV</button><button disabled={!rows.length} onClick={() => download("json")}>JSON</button></div>
    {error && <p role="alert" className="movement-error">{error}</p>}{!history && !error && <p>Loading archives…</p>}
    {history && <><p className="movement-coverage">{history.coverage.snapshots} distinct payloads · {history.coverage.fixtures} fixtures · {date(history.coverage.first_extracted_at)} – {date(history.coverage.last_extracted_at)}</p>
      {rows.length ? <><label className="movement-fixture">Fixture<select aria-label="Movement graph fixture" value={selected?.fixture_id ?? ""} onChange={e => setFixture(e.target.value)}>{fixtures.map(row => <option key={row.fixture_id} value={row.fixture_id}>GW{row.gameweek} · {row.home} v {row.away}</option>)}</select></label>{chartRows.some(row => row.points.some(p => p.value !== null)) ? <HistoryGraph rows={chartRows} cs={cs} /> : <p className="inline-empty">No supplied values for this fixture.</p>}<div className="movement-table-wrap"><table><thead><tr><th>Fixture</th><th>Club</th><th>Latest</th><th>Previous</th><th>Change</th><th>Extracted</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.fixture_id}-${row.team}`}><td>GW{row.gameweek} · {row.home} v {row.away}</td><td>{row.team}</td><td>{value(row.latest.value, cs)}</td><td>{value(row.previous?.value ?? null, cs)}</td><td className={row.delta !== null && row.delta !== 0 ? "movement-changed" : ""}>{row.delta === null ? row.state === "missing_latest" ? "Missing latest" : "Single snapshot" : `${row.delta > 0 ? "+" : ""}${row.delta.toFixed(cs ? 1 : 2)} ${cs ? "pp" : "goals"}`}</td><td title={`Provider snapshot: ${date(row.latest.provider_at)}`}>{date(row.latest.extracted_at)}</td></tr>)}</tbody></table></div></> : <p className="inline-empty">No archived observations in this window.</p>}
      <details><summary>Coverage & source times</summary><p>Changes compare the latest and previous available observation inside this window, for the same fixture, source and metric. CS changes use percentage points. Extraction is separate from provider publication.</p><p>Save preserves existing cached inputs; refresh public sources elsewhere to acquire new observations. Model scenarios never enter this history.</p>{history.notes.map(note => <p key={note}>{note}</p>)}<p>{Object.entries(history.diagnostics).filter(([, n]) => n).map(([reason, n]) => `${reason.replaceAll("_", " ")}: ${n}`).join(" · ") || "No archive exclusions."}</p>{chartRows.map(row => <p key={row.team}>{row.team} provider snapshot: {date(row.latest.provider_at)} · SHA256 {row.latest.sha256.slice(0, 12)}</p>)}</details>
    </>}
  </section>;
}

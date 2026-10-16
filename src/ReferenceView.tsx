import { useViewState } from "./useViewState";
import { matchesPlayerQuery } from "./playerSearch";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Search,
  Star,
} from "lucide-react";
import { PlayerName } from "./components";
import { download, fmt, money, xp } from "./lib";
import type { Bootstrap } from "./types";

const feedNames: Record<string, string> = {
  baselines: "Average-opponent attacking baselines",
  fast_fantasy: "Importance and captain shortlist",
  next_gw_attack: "Next-GW attacking forecasts",
  three_gw_goals: "Three-GW goal forecasts",
  three_gw_assists: "Three-GW assist forecasts",
};

export function ReferenceView({
  data,
  gw,
  onDetail,
  watch,
  onWatch,
}: {
  data: Bootstrap;
  gw: number;
  onDetail: (id: number) => void;
  watch: number[];
  onWatch: (id: number) => void;
}) {
  const [query, setQuery] = useViewState("market.references.query", "");
  const [position, setPosition] = useViewState(
    "market.references.position",
    "ALL",
  );
  const [sort, setSort] = useViewState("market.references.sort", "importance");
  const [page, setPage] = useViewState("market.references.page", 0);
  const [view, setView] = useViewState("market.references.view", "baseline");
  const [referenceGW, setReferenceGW] = useViewState(
    "market.references.gw",
    gw,
  );
  const source = data.reference_data;
  const baseline = view === "baseline";
  const feed = source?.feeds?.[view];
  const weeks = feed?.gameweeks ?? [];
  const selectedGW = baseline
    ? gw
    : weeks.includes(referenceGW)
      ? referenceGW
      : (weeks[0] ?? gw);
  const attack = (reference: NonNullable<typeof source>["players"][string]) =>
    baseline
      ? reference.attacking_baseline
      : reference.attacking_views?.[view]?.gameweeks[String(selectedGW)];
  const rows = data.players
    .flatMap((player) => {
      const reference = source?.players?.[String(player.id)];
      const supplied =
        reference &&
        (baseline
          ? reference.attacking_baseline !== undefined ||
            reference.future_importance !== undefined
          : attack(reference) !== undefined);
      return supplied ? [{ player, reference }] : [];
    })
    .filter(
      ({ player }) =>
        (position === "ALL" || player.position === position) &&
        matchesPlayerQuery(player, query),
    )
    .sort((a, b) => {
      const value = (row: typeof a) =>
        sort === "importance" && baseline
          ? (row.reference.future_importance ?? -1)
          : sort === "goals" || (sort === "importance" && !baseline)
            ? (attack(row.reference)?.goal ??
              attack(row.reference)?.assist ??
              -1)
            : sort === "involvement"
              ? (attack(row.reference)?.goal_involvement ?? -1)
              : sort === "assists"
                ? (attack(row.reference)?.assist ?? -1)
                : xp(row.player, selectedGW);
      return value(b) - value(a) || a.player.name.localeCompare(b.player.name);
    });
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const selectedPage = Math.min(page, pages - 1);
  const captainGW = source?.feeds?.fast_fantasy?.captain_gameweek;
  const activeFeeds = baseline ? ["baselines", "fast_fantasy"] : [view];
  function exportRows() {
    const csv = [
      "player_id,name,team,position,reference_view,reference_gameweek,conditioning,duration_minutes,future_importance_score,expected_goals_given_start,expected_assists_given_start,expected_involvement_given_start,captain_flag_gameweek,captain_flag,open_fpl_gameweek,open_fpl_points",
      ...rows.map(({ player: p, reference: r }) =>
        [
          p.id,
          `"${p.name.replaceAll('"', '""')}"`,
          p.team_short,
          p.position,
          baseline ? "average_opponent_baseline_and_importance" : view,
          baseline ? "" : selectedGW,
          baseline
            ? (r.attacking_baseline?.conditioning ?? "")
            : (r.attacking_views?.[view]?.conditioning ?? ""),
          "",
          baseline ? (r.future_importance ?? "") : "",
          attack(r)?.goal ?? "",
          attack(r)?.assist ?? "",
          attack(r)?.goal_involvement ?? "",
          baseline ? (r.captain_gameweek ?? "") : "",
          baseline ? (r.captain ? 1 : 0) : "",
          selectedGW,
          xp(p, selectedGW),
        ].join(","),
      ),
    ].join("\n");
    download(`open-fpl-elevenify-${view}-gw${selectedGW}.csv`, csv, "text/csv");
  }
  return (
    <>
      <div className="panel-heading reference-heading">
        <h3>Elevenify</h3>
        {source?.available && (
          <span>{source.coverage.matched_players} players</span>
        )}
        <button
          className="button small"
          onClick={exportRows}
          disabled={!rows.length}
        >
          <Download size={14} /> Export CSV
        </button>
      </div>
      {!source?.available ? (
        <section className="panel">
          <h3>References unavailable</h3>
          <p className="help-text">No validated provider table.</p>
        </section>
      ) : (
        <>
          <div className="table-toolbar reference-toolbar">
            <select
              aria-label="Reference view"
              value={view}
              onChange={(e) => {
                setView(e.target.value);
                setPage(0);
                setSort(
                  e.target.value === "baseline"
                    ? "importance"
                    : e.target.value === "three_gw_assists"
                      ? "assists"
                      : "goals",
                );
              }}
            >
              <option value="baseline">Baselines / shortlist</option>
              {["next_gw_attack", "three_gw_goals", "three_gw_assists"].map(
                (key) => (
                  <option key={key} value={key}>
                    {feedNames[key]}
                  </option>
                ),
              )}
            </select>
            {!baseline && (
              <select
                aria-label="Reference gameweek"
                value={selectedGW}
                onChange={(e) => {
                  setReferenceGW(Number(e.target.value));
                  setPage(0);
                }}
                disabled={!weeks.length}
              >
                {weeks.length ? (
                  weeks.map((week) => (
                    <option key={week} value={week}>
                      GW{week}
                    </option>
                  ))
                ) : (
                  <option value={selectedGW}>No supplied week</option>
                )}
              </select>
            )}
            <div className="search-box">
              <Search size={16} />
              <input
                aria-label="Search provider references"
                placeholder="Players or clubs · Haaland, Saka"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <select
              aria-label="Reference position"
              value={position}
              onChange={(e) => {
                setPosition(e.target.value);
                setPage(0);
              }}
            >
              <option value="ALL">All positions</option>
              {["GKP", "DEF", "MID", "FWD"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <select
              aria-label="Sort provider references"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(0);
              }}
            >
              {baseline && <option value="importance">Importance score</option>}
              <option value="goals">Expected goals</option>
              <option value="assists">Expected assists</option>
              <option value="involvement">Expected involvement</option>
              <option value="points">Open FPL xP</option>
            </select>
          </div>
          <div className="reference-status">
            <span
              className="subtle-tag"
              title="Goal and assist counts are conditional on starting; playing duration is not supplied."
            >
              Assumes a start · minutes unspecified
            </span>
            {activeFeeds.map((key) => {
              const selectedFeed = source.feeds[key];
              return (
                <span
                  key={key}
                  className={`source-state ${!selectedFeed?.available || selectedFeed.status === "stale" ? "orange" : ""}`}
                >
                  {baseline
                    ? `${key === "baselines" ? "Baselines" : "Shortlist"}: `
                    : ""}
                  {selectedFeed?.status ?? "unavailable"}
                </span>
              );
            })}
            {!baseline && feed?.caption_current === false && (
              <span className="source-state orange">
                Window {feed.window_status ?? "unknown"}
              </span>
            )}
          </div>
          <div className="table-container">
            <table className="data-table reference-table">
              <thead>
                <tr>
                  <th></th>
                  <th>PLAYER</th>
                  <th>PRICE</th>
                  {baseline && <th>IMPORTANCE / 100</th>}
                  <th>{baseline ? "GOALS" : `GW${selectedGW} GOALS`}</th>
                  <th>{baseline ? "ASSISTS" : `GW${selectedGW} ASSISTS`}</th>
                  <th>INVOLVEMENT</th>
                  {baseline && <th>CAPTAIN FLAG</th>}
                  <th>OPEN FPL GW{selectedGW} xP</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice(selectedPage * 25, (selectedPage + 1) * 25)
                  .map(({ player: p, reference: r }) => (
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
                      {baseline && (
                        <td className="numeric">
                          {r.future_importance === undefined ? (
                            "—"
                          ) : (
                            <span className="reference-score">
                              <i style={{ width: `${r.future_importance}%` }} />
                              <b>{fmt(r.future_importance, 0)}</b>
                            </span>
                          )}
                        </td>
                      )}
                      <td className="numeric">
                        {attack(r)?.goal === undefined
                          ? "—"
                          : fmt(attack(r)!.goal!, 2)}
                      </td>
                      <td className="numeric">
                        {attack(r)?.assist === undefined
                          ? "—"
                          : fmt(attack(r)!.assist!, 2)}
                      </td>
                      <td className="numeric">
                        {attack(r)?.goal_involvement === undefined
                          ? "—"
                          : fmt(attack(r)!.goal_involvement!, 2)}
                      </td>
                      {baseline && (
                        <td>
                          {r.captain ? (
                            <span
                              className={
                                r.captain_gameweek === gw
                                  ? "orange reference-captain"
                                  : "muted reference-captain"
                              }
                            >
                              <Star size={12} /> GW{r.captain_gameweek}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                      <td className="orange numeric">
                        {fmt(xp(p, selectedGW))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!rows.length && (
              <p className="help-text reference-no-results">
                No matching reference players.
              </p>
            )}
          </div>
          <div className="reference-pagination">
            <span>
              {rows.length} players · {selectedPage + 1} / {pages}
            </span>
            <div>
              <button
                className="icon-button"
                aria-label="Previous reference page"
                disabled={selectedPage === 0}
                onClick={() => setPage(selectedPage - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Next reference page"
                disabled={selectedPage === pages - 1}
                onClick={() => setPage(selectedPage + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          <details className="reference-limitations">
            <summary>
              <Info size={13} /> Help
            </summary>
            <p className="help-text">
              {baseline
                ? "Goal and assist baselines assume a start against an average Premier League team. Importance is a 0–100 ranking score with an unspecified horizon."
                : `GW${selectedGW} attacking counts assume a start. Next-GW and three-GW charts are separate series and can differ.`}{" "}
              Playing duration is unspecified. These references do not alter
              points forecasts. Open FPL xP uses its own appearance assumptions.
              Missing values mean no supplied reference.
            </p>
            {baseline ? (
              <p className="help-text">
                Captain flags apply only to their labelled gameweek
                {captainGW !== undefined && captainGW !== data.next_gw
                  ? `; the source's GW${captainGW} flag is not for the current next gameweek`
                  : ""}
                .
              </p>
            ) : (
              <p className="help-text">
                Only labelled weeks are shown. Missing outcomes are not inferred
                or summed across separate provider charts. {feed?.caption}
              </p>
            )}
            {source.limitations.map((note) => (
              <p className="help-text" key={note}>
                {note}
              </p>
            ))}
          </details>
        </>
      )}
      {source?.feeds && (
        <details className="reference-limitations reference-provenance">
          <summary>Source details</summary>
          <div className="reference-feed-grid">
            {Object.entries(source.feeds).map(([key, feed]) => (
              <div key={key}>
                <a href={feed.url} target="_blank" rel="noreferrer">
                  {feedNames[key] ?? key}
                </a>
                <span
                  className={`source-state ${!feed.available || feed.status === "stale" ? "orange" : ""}`}
                >
                  {feed.status}
                </span>
                <small>
                  {feed.caption} · {feed.units}
                </small>
                {feed.gameweeks?.length ? (
                  <small>
                    Labelled weeks:{" "}
                    {feed.gameweeks.map((week) => `GW${week}`).join(", ")} ·{" "}
                    {feed.window_status} window
                  </small>
                ) : null}
                <small>
                  Extracted{" "}
                  {feed.source_at
                    ? new Date(feed.source_at).toLocaleString()
                    : "unavailable"}{" "}
                  · {feed.matched_players}/{feed.row_count} rows matched
                </small>
                <small>
                  SHA-256 {feed.sha256?.slice(0, 16) ?? "unavailable"}
                  {feed.last_modified
                    ? ` · Provider modified ${feed.last_modified}`
                    : ""}
                </small>
                {feed.validation && <p className="orange">{feed.validation}</p>}
                {Object.values(feed.diagnostics).some(
                  (items) => items.length > 0,
                ) && (
                  <details>
                    <summary>Mapping diagnostics</summary>
                    <pre>{JSON.stringify(feed.diagnostics, null, 2)}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

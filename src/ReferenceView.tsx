import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Search,
  Star,
} from "lucide-react";
import { PlayerName, Stat } from "./components";
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
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [sort, setSort] = useState("importance");
  const [page, setPage] = useState(0);
  const [view, setView] = useState("baseline");
  const [referenceGW, setReferenceGW] = useState(gw);
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
        `${player.name} ${player.full_name} ${player.team_short}`
          .toLowerCase()
          .includes(query.toLowerCase()),
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
      <div className="view-heading">
        <div>
          <span className="eyebrow">PROVIDER REFERENCES</span>
          <h2>
            A second perspective<span>.</span>
          </h2>
          <p>
            Elevenify's selected-player tables, matched to the current FPL pool.
          </p>
        </div>
        <button
          className="button small"
          onClick={exportRows}
          disabled={!rows.length}
        >
          <Download size={14} /> Export references
        </button>
      </div>
      {!source?.available ? (
        <section className="panel">
          <h3>Reference tables unavailable</h3>
          <p className="help-text">
            No validated player table is available. Normal forecasts and
            planning continue using their existing sources.
          </p>
        </section>
      ) : (
        <>
          <div className="market-stats">
            <Stat
              label="MATCHED PLAYERS"
              value={source.coverage.matched_players}
              note={`Of ${source.coverage.official_players} current players`}
            />
            <Stat
              label="ATTACKING BASELINES"
              value={source.coverage.baseline_players}
              note="Assumes a start vs an average PL team"
            />
            <Stat
              label="IMPORTANCE SCORES"
              value={source.coverage.importance_players}
              note="Provider ranking, on a 0–100 scale"
            />
            <Stat
              label="ATTACKING FORECAST PLAYERS"
              value={source.coverage.attacking_players ?? 0}
              note="Players with fixture-specific attacking forecasts"
            />
          </div>
          <section className="panel reference-explanation">
            <Info size={17} />
            <p>
              {baseline ? (
                <>
                  Goal and assist baselines assume a start against an average
                  Premier League team. Duration is unspecified. Importance is a
                  ranking score with an unspecified horizon.
                </>
              ) : (
                <>
                  GW{selectedGW} expected attacking counts assume the player
                  starts; playing duration is unspecified. Only the provider's
                  labelled weeks are shown. Next-GW and three-GW charts are
                  separate series and can differ.
                </>
              )}{" "}
              These references do not alter points forecasts. The orange xP
              column is Open FPL's separate GW{selectedGW} forecast, including
              its own appearance assumptions.
            </p>
          </section>
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
              <option value="baseline">Baselines and shortlist</option>
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
                placeholder="Search player or club…"
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
          {!baseline && feed && (
            <p className="source-caption">
              {feed.caption} · {feed.status} · window{" "}
              {feed.window_status ?? "unknown"}
              {feed.caption_current === false
                ? "; does not start at the current next gameweek"
                : ""}
              .
            </p>
          )}
          <div className="table-container">
            <table className="data-table reference-table">
              <thead>
                <tr>
                  <th></th>
                  <th>PLAYER</th>
                  <th>PRICE</th>
                  {baseline && <th>IMPORTANCE / 100</th>}
                  <th>
                    {baseline ? "GOAL BASELINE" : `GW${selectedGW} GOALS`}
                  </th>
                  <th>
                    {baseline ? "ASSIST BASELINE" : `GW${selectedGW} ASSISTS`}
                  </th>
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
              {rows.length} matching players · page {selectedPage + 1} of{" "}
              {pages}
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
          <p className="source-caption">
            <Info size={14} /> Missing values mean no supplied reference.
            {baseline ? (
              <>
                Captain flags apply only to their labelled gameweek
                {captainGW !== undefined && captainGW !== data.next_gw
                  ? `; the source's GW${captainGW} flag is not for the current next gameweek`
                  : ""}
                .
              </>
            ) : (
              <>
                Counts are conditional on starting. Missing outcomes are not
                inferred or summed across separate provider charts.
              </>
            )}
          </p>
        </>
      )}
      {source?.feeds && (
        <section className="panel reference-provenance">
          <div className="panel-heading">
            <h3>Reference provenance</h3>
            <span>Local cached copies</span>
          </div>
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
          <details className="reference-limitations">
            <summary>Units, coverage and limitations</summary>
            {source.limitations.map((note) => (
              <p className="help-text" key={note}>
                {note}
              </p>
            ))}
          </details>
        </section>
      )}
    </>
  );
}

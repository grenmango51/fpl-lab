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
  const source = data.reference_data;
  const rows = data.players
    .flatMap((player) => {
      const reference = source?.players?.[String(player.id)];
      return reference ? [{ player, reference }] : [];
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
        sort === "importance"
          ? (row.reference.future_importance ?? -1)
          : sort === "goals"
            ? (row.reference.attacking_baseline?.goal ?? -1)
            : sort === "involvement"
              ? (row.reference.attacking_baseline?.goal_involvement ?? -1)
              : xp(row.player, gw);
      return value(b) - value(a) || a.player.name.localeCompare(b.player.name);
    });
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const selectedPage = Math.min(page, pages - 1);
  const captainGW = source?.feeds?.fast_fantasy?.captain_gameweek;
  function exportRows() {
    const csv = [
      "player_id,name,team,position,future_importance_score,goal_baseline_given_start,assist_baseline_given_start,involvement_baseline_given_start,captain_flag_gameweek,captain_flag,open_fpl_gameweek,open_fpl_points",
      ...rows.map(({ player: p, reference: r }) =>
        [
          p.id,
          `"${p.name.replaceAll('"', '""')}"`,
          p.team_short,
          p.position,
          r.future_importance ?? "",
          r.attacking_baseline?.goal ?? "",
          r.attacking_baseline?.assist ?? "",
          r.attacking_baseline?.goal_involvement ?? "",
          r.captain_gameweek ?? "",
          r.captain ? 1 : 0,
          gw,
          xp(p, gw),
        ].join(","),
      ),
    ].join("\n");
    download(`open-fpl-elevenify-references-gw${gw}.csv`, csv, "text/csv");
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
              label="REFERENCE STATUS"
              value={source.status}
              note="Season inferred from current player matches"
            />
          </div>
          <section className="panel reference-explanation">
            <Info size={17} />
            <p>
              Goal and assist baselines assume a start against an average
              Premier League team. Duration is unspecified. Importance is a
              ranking score with an unspecified horizon. These references do not
              alter points forecasts. The orange xP column is Open FPL's
              separate GW{gw} forecast.
            </p>
          </section>
          <div className="table-toolbar reference-toolbar">
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
              <option value="importance">Importance score</option>
              <option value="goals">Goal baseline</option>
              <option value="involvement">Goal involvement baseline</option>
              <option value="points">Open FPL xP</option>
            </select>
          </div>
          <div className="table-container">
            <table className="data-table reference-table">
              <thead>
                <tr>
                  <th></th>
                  <th>PLAYER</th>
                  <th>PRICE</th>
                  <th>IMPORTANCE / 100</th>
                  <th>GOAL BASELINE</th>
                  <th>ASSIST BASELINE</th>
                  <th>INVOLVEMENT</th>
                  <th>CAPTAIN FLAG</th>
                  <th>OPEN FPL GW{gw} xP</th>
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
                      <td className="numeric">
                        {r.attacking_baseline
                          ? fmt(r.attacking_baseline.goal, 2)
                          : "—"}
                      </td>
                      <td className="numeric">
                        {r.attacking_baseline
                          ? fmt(r.attacking_baseline.assist, 2)
                          : "—"}
                      </td>
                      <td className="numeric">
                        {r.attacking_baseline
                          ? fmt(r.attacking_baseline.goal_involvement, 2)
                          : "—"}
                      </td>
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
                      <td className="orange numeric">{fmt(xp(p, gw))}</td>
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
            Captain flags apply only to their labelled gameweek
            {captainGW !== undefined && captainGW !== data.next_gw
              ? `; the source's GW${captainGW} flag is not for the current next gameweek`
              : ""}
            .
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
                  {key === "baselines"
                    ? "Attacking baselines"
                    : "Fast Fantasy Model"}
                </a>
                <span
                  className={`source-state ${!feed.available || feed.status === "stale" ? "orange" : ""}`}
                >
                  {feed.status}
                </span>
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

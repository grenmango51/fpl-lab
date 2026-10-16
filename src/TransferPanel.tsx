import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Search, Star } from "lucide-react";
import { Badge, PlayerName } from "./components";
import { fmt, money, xp } from "./lib";
import { transferAllowance } from "./plannerInteractions";
import { matchesPlayerQuery } from "./playerSearch";
import type { Bootstrap, Plan, Player, Week } from "./types";

export function TransferPanel({
  data,
  plan,
  week,
  outgoing,
  busy,
  watch,
  onWatch,
  onTransfer,
  onInspect,
}: {
  data: Bootstrap;
  plan: Plan;
  week: Week;
  outgoing: Player;
  busy: boolean;
  watch: number[];
  onWatch: (id: number) => void;
  onTransfer: (id: number) => Promise<boolean>;
  onInspect: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [club, setClub] = useState(0);
  const [horizon, setHorizon] = useState(
    Math.min(5, data.gameweeks.filter((gw) => gw >= week.gw).length),
  );
  const [affordable, setAffordable] = useState(true);
  const [watched, setWatched] = useState(false);
  const [includeUnavailable, setIncludeUnavailable] = useState(false);
  const [sort, setSort] = useState("total");
  const [target, setTarget] = useState<Player | null>(null);
  const [error, setError] = useState("");
  const weeks = data.gameweeks.filter((gw) => gw >= week.gw).slice(0, horizon);
  const total = (player: Player) =>
    weeks.reduce((sum, gw) => sum + xp(player, gw), 0);
  const { sale, budget } = transferAllowance(plan, week, outgoing);
  const lookup = new Map(data.players.map((player) => [player.id, player]));
  const reason = (player: Player) =>
    player.price > budget + 0.001
      ? "Over budget"
      : week.squad.filter(
            (id) => id !== outgoing.id && lookup.get(id)?.team === player.team,
          ).length >= 3
        ? "3 players from club"
        : "";
  const rows = useMemo(
    () =>
      data.players
        .filter(
          (player) =>
            player.position_id === outgoing.position_id &&
            !week.squad.includes(player.id) &&
            (includeUnavailable ||
              (player.gw[String(week.gw)]?.xmins ?? 0) > 0) &&
            (!club || player.team === club) &&
            (!watched || watch.includes(player.id)) &&
            (!affordable || !reason(player)) &&
            matchesPlayerQuery(player, query),
        )
        .sort((a, b) =>
          sort === "price"
            ? a.price - b.price
            : sort === "gw"
              ? xp(b, week.gw) - xp(a, week.gw)
              : total(b) - total(a),
        ),
    [
      data,
      week,
      outgoing,
      club,
      watched,
      watch,
      affordable,
      query,
      sort,
      horizon,
      budget,
      includeUnavailable,
    ],
  );
  async function confirm() {
    if (!target || busy) return;
    setError("");
    if (!(await onTransfer(target.id)))
      setError(
        "Move rejected. Check the plan message below and choose another player.",
      );
  }
  return (
    <section className="transfer-panel" aria-label={`Replace ${outgoing.name}`}>
      <div className="transfer-resources">
        <span>
          Selling <b>{money(sale)}</b>
        </span>
        <span>
          Bank <b>{money(week.bank)}</b>
        </span>
        <span>
          Available <b className="orange">{money(budget)}</b>
        </span>
      </div>
      {target ? (
        <div className="transfer-confirm">
          <button
            className="button small"
            onClick={() => {
              setTarget(null);
              setError("");
            }}
            disabled={busy}
          >
            <ArrowLeft size={14} />
            Shortlist
          </button>
          <div className="transfer-pair">
            <div>
              <Badge player={outgoing} size={35} />
              <b>{outgoing.name}</b>
              <small>{money(sale)} selling</small>
            </div>
            <ArrowRight size={22} />
            <div>
              <Badge player={target} size={35} />
              <b>{target.name}</b>
              <small>{money(target.price)} buying</small>
            </div>
          </div>
          <div className="transfer-impact">
            <div>
              <small>Bank after</small>
              <b>{money(budget - target.price)}</b>
            </div>
            <div>
              <small>GW{week.gw} Δ xPts</small>
              <b
                className={
                  xp(target, week.gw) >= xp(outgoing, week.gw) ? "green" : "red"
                }
              >
                {fmt(xp(target, week.gw) - xp(outgoing, week.gw))}
              </b>
            </div>
            <div>
              <small>{weeks.length} GW Δ xPts</small>
              <b className={total(target) >= total(outgoing) ? "green" : "red"}>
                {fmt(total(target) - total(outgoing))}
              </b>
            </div>
          </div>
          <p className="source-caption">
            Player points before captaincy and hits.{" "}
            {week.chip === "freehit"
              ? "This Free Hit only."
              : "Carries into later planned weeks while the outgoing player is held."}
          </p>
          <div className="button-row">
            <button
              className="button primary"
              onClick={() => void confirm()}
              disabled={busy || Boolean(reason(target))}
            >
              <Check size={15} />
              {busy ? "Checking…" : "Confirm transfer"}
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => onInspect(target.id)}
            >
              Player details
            </button>
          </div>
          {error ? (
            <p className="transfer-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <details className="transfer-options">
            <summary>
              <Search size={13} />
              Search & filters<span>{rows.length} players</span>
            </summary>
            <div className="transfer-search">
              <div className="search-box">
                <Search size={15} />
                <input
                  aria-label="Search replacements"
                  placeholder={`Find a ${outgoing.position === "GKP" ? "goalkeeper" : outgoing.position.toLowerCase()}`}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <button
                className={`icon-button ${watched ? "starred" : ""}`}
                aria-label="Replacement watchlist"
                aria-pressed={watched}
                onClick={() => setWatched(!watched)}
              >
                <Star size={16} />
              </button>
            </div>
            <div className="transfer-filters">
              <select
                aria-label="Replacement club"
                value={club}
                onChange={(event) => setClub(+event.target.value)}
              >
                <option value={0}>All clubs</option>
                {data.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Replacement horizon"
                value={horizon}
                onChange={(event) => setHorizon(+event.target.value)}
              >
                {[
                  ...new Set([
                    1,
                    3,
                    5,
                    6,
                    10,
                    data.gameweeks.filter((gw) => gw >= week.gw).length,
                    horizon,
                  ]),
                ]
                  .filter(
                    (n) =>
                      n <= data.gameweeks.filter((gw) => gw >= week.gw).length,
                  )
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n} GWs
                    </option>
                  ))}
              </select>
              <select
                aria-label="Replacement sort"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="total">Best run</option>
                <option value="gw">Best this GW</option>
                <option value="price">Lowest price</option>
              </select>
            </div>
            <label className="transfer-affordable">
              <input
                type="checkbox"
                checked={affordable}
                onChange={(event) => setAffordable(event.target.checked)}
              />
              Available within budget & club limit
              <span>{rows.length} players</span>
            </label>
            <label className="transfer-affordable">
              <input
                type="checkbox"
                checked={includeUnavailable}
                onChange={(event) =>
                  setIncludeUnavailable(event.target.checked)
                }
              />
              Include zero projected minutes
            </label>
          </details>
          <div className="transfer-list">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Replacement</th>
                  <th>Price</th>
                  <th>GW{week.gw}</th>
                  <th>{weeks.length} GW Δ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((player) => (
                  <tr
                    key={player.id}
                    className={reason(player) ? "unavailable-transfer" : ""}
                  >
                    <td>
                      <PlayerName
                        player={player}
                        onClick={() => onInspect(player.id)}
                      />
                      {reason(player) ? (
                        <small className="transfer-limit">
                          {reason(player)}
                        </small>
                      ) : null}
                    </td>
                    <td>{money(player.price)}</td>
                    <td>{fmt(xp(player, week.gw))}</td>
                    <td
                      className={
                        total(player) >= total(outgoing) ? "green" : "red"
                      }
                    >
                      {total(player) >= total(outgoing) ? "+" : ""}
                      {fmt(total(player) - total(outgoing))}
                    </td>
                    <td>
                      <button
                        className="transfer-pick"
                        aria-label={`Choose ${player.name}`}
                        disabled={busy || Boolean(reason(player))}
                        onClick={() => setTarget(player)}
                      >
                        <ArrowRight size={16} />
                      </button>
                      <button
                        className={`icon-button ${watch.includes(player.id) ? "starred" : ""}`}
                        aria-label={`Watch ${player.name}`}
                        onClick={() => onWatch(player.id)}
                      >
                        <Star size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length ? (
              <p className="inline-empty">
                No replacements. Try changing the filters.
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

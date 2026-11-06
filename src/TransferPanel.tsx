import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Search,
  Star,
} from "lucide-react";
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
    plan.weeks.filter(
      (row) => row.gw >= week.gw && data.gameweeks.includes(row.gw),
    ).length || 1,
  );
  const [affordable, setAffordable] = useState(true);
  const [watched, setWatched] = useState(false);
  const [includeUnavailable, setIncludeUnavailable] = useState(false);
  const [sort, setSort] = useState("total");
  const [target, setTarget] = useState<Player | null>(null);
  const [error, setError] = useState("");
  const weeks = data.gameweeks.filter((gw) => gw >= week.gw).slice(0, horizon);
  const comparisonRange =
    weeks.length === 1 ? `GW${weeks[0]}` : `GW${weeks[0]}–${weeks.at(-1)}`;
  const total = (player: Player) =>
    weeks.reduce((sum, gw) => sum + xp(player, gw), 0);
  const allowance = useMemo(
    () => transferAllowance(plan, week, outgoing, data.players),
    [plan, week, outgoing, data.players],
  );
  const { bank, sale, budget, cancelsBuy } = allowance;
  const preview = target ? allowance.forTarget(target) : null;
  const lookup = new Map(data.players.map((player) => [player.id, player]));
  const reason = (player: Player) =>
    allowance.forTarget(player).bankAfter < 0
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
      allowance,
      includeUnavailable,
    ],
  );
  async function confirm() {
    if (!target || busy || reason(target)) return;
    setError("");
    if (!(await onTransfer(target.id)))
      setError(
        "Move rejected. Check the plan message below and choose another player.",
      );
  }
  return (
    <section className="transfer-panel" aria-label={`Replace ${outgoing.name}`}>
      <div className="transfer-budget">
        <span>
          Available <b>{money(budget)}</b>
        </span>
        <details className="transfer-budget-details">
          <summary aria-label="Budget details">
            Details <ChevronDown size={12} />
          </summary>
          <dl>
            <div>
              <dt>{cancelsBuy ? "Buy cancelled" : "Selling"}</dt>
              <dd>{money(sale)}</dd>
            </div>
            <div>
              <dt>Bank</dt>
              <dd>{money(bank)}</dd>
            </div>
          </dl>
        </details>
      </div>
      {target && preview ? (
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
              <small>
                {money(sale)} {cancelsBuy ? "buy cancelled" : "selling"}
              </small>
            </div>
            <ArrowRight size={22} />
            <div>
              <Badge player={target} size={35} />
              <b>{target.name}</b>
              <small>
                {money(preview.cost)}{" "}
                {preview.cancelsSale ? "sale cancelled" : "buying"}
              </small>
            </div>
          </div>
          <div className="transfer-impact">
            <div>
              <small>Bank after</small>
              <b>{money(preview.bankAfter)}</b>
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
              <small>{comparisonRange} Δ xPts</small>
              <b className={total(target) >= total(outgoing) ? "green" : "red"}>
                {fmt(total(target) - total(outgoing))}
              </b>
            </div>
          </div>
          <div className="transfer-hit-preview" role="status">
            <span>GW{week.gw} hit</span>
            <b className={preview.hits ? "red" : ""}>
              {preview.hits ? `−${preview.hits}` : "0"} pts
            </b>
            {preview.hits !== allowance.hits ? (
              <small>
                was {allowance.hits ? `−${allowance.hits}` : "0"} pts
              </small>
            ) : null}
          </div>
          <p className="source-caption">
            Player xPts before captaincy and hits.{" "}
            {week.chip === "freehit"
              ? "This Free Hit only."
              : "Carries into later weeks while held."}
          </p>
          <div className="button-row">
            <button
              className="button primary"
              onClick={() => void confirm()}
              disabled={busy || Boolean(reason(target))}
              title={reason(target) || undefined}
              aria-label={
                reason(target)
                  ? `Confirm transfer: ${reason(target)}`
                  : undefined
              }
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
          <div className="transfer-eligibility">
            <div
              className="segmented"
              role="group"
              aria-label="Replacement eligibility"
            >
              <button
                aria-pressed={affordable}
                className={affordable ? "active" : ""}
                title="Within budget and club limit"
                onClick={() => setAffordable(true)}
              >
                Affordable
              </button>
              <button
                aria-pressed={!affordable}
                className={!affordable ? "active" : ""}
                onClick={() => setAffordable(false)}
              >
                All players
              </button>
            </div>
            <span role="status">
              {rows.length} players · {comparisonRange}
            </span>
          </div>
          <details className="transfer-options">
            <summary>
              Filters <ChevronDown size={12} />
            </summary>
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
                    title={reason(player) || undefined}
                  >
                    <td>
                      <PlayerName
                        player={player}
                        onClick={() => onInspect(player.id)}
                      />
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
                        title={reason(player) || `Choose ${player.name}`}
                        aria-label={`Choose ${player.name}${reason(player) ? `: ${reason(player)}` : ""}`}
                        disabled={busy || Boolean(reason(player))}
                        onClick={() => {
                          if (!busy && !reason(player)) setTarget(player);
                        }}
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

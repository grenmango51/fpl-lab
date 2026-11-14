import { Badge, Modal, PlayerName } from "./components";
import { fmt } from "./lib";
import type { Bootstrap } from "./types";

export function FixtureDetail({
  data,
  team,
  gw,
  onClose,
  onDetail,
}: {
  data: Bootstrap;
  team: number;
  gw: number;
  onClose: () => void;
  onDetail?: (id: number, gw?: number) => void;
}) {
  const club = data.teams.find((row) => row.id === team);
  if (!club) return null;
  const effectiveGW = data.gameweeks.includes(gw) ? gw : data.next_gw;
  const weekKey = String(effectiveGW);
  const player =
    data.players.find(
      (row) => row.team === team && row.position_id === 1 && row.gw[weekKey],
    ) ?? data.players.find((row) => row.team === team && row.gw[weekKey]);
  const forecast = player?.gw[weekKey];
  const date = (value?: string | null, fallback = "Unknown") => {
    if (!value) return fallback;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime())
      ? parsed.toLocaleString("en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : fallback;
  };
  return (
    <Modal title={`${club.name} · GW${effectiveGW}`} onClose={onClose}>
      <div className="modal-body fixture-detail">
        {forecast?.fixtures.length ? (
          forecast.fixtures.map((fixture, index) => {
            const opponent = data.teams.find(
              (row) => row.id === fixture.opponent_id,
            );
            const otherPlayer =
              data.players.find(
                (row) =>
                  row.team === opponent?.id &&
                  row.position_id === 1 &&
                  row.gw[weekKey],
              ) ??
              data.players.find(
                (row) => row.team === opponent?.id && row.gw[weekKey],
              );
            const other = otherPlayer?.gw[weekKey];
            const otherIndex =
              other?.fixtures.findIndex((row) => row.id === fixture.id) ?? -1;
            const otherFixture = other?.fixtures[otherIndex];
            const cs =
              forecast.stat_scenario?.base.clean_sheet_probabilities[index] ??
              fixture.cs;
            const otherCS =
              otherIndex >= 0
                ? (other?.stat_scenario?.base.clean_sheet_probabilities[
                    otherIndex
                  ] ?? otherFixture?.cs)
                : undefined;
            const timeLabel = fixture.source.includes("public sheet")
              ? "Sheet time"
              : fixture.source.includes("historical fallback")
                ? "Generated"
                : "Provider time";
            const extractedAt =
              fixture.source_extracted_at ??
              (fixture.source.includes("sheet")
                ? data.sources.elevenify_sheet?.fetched_at
                : fixture.source.includes("Joe")
                  ? data.sources.fpljoe?.fetched_at
                  : undefined);
            const moved =
              fixture.original_event !== undefined &&
              fixture.original_event !== fixture.target_event;
            return (
              <article key={fixture.id}>
                <div className="fixture-detail-teams">
                  <div>
                    <Badge code={club.code} size={42} />
                    <b>{club.short_name}</b>
                    <small>{fixture.home ? "Home" : "Away"}</small>
                  </div>
                  <span>vs</span>
                  <div>
                    <Badge code={opponent?.code} size={42} />
                    <b>{opponent?.short_name ?? fixture.opponent}</b>
                    <small>{fixture.home ? "Away" : "Home"}</small>
                  </div>
                </div>
                <p className="fixture-detail-date">
                  <span>
                    {moved
                      ? `Moved to GW${fixture.target_event} · official ${fixture.original_event === null ? "unassigned" : `GW${fixture.original_event}`} (${date(fixture.original_kickoff, "TBC")})`
                      : date(fixture.kickoff, "TBC")}
                  </span>
                  {fixture.team_strength_scenario ? (
                    <>
                      {" "}
                      <span className="subtle-tag">Team strengths</span>
                    </>
                  ) : null}
                </p>
                <div className="fixture-detail-metrics">
                  <span>
                    <small>{club.short_name} goals</small>
                    <b>{fmt(fixture.team_goals, 2)}</b>
                  </span>
                  <span>
                    <small>
                      {opponent?.short_name ?? fixture.opponent} goals
                    </small>
                    <b>{fmt(fixture.conceded, 2)}</b>
                  </span>
                  <span>
                    <small>{club.short_name} CS</small>
                    <b>{fmt(cs * 100, 1)}%</b>
                  </span>
                  <span>
                    <small>{opponent?.short_name ?? fixture.opponent} CS</small>
                    <b>
                      {otherCS === undefined
                        ? "—"
                        : `${fmt(otherCS * 100, 1)}%`}
                    </b>
                  </span>
                </div>
                <details className="compact-details">
                  <summary>{fixture.source}</summary>
                  <p>
                    {timeLabel}: {date(fixture.source_at)}
                    {fixture.source_at_scope
                      ? ` (${fixture.source_at_scope})`
                      : ""}{" "}
                    · Extracted: {date(extractedAt)}
                  </p>
                  <p>
                    Pre-player-scenario team inputs; source label retains any
                    fallback.
                  </p>
                  {fixture.team_strength_scenario ? (
                    <p>
                      Base input:{" "}
                      {fmt(fixture.team_strength_scenario.base.team_goals, 2)} G
                      · {fmt(fixture.team_strength_scenario.base.conceded, 2)}{" "}
                      GA ·{" "}
                      {fmt(fixture.team_strength_scenario.base.cs * 100, 1)}% CS
                      (provider receipt unchanged).
                    </p>
                  ) : null}
                </details>
              </article>
            );
          })
        ) : (
          <p className="inline-empty">
            {forecast
              ? `Blank in GW${effectiveGW}.`
              : `Forecast unavailable for GW${effectiveGW}.`}
          </p>
        )}
        {onDetail ? (
          <>
            <h3>Player projections · GW{effectiveGW}</h3>
            <div className="fixture-detail-players">
              {data.players
                .filter((row) => row.team === team)
                .sort(
                  (a, b) =>
                    (b.gw[weekKey]?.points ?? -Infinity) -
                    (a.gw[weekKey]?.points ?? -Infinity),
                )
                .slice(0, 8)
                .map((row) => (
                  <div key={row.id}>
                    <PlayerName
                      player={row}
                      onClick={() => {
                        onClose();
                        onDetail(row.id, effectiveGW);
                      }}
                    />
                    <b>{row.gw[weekKey] ? fmt(row.gw[weekKey].points) : "—"}</b>
                  </div>
                ))}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

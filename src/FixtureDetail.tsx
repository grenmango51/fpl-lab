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
  const club = data.teams.find((row) => row.id === team)!;
  const player =
    data.players.find((row) => row.team === team && row.position_id === 1) ??
    data.players.find((row) => row.team === team);
  const forecast = player?.gw[String(gw)];
  const date = (value?: string | null) =>
    value
      ? new Date(value).toLocaleString("en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "Unknown";
  return (
    <Modal title={`${club.name} · GW${gw}`} onClose={onClose}>
      <div className="modal-body fixture-detail">
        {forecast?.fixtures.length ? (
          forecast.fixtures.map((fixture, index) => {
            const opponent = data.teams.find(
              (row) => row.id === fixture.opponent_id,
            );
            const otherPlayer =
              data.players.find(
                (row) => row.team === opponent?.id && row.position_id === 1,
              ) ?? data.players.find((row) => row.team === opponent?.id);
            const other = otherPlayer?.gw[String(gw)];
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
              ? "Sheet extraction"
              : fixture.source.includes("historical fallback")
                ? "Model generation"
                : "Provider time";
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
                  {fixture.original_event !== undefined &&
                  fixture.original_event !== fixture.target_event
                    ? `Your GW${fixture.target_event} · official ${fixture.original_event === null ? "GW unassigned" : `GW${fixture.original_event}`} · ${date(fixture.original_kickoff)}`
                    : date(fixture.kickoff)}
                </p>
                {fixture.team_strength_scenario ? (
                  <p className="subtle-tag">Your team-strength assumption</p>
                ) : null}
                <div className="fixture-detail-metrics">
                  <span>
                    <small>{club.short_name} goals</small>
                    <b>{fmt(fixture.team_goals, 2)}</b>
                  </span>
                  <span>
                    <small>{opponent?.short_name} goals</small>
                    <b>{fmt(fixture.conceded, 2)}</b>
                  </span>
                  <span>
                    <small>{club.short_name} CS</small>
                    <b>{fmt(cs * 100, 1)}%</b>
                  </span>
                  <span>
                    <small>{opponent?.short_name} CS</small>
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
                      ? ` · ${fixture.source_at_scope}`
                      : ""}
                  </p>
                  <p>
                    Extracted:{" "}
                    {date(
                      fixture.source_extracted_at ??
                        (fixture.source.includes("sheet")
                          ? data.sources.elevenify_sheet?.fetched_at
                          : fixture.source.includes("Joe")
                            ? data.sources.fpljoe?.fetched_at
                            : undefined),
                    )}
                  </p>
                  <p>
                    Team inputs before player scenarios. Fallback status is
                    retained in the source label.
                  </p>
                  {fixture.team_strength_scenario ? (
                    <p>
                      Original input:{" "}
                      {fmt(fixture.team_strength_scenario.base.team_goals, 2)}{" "}
                      goals ·{" "}
                      {fmt(fixture.team_strength_scenario.base.conceded, 2)}{" "}
                      conceded ·{" "}
                      {fmt(fixture.team_strength_scenario.base.cs * 100, 1)}%
                      CS. Your assumption scales attack and conceded hazard; the
                      provider receipt above is unchanged.
                    </p>
                  ) : null}
                </details>
              </article>
            );
          })
        ) : (
          <p className="inline-empty">No scheduled fixture in GW{gw}.</p>
        )}
        {onDetail ? (
          <>
            <h3>Player projections · GW{gw}</h3>
            <div className="fixture-detail-players">
              {data.players
                .filter((row) => row.team === team)
                .sort(
                  (a, b) =>
                    (b.gw[String(gw)]?.points ?? 0) -
                    (a.gw[String(gw)]?.points ?? 0),
                )
                .slice(0, 8)
                .map((row) => (
                  <div key={row.id}>
                    <PlayerName
                      player={row}
                      onClick={() => {
                        onClose();
                        onDetail(row.id, gw);
                      }}
                    />
                    <b>{fmt(row.gw[String(gw)]?.points ?? 0)}</b>
                  </div>
                ))}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

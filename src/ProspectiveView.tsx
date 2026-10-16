import { Clock3, Info } from "lucide-react";
import { fmt } from "./lib";
import type { Bootstrap, Prospective } from "./types";

export function ProspectiveView({
  data,
  report,
  onScore,
}: {
  data: Bootstrap;
  report: Prospective | null;
  onScore: () => void;
}) {
  return (
    <section className="panel prospective-panel">
      <div className="panel-heading">
        <Clock3 size={16} />
        <h3>Forecast results</h3>
        <button className="button small" onClick={onScore}>
          Score weeks
        </button>
      </div>
      {!!report?.captures?.length && (
        <div className="capture-receipts">
          {report.captures.slice(0, 5).map((c) => {
            const receipt = c.capture_receipt;
            const keys = receipt
              ? [...new Set(Object.values(receipt.required_sources).flat())]
              : [];
            const event = data.events.find((e) => e.id === c.gw);
            return (
              <details key={c.filename} className="capture-receipt">
                <summary>
                  <b>GW{c.gw}</b>
                  <span>{fmt(c.lead_hours, 1)}h before deadline</span>
                  <span
                    className={`source-state ${receipt?.eligible_primary["Live ensemble"] ? "" : "orange"}`}
                    title="Source freshness at capture"
                  >
                    {receipt
                      ? receipt.eligible_primary["Live ensemble"]
                        ? "Fresh inputs"
                        : "Exploratory"
                      : "Legacy"}
                  </span>
                  <em>
                    {report.gameweeks.some((week) => week.gw === c.gw)
                      ? "Scored"
                      : event?.finished
                        ? "Not scored"
                        : "Pending"}
                  </em>
                </summary>
                <p className="help-text">
                  Captured {new Date(c.recorded_at).toLocaleString()} ·{" "}
                  {c.players} players
                </p>
                {receipt ? (
                  <>
                    <div className="capture-eligibility">
                      {Object.entries(receipt.eligible_primary).map(
                        ([name, eligible]) => (
                          <div key={name}>
                            <span>{name}</span>
                            <b className={eligible ? "green" : "orange"}>
                              {eligible ? "Fresh" : "Exploratory"}
                            </b>
                            {receipt.eligibility_reasons[name]?.map((note) => (
                              <small key={note}>{note}</small>
                            ))}
                          </div>
                        ),
                      )}
                    </div>
                    <div className="table-container">
                      <table className="data-table capture-sources">
                        <thead>
                          <tr>
                            <th>SOURCE</th>
                            <th>STATUS</th>
                            <th>AGE AT CAPTURE</th>
                            <th>EXTRACTED</th>
                            <th>CONTENT</th>
                            <th>HASH</th>
                          </tr>
                        </thead>
                        <tbody>
                          {keys.map((key) => {
                            const source = receipt.sources[key];
                            return (
                              <tr key={key}>
                                <td>{key.replaceAll("_", " ")}</td>
                                <td
                                  className={
                                    source?.status === "stale" || !source
                                      ? "orange"
                                      : "muted"
                                  }
                                >
                                  {source?.status ?? "unavailable"}
                                </td>
                                <td>
                                  {source?.age_seconds === null ||
                                  source?.age_seconds === undefined
                                    ? "Unknown"
                                    : `${fmt(source.age_seconds / 60, 1)} min`}
                                </td>
                                <td>
                                  {source?.fetched_at
                                    ? new Date(
                                        source.fetched_at,
                                      ).toLocaleString()
                                    : "Unknown"}
                                </td>
                                <td>
                                  {!source?.refetched
                                    ? "Cached"
                                    : source.content_changed === null
                                      ? "Refetched"
                                      : source.content_changed
                                        ? "Changed"
                                        : "Same content"}
                                </td>
                                <td className="muted">
                                  {source?.sha256?.slice(0, 12) ?? "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="source-caption">
                      <Info size={13} /> Fresh-input policy: used sources
                      extracted within {receipt.max_source_age_seconds / 60}{" "}
                      minutes, with validated live/cached status. Refetching
                      unchanged data advances extraction time, not the
                      provider's publication time. {c.players} captured players.
                    </p>
                  </>
                ) : (
                  <p className="help-text">
                    Legacy capture: no freshness receipt. Its predictions remain
                    available for exploratory scoring.
                  </p>
                )}
                <small className="muted">{c.filename}</small>
              </details>
            );
          })}
        </div>
      )}
      {report?.gameweeks.length ? (
        report.gameweeks.map((w) => (
          <div className="prospective-result" key={w.gw}>
            <div className="panel-heading">
              <h3>GW{w.gw}</h3>
              <span>
                Live MAE {w.count ? fmt(w.mae, 3) : "—"} · {w.count} players
              </span>
            </div>
            {w.pairwise_comparisons ? (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>MODEL</th>
                      <th>COVERAGE</th>
                      <th>PLAYERS</th>
                      <th>MODEL MAE</th>
                      <th>LIVE MAE</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(w.pairwise_comparisons).map(
                      ([name, comparison]) => (
                        <tr key={name}>
                          <td>{name}</td>
                          <td>
                            {w.coverage?.[name]?.forecast_count ??
                              comparison.count}
                            /{w.coverage?.[name]?.eligible_count ?? w.count}
                          </td>
                          <td>{comparison.count}</td>
                          <td>
                            {comparison.model
                              ? fmt(comparison.model.mae, 3)
                              : "—"}
                          </td>
                          <td>
                            {comparison.ensemble
                              ? fmt(comparison.ensemble.mae, 3)
                              : "—"}
                          </td>
                          <td
                            className={
                              comparison.eligible_primary ? "green" : "orange"
                            }
                          >
                            {comparison.eligibility}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="benchmark-stats">
                {Object.entries(w.models ?? {}).map(([name, metric]) => (
                  <div className="benchmark-card" key={name}>
                    <span className="eyebrow">{name}</span>
                    <strong>
                      {fmt(metric.mae, 3)}
                      <small> MAE</small>
                    </strong>
                    <p>
                      RMSE {fmt(metric.rmse, 3)} · {metric.count} players
                    </p>
                  </div>
                ))}
              </div>
            )}
            <details className="reference-limitations">
              <summary>Method and coverage</summary>
              <p className="help-text">
                {w.cohort?.selection ??
                  "Legacy captured ensemble projected 45+ minutes"}
                . {w.cohort?.eligible_count ?? w.count} eligible players ·{" "}
                {w.cohort?.missing_actual_ids.length ?? 0} missing outcomes.
                Pairwise rows can use different subsets; compare each model with
                the live value in its own row.
              </p>
              {Object.entries(w.pairwise_comparisons ?? {}).map(
                ([name, comparison]) => (
                  <div key={name}>
                    <b>{name}</b>
                    <p className="help-text">
                      Missing forecasts:{" "}
                      {w.coverage?.[name]?.missing_forecast_count ?? "unknown"};
                      invalid forecasts:{" "}
                      {w.coverage?.[name]?.invalid_forecast_count ?? "unknown"}.
                    </p>
                    {comparison.eligibility_reasons.map((reason) => (
                      <p className="help-text" key={reason}>
                        {reason}
                      </p>
                    ))}
                  </div>
                ),
              )}
              <p className="help-text">
                All-model shared cohort: {w.common_cohort_count ?? "unknown"}{" "}
                players. Outcome source: {w.actual_source?.status ?? "unknown"}{" "}
                · {w.actual_source?.sha256?.slice(0, 12) ?? "no hash"}. Official
                data checked:{" "}
                {w.actual_data_checked === true
                  ? "yes"
                  : w.actual_data_checked === false
                    ? "no"
                    : "unknown"}
                .
              </p>
            </details>
          </div>
        ))
      ) : (
        <p className="help-text">No scored weeks yet.</p>
      )}
      {report?.excluded_gameweeks?.map((w) => (
        <p className="orange help-text" key={w.gw}>
          GW{w.gw} · Not scored. {w.reason}
        </p>
      ))}
      <details className="reference-limitations">
        <summary>
          <Info size={13} /> Method
        </summary>
        <p className="help-text">
          Capture refreshes live inputs before freezing all model forecasts from
          one dataset. Comparisons use the same captured players after official
          outcomes are checked. Missing provider values remain missing.
        </p>
        {report?.method && <p className="help-text">{report.method}</p>}
        {data.forecast_layers?.map((layer) => (
          <p className="help-text" key={layer.name}>
            {layer.kind === "user-scenario" ? (
              `${layer.name} · your assumptions; exploratory evaluation.`
            ) : (
              <>
                {layer.name} · {fmt((layer.weight ?? 0) * 100, 0)}% weight ·{" "}
                {layer.direct_forecasts?.toLocaleString() ?? "Unknown"} direct /{" "}
                {layer.extrapolated_forecasts?.toLocaleString() ?? "Unknown"}{" "}
                extrapolated · {layer.half_life ?? "Unknown"}-GW influence
                half-life.
              </>
            )}
          </p>
        ))}
      </details>
    </section>
  );
}

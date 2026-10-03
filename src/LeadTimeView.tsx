import { useEffect, useState } from "react";
import { Clock3, Download, Info } from "lucide-react";
import { api, download, fmt } from "./lib";
import type { Bootstrap, LeadTimeReport } from "./types";

export function LeadTimeView({
  captureKey,
  data,
}: {
  captureKey: string;
  data: Bootstrap;
}) {
  const [report, setReport] = useState<LeadTimeReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("Component model");
  const [scope, setScope] = useState<"primary" | "all" | "exploratory">(
    "primary",
  );
  useEffect(() => {
    let alive = true;
    api<LeadTimeReport>("/lead-time")
      .then((value) => {
        if (alive) {
          setReport(value);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [captureKey]);
  async function score() {
    setBusy(true);
    setError("");
    try {
      setReport(await api<LeadTimeReport>("/lead-time/score", {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const bins = report?.inventory.bins ?? [];
  const targets = bins.flatMap((bin) => bin.captured_targets);
  const models = [
    ...new Set([
      "Component model",
      "FPL Form",
      ...(report?.bins ?? []).flatMap((bin) =>
        Object.keys(bin.pairwise_comparisons).filter(
          (name) => name !== "Live ensemble",
        ),
      ),
    ]),
  ];
  const scored = report?.bins?.flatMap((bin) => bin.gameweeks) ?? [];
  const club = (id: number) =>
    data.teams.find((team) => team.id === id)?.short_name ?? `#${id}`;
  const unscored = targets.some(
    (target) =>
      target.status === "ready_for_scoring" &&
      !scored.some(
        (row) =>
          row.gw === target.gw &&
          row.snapshot === target.snapshot &&
          row.lead_hours === target.lead_hours,
      ),
  );
  return (
    <section className="panel lead-time-panel">
      <div className="panel-heading">
        <Clock3 size={16} />
        <h3>Forecasts by time before deadline</h3>
        <button className="button small" onClick={score} disabled={busy}>
          {busy ? "Scoring…" : "Score lead times"}
        </button>
        <button
          className="icon-button"
          aria-label="Export lead-time report"
          disabled={!report}
          onClick={() =>
            report &&
            download(
              "open-fpl-lead-time.json",
              JSON.stringify(report, null, 2),
              "application/json",
            )
          }
        >
          <Download size={15} />
        </button>
      </div>
      <p className="help-text">
        Every new capture freezes the remaining season. Each time window selects
        its latest valid capture for each target gameweek. This tests the live
        blend and its extrapolation as official outcomes become available.
      </p>
      {error && (
        <p className="orange help-text">
          {error}{" "}
          <button className="text-button" onClick={score} disabled={busy}>
            Retry scoring
          </button>
        </p>
      )}
      <div className="lead-time-bins">
        {bins.map((bin) => {
          const aggregate = report?.bins?.find((saved) => saved.id === bin.id)
            ?.pairwise_comparisons[model]?.[scope];
          return (
            <div className="lead-time-bin" key={bin.id}>
              <span className="eyebrow">{bin.label}</span>
              <strong>
                {aggregate?.ensemble ? fmt(aggregate.ensemble.mae, 3) : "—"}
                <small> live MAE</small>
              </strong>
              <p>
                {aggregate?.count ?? 0} matched player-GWs ·{" "}
                {aggregate?.gameweek_count ?? 0} scored GWs
              </p>
              <span className="muted">
                {bin.capture_count} captured targets · {bin.pending_count}{" "}
                pending
              </span>
            </div>
          );
        })}
      </div>
      {!targets.length && (
        <p className="help-text">
          Freeze a pre-deadline forecast to start collecting lead-time evidence.
        </p>
      )}
      {!!targets.length && !scored.length && (
        <p className="source-caption">
          <Info size={14} /> Captures are saved; no selected gameweek has a
          scored result yet. Dashes mean unavailable results.
        </p>
      )}
      {unscored && (
        <p className="orange help-text">
          New selected captures are ready for scoring. Saved metrics may use
          earlier captures until you score again.
        </p>
      )}
      <div className="table-toolbar">
        <select
          aria-label="Lead-time comparison model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {models.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select
          aria-label="Lead-time eligibility"
          value={scope}
          onChange={(e) =>
            setScope(e.target.value as "primary" | "all" | "exploratory")
          }
        >
          <option value="primary">Primary eligible</option>
          <option value="all">All scored captures</option>
          <option value="exploratory">Exploratory captures</option>
        </select>
        <span className="muted">
          Live ensemble compared with {model} on identical player-GW rows
        </span>
      </div>
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>TIME BEFORE DEADLINE</th>
              <th>MATCHED ROWS</th>
              <th>LIVE MAE</th>
              <th>{model.toUpperCase()} MAE</th>
              <th>LIVE RMSE</th>
              <th>LIVE BIAS</th>
            </tr>
          </thead>
          <tbody>
            {bins.map((bin) => {
              const value = report?.bins?.find((saved) => saved.id === bin.id)
                ?.pairwise_comparisons[model]?.[scope];
              return (
                <tr key={bin.id}>
                  <td>{bin.label}</td>
                  <td>{value?.count ?? 0}</td>
                  <td className="orange">
                    {value?.ensemble ? fmt(value.ensemble.mae, 3) : "—"}
                  </td>
                  <td>{value?.model ? fmt(value.model.mae, 3) : "—"}</td>
                  <td>{value?.ensemble ? fmt(value.ensemble.rmse, 3) : "—"}</td>
                  <td>{value?.ensemble ? fmt(value.ensemble.bias, 3) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details className="reference-limitations">
        <summary>Selected captures, coverage and individual results</summary>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>TIME WINDOW</th>
                <th>TARGET</th>
                <th>ACTUAL LEAD</th>
                <th>STATUS</th>
                <th>PROVIDER COVERAGE</th>
                <th>INPUT ORIGIN</th>
                <th>CONFIGURATION</th>
                <th>FROZEN SCHEDULE</th>
              </tr>
            </thead>
            <tbody>
              {bins.flatMap((bin) =>
                bin.captured_targets.map((target) => (
                  <tr key={`${bin.id}-${target.gw}`}>
                    <td>{bin.label}</td>
                    <td>GW{target.gw}</td>
                    <td>{fmt(target.lead_hours / 24, 1)} days</td>
                    <td
                      className={target.deadline_changed ? "orange" : "muted"}
                    >
                      {target.status.replaceAll("_", " ")}
                      {target.deadline_changed ? " · deadline changed" : ""}
                    </td>
                    <td>
                      {target.coverage["FPL Form"]?.forecast_count ?? 0}/
                      {target.cohort.eligible_count} eligible
                    </td>
                    <td>GW{target.origin_gameweek}</td>
                    <td>
                      {target.model_version} ·{" "}
                      {target.configuration_hash?.slice(0, 8) ?? "legacy"}
                      {target.manual_configuration
                        ? " · manual assumptions"
                        : ""}
                    </td>
                    <td>
                      {target.fixtures ? (
                        <details>
                          <summary
                            className={
                              target.fixture_schedule_changed
                                ? "orange"
                                : "muted"
                            }
                          >
                            {target.fixtures.length} fixtures
                            {target.fixture_schedule_changed
                              ? " · changed"
                              : ""}
                          </summary>
                          {target.fixtures.map((fixture) => (
                            <p className="help-text" key={fixture.id}>
                              {club(fixture.team_h)} vs {club(fixture.team_a)} ·{" "}
                              {fixture.kickoff_time
                                ? new Date(
                                    fixture.kickoff_time,
                                  ).toLocaleString()
                                : "Unscheduled"}
                            </p>
                          ))}
                        </details>
                      ) : (
                        "Legacy: unavailable"
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        {(report?.bins ?? []).flatMap((bin) =>
          bin.gameweeks.map((target) => (
            <details key={`${bin.id}-${target.gw}`} className="capture-receipt">
              <summary>
                GW{target.gw} · {bin.label} · {fmt(target.lead_hours / 24, 1)}{" "}
                days before deadline
              </summary>
              <small className="muted">
                {target.snapshot} · frozen deadline{" "}
                {new Date(target.deadline).toLocaleString()}
                {target.deadline_changed
                  ? ` · current deadline ${new Date(target.current_deadline).toLocaleString()}`
                  : ""}
              </small>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>MODEL</th>
                      <th>MATCHED PLAYERS</th>
                      <th>MODEL MAE</th>
                      <th>LIVE MAE</th>
                      <th>ELIGIBILITY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(target.pairwise_comparisons ?? {}).map(
                      ([name, pair]) => (
                        <tr key={name}>
                          <td>{name}</td>
                          <td>{pair.count}</td>
                          <td>{pair.model ? fmt(pair.model.mae, 3) : "—"}</td>
                          <td>
                            {pair.ensemble ? fmt(pair.ensemble.mae, 3) : "—"}
                          </td>
                          <td
                            className={
                              pair.eligible_primary ? "green" : "orange"
                            }
                          >
                            {pair.eligibility}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              {Object.entries(target.pairwise_comparisons ?? {}).flatMap(
                ([name, pair]) =>
                  pair.eligibility_reasons.map((reason) => (
                    <p className="help-text" key={`${name}-${reason}`}>
                      {name}: {reason}
                    </p>
                  )),
              )}
            </details>
          )),
        )}
      </details>
      <p className="source-caption">
        <Info size={14} /> Metrics pool individual matched player-GW errors
        within each window. Cohorts, model versions and manual assumptions can
        differ across windows; the same outcomes recur across windows. These are
        descriptive results, with no claim that one horizon is more accurate
        until those differences are controlled. Provider coverage stays missing
        beyond its supplied weeks. Fixture changes remain part of the error;
        they are not discarded after outcomes.
      </p>
      {report?.generated_at && (
        <small className="muted">
          Scored {new Date(report.generated_at).toLocaleString()}.{" "}
          {scope === "primary"
            ? "Primary eligibility requires the declared capture policy and checked official outcomes."
            : "Exploratory results can include stale inputs, legacy receipts or changed deadlines."}
        </small>
      )}
    </section>
  );
}

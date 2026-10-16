import { useMemo } from "react";
import { alignPlanGameweeks } from "./planComparison";
import { fmt, money } from "./lib";
import type { Plan } from "./types";
import { useViewState } from "./useViewState";
import { TabStrip } from "./TabStrip";

export function PlanComparisonView({
  plans,
  activeId,
  onPlan,
}: {
  plans: Plan[];
  activeId?: string;
  onPlan: (id: string) => void;
}) {
  const [excluded, setExcluded] = useViewState<string[]>("plans.excluded", []);
  const [view, setView] = useViewState("plans.comparison", "table");
  const selected = plans.filter((plan) => !excluded.includes(plan.id));
  const matched = useMemo(
    () => alignPlanGameweeks(selected),
    [plans, excluded],
  );
  const colors = [
    "#ff8e66",
    "#69cbb3",
    "#7ea8ff",
    "#ce9bff",
    "#e3c576",
    "#ed829b",
  ];
  const points = matched.plans.map((row, index) => ({
    ...row,
    color: colors[index % colors.length],
    bank: Math.min(...row.weeks.map((week) => week.bank)),
    transfers: row.weeks.reduce(
      (sum, week) => sum + week.transfers_in.length,
      0,
    ),
  }));
  const minimum = Math.min(...points.map((row) => row.points), 0),
    maximum = Math.max(...points.map((row) => row.points), 1);
  const bankMax = Math.max(...points.map((row) => row.bank), 1);
  return (
    <section className="plan-comparison-view">
      <header>
        <TabStrip
          label="Plan comparison view"
          value={view}
          onChange={setView}
          items={[
            { id: "table", label: "Table" },
            { id: "scatter", label: "Scatter" },
          ]}
        />
        <button
          className="button small"
          onClick={() =>
            setExcluded(
              selected.length === plans.length
                ? plans.map((plan) => plan.id)
                : [],
            )
          }
        >
          {selected.length === plans.length ? "Deselect all" : "Select all"}
        </button>
      </header>
      <p className="comparison-period">
        {matched.gameweeks.length
          ? `${matched.gameweeks.length} shared GWs · GW${matched.gameweeks[0]}–${matched.gameweeks.at(-1)} · net of hits`
          : "Select plans with shared gameweeks to compare."}
      </p>
      {view === "table" ? (
        <div className="table-container">
          <table className="data-table plan-comparison-table">
            <thead>
              <tr>
                <th></th>
                <th>Plan</th>
                <th>GWs</th>
                <th>Matched xPts</th>
                <th>Moves</th>
                <th>Hits</th>
                <th>Min bank</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => {
                const row = points.find((item) => item.plan.id === plan.id);
                return (
                  <tr
                    key={plan.id}
                    className={plan.id === activeId ? "active-plan-row" : ""}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Compare ${plan.name}`}
                        checked={!excluded.includes(plan.id)}
                        onChange={() =>
                          setExcluded((ids) =>
                            ids.includes(plan.id)
                              ? ids.filter((id) => id !== plan.id)
                              : [...ids, plan.id],
                          )
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="comparison-plan-name"
                        aria-current={plan.id === activeId ? "true" : undefined}
                        onClick={() => onPlan(plan.id)}
                      >
                        <i style={{ background: row?.color ?? "#4a5b70" }} />
                        {plan.name}
                      </button>
                    </td>
                    <td>
                      {plan.weeks[0]?.gw}–{plan.weeks.at(-1)?.gw}
                    </td>
                    <td className="numeric">
                      {row && matched.gameweeks.length ? fmt(row.points) : "—"}
                    </td>
                    <td>
                      {row && matched.gameweeks.length ? row.transfers : "—"}
                    </td>
                    <td>{row && matched.gameweeks.length ? row.hits : "—"}</td>
                    <td>
                      {row && matched.gameweeks.length ? money(row.bank) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : matched.gameweeks.length ? (
        <>
          <svg
            className="comparison-scatter"
            viewBox="0 0 580 300"
            role="img"
            aria-label="Matched expected points versus minimum bank"
          >
            <text x="12" y="18" fill="#8fa6c5" fontSize="11">
              Matched net xPts
            </text>
            {[0, 0.25, 0.5, 0.75, 1].map((n) => (
              <g key={n}>
                <path d={`M55 ${250 - n * 210} H555`} stroke="#24354d" />
                <text
                  x="47"
                  y={254 - n * 210}
                  textAnchor="end"
                  fill="#8fa6c5"
                  fontSize="10"
                >
                  {fmt(minimum + n * (maximum - minimum), 0)}
                </text>
              </g>
            ))}
            <text
              x="310"
              y="288"
              textAnchor="middle"
              fill="#8fa6c5"
              fontSize="11"
            >
              Minimum bank (£m)
            </text>
            {[0, 0.25, 0.5, 0.75, 1].map((n) => (
              <text
                key={n}
                x={55 + n * 490}
                y="269"
                textAnchor="middle"
                fill="#8fa6c5"
                fontSize="10"
              >
                {fmt(n * bankMax)}
              </text>
            ))}
            {points.map((row) => (
              <g
                key={row.plan.id}
                tabIndex={0}
                role="button"
                aria-label={`Select ${row.plan.name}`}
                onClick={() => onPlan(row.plan.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onPlan(row.plan.id);
                  }
                }}
              >
                <title>
                  {row.plan.name}: {fmt(row.points)} net xPts ·{" "}
                  {money(row.bank)} minimum bank · {row.transfers} moves
                </title>
                <circle
                  cx={55 + (row.bank / bankMax) * 490}
                  cy={
                    250 - ((row.points - minimum) / (maximum - minimum)) * 210
                  }
                  r={row.plan.id === activeId ? 8 : 6}
                  fill={row.color}
                  stroke={row.plan.id === activeId ? "#fff" : "transparent"}
                  strokeWidth="2"
                />
              </g>
            ))}
          </svg>
          <div className="comparison-scatter-key">
            {points.map((row) => (
              <button key={row.plan.id} onClick={() => onPlan(row.plan.id)}>
                <i style={{ background: row.color }} />
                {row.plan.name}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

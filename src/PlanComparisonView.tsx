import { useMemo } from "react";
import { alignPlanGameweeks } from "./planComparison";
import { fmt, money } from "./lib";
import type { Plan } from "./types";
import { useViewState } from "./useViewState";
import { TabStrip } from "./TabStrip";

const colors = [
  "#ff8e66",
  "#69cbb3",
  "#7ea8ff",
  "#ce9bff",
  "#e3c576",
  "#ed829b",
];

export function formatPlanGWs(weeks: readonly { gw: number }[]) {
  if (!weeks.length) return "—";
  const gws = weeks.map((week) => week.gw);
  const first = Math.min(...gws);
  const last = Math.max(...gws);
  return first === last ? `GW${first}` : `GW${first}–${last}`;
}

export function comparisonYBounds(values: readonly number[]) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { min: 0, max: 4 };
  const rawMin = Math.min(...finite);
  const rawMax = Math.max(...finite);
  const rawSpan = rawMax - rawMin;
  const pad = Math.max(2, rawSpan * 0.16);
  const targetLow = rawMin >= 0 ? Math.max(0, rawMin - pad) : rawMin - pad;
  const targetHigh = rawMax + pad;
  let step = Math.max(1, Math.ceil((targetHigh - targetLow) / 4));
  let min = Math.floor((rawMin + rawMax) / 2 - step * 2);
  if (rawMin >= 0 && min < 0) min = 0;
  if (min > Math.floor(targetLow)) min = Math.floor(targetLow);
  while (min + step * 4 < Math.ceil(targetHigh)) {
    step += 1;
  }
  return { min, max: min + step * 4 };
}

export function comparisonBankMax(banks: readonly number[]) {
  const finite = banks.filter(Number.isFinite);
  const rawMax = finite.length ? Math.max(...finite, 0) : 0;
  return Math.max(2, Math.ceil(rawMax / 2) * 2);
}

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
  const planColor = (id: string) => {
    const index = plans.findIndex((plan) => plan.id === id);
    return colors[(index >= 0 ? index : 0) % colors.length];
  };
  const points = matched.plans.map((row) => ({
    ...row,
    color: planColor(row.plan.id),
    bank: Math.min(...row.weeks.map((week) => week.bank)),
    transfers: row.weeks.reduce(
      (sum, week) => sum + week.transfers_in.length,
      0,
    ),
  }));
  const orderedPoints = [
    ...points.filter((row) => row.plan.id !== activeId),
    ...points.filter((row) => row.plan.id === activeId),
  ];
  const { min: minimum, max: maximum } = comparisonYBounds(
    points.map((row) => row.points),
  );
  const bankMax = comparisonBankMax(points.map((row) => row.bank));
  const xLeft = 48;
  const xRight = 436;
  const xPad = 14;
  const xDomainStart = xLeft + xPad;
  const xDomainWidth = xRight - xPad - xDomainStart;
  const plotWidth = xRight - xLeft;
  const yTop = 30;
  const yBottom = 194;
  const plotHeight = yBottom - yTop;

  if (!plans.length) {
    return (
      <section className="plan-comparison-view">
        <p className="comparison-period">
          Create or import a plan to compare branches.
        </p>
      </section>
    );
  }

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
        {plans.length > 1 && (
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
        )}
      </header>
      <p className="comparison-period">
        {matched.gameweeks.length
          ? `${matched.gameweeks.length} shared GW${matched.gameweeks.length === 1 ? "" : "s"} · ${formatPlanGWs(matched.gameweeks.map((gw) => ({ gw })))} · net of hits`
          : "Select plans with shared gameweeks to compare."}
      </p>
      {view === "table" ? (
        <div className="table-container">
          <table className="data-table plan-comparison-table">
            <thead>
              <tr>
                <th>
                  <span className="sr-only">Compare</span>
                </th>
                <th>Plan</th>
                <th>GWs</th>
                <th className="numeric">Matched xPts</th>
                <th className="numeric">Moves</th>
                <th className="numeric">Hits</th>
                <th className="numeric">Min bank</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => {
                const row = points.find((item) => item.plan.id === plan.id);
                const included = !excluded.includes(plan.id);
                return (
                  <tr
                    key={plan.id}
                    className={plan.id === activeId ? "active-plan-row" : ""}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Compare ${plan.name}`}
                        checked={included}
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
                        <i
                          style={{
                            background: planColor(plan.id),
                            opacity: included ? 1 : 0.4,
                          }}
                        />
                        {plan.name}
                      </button>
                    </td>
                    <td>{formatPlanGWs(plan.weeks)}</td>
                    <td className="numeric">
                      {row && matched.gameweeks.length ? fmt(row.points) : "—"}
                    </td>
                    <td className="numeric">
                      {row && matched.gameweeks.length ? row.transfers : "—"}
                    </td>
                    <td className="numeric">
                      {row && matched.gameweeks.length ? row.hits : "—"}
                    </td>
                    <td className="numeric">
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
            viewBox="0 0 460 240"
            role="img"
            aria-label="Matched expected points versus minimum bank"
          >
            <text x="12" y="17" fill="#95abc9" fontSize="12">
              Matched net xPts
            </text>
            {[0, 0.25, 0.5, 0.75, 1].map((n) => {
              const y = yBottom - n * plotHeight;
              return (
                <g key={n}>
                  <path d={`M${xLeft} ${y} H${xRight}`} stroke="#24354d" />
                  <text
                    x={xLeft - 7}
                    y={y + 4}
                    textAnchor="end"
                    fill="#95abc9"
                    fontSize="12"
                  >
                    {fmt(minimum + n * (maximum - minimum), 0)}
                  </text>
                </g>
              );
            })}
            <text
              x={xLeft + plotWidth / 2}
              y="233"
              textAnchor="middle"
              fill="#95abc9"
              fontSize="12"
            >
              Minimum bank (£m)
            </text>
            {[0, 0.25, 0.5, 0.75, 1].map((n) => (
              <text
                key={n}
                x={xDomainStart + n * xDomainWidth}
                y="214"
                textAnchor="middle"
                fill="#95abc9"
                fontSize="12"
              >
                {fmt(n * bankMax, 1)}
              </text>
            ))}
            {orderedPoints.map((row) => {
              const cx =
                xDomainStart +
                (Math.min(bankMax, Math.max(0, row.bank)) / bankMax) *
                  xDomainWidth;
              const cy =
                yBottom -
                ((row.points - minimum) / Math.max(1e-6, maximum - minimum)) *
                  plotHeight;
              const isActive = row.plan.id === activeId;
              return (
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
                  <title>{`${row.plan.name}: ${fmt(row.points)} net xPts · ${money(row.bank)} minimum bank · ${row.transfers} moves`}</title>
                  <circle cx={cx} cy={cy} r={14} fill="transparent" />
                  <circle
                    className="comparison-point-ring"
                    cx={cx}
                    cy={cy}
                    r={isActive ? 11 : 9.5}
                    fill="none"
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isActive ? 7.5 : 6}
                    fill={row.color}
                    stroke={isActive ? "#fff" : "#0b1628"}
                    strokeWidth={isActive ? 2 : 1.5}
                  />
                </g>
              );
            })}
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

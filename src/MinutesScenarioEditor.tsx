import { useState } from "react";
import { X } from "lucide-react";
import { fmt } from "./lib";
import type { MinutesScenario, Player } from "./types";

export function MinutesScenarioEditor({
  player,
  weeks,
  gw,
  onGWChange,
  globalMinutes,
  schedule,
  onSchedule,
  onReset,
  onNotify,
}: {
  player: Player;
  weeks: number[];
  gw: number;
  onGWChange: (gw: number) => void;
  globalMinutes?: number;
  schedule: Record<string, MinutesScenario>;
  onSchedule: (schedule: Record<string, MinutesScenario>) => void;
  onReset: () => void;
  onNotify: (text: string) => void;
}) {
  const selectedGW = gw;
  const [scope, setScope] = useState("selected");
  const [minutes, setMinutes] = useState(
    schedule[String(gw)]?.conditional_minutes ?? globalMinutes ?? 90,
  );
  const [ownAvailability, setOwnAvailability] = useState(
    schedule[String(gw)]?.availability !== undefined,
  );
  const [availability, setAvailability] = useState(
    Math.round(
      (schedule[String(gw)]?.availability ??
        (player.chance !== null
          ? player.chance / 100
          : ["u", "i", "s", "n"].includes(player.status)
            ? 0
            : 1)) * 100,
    ),
  );
  const forecast = player.gw[String(selectedGW)];
  function selectGW(value: number) {
    const row = schedule[String(value)];
    setMinutes(row?.conditional_minutes ?? globalMinutes ?? 90);
    setOwnAvailability(row?.availability !== undefined);
    if (row?.availability !== undefined)
      setAvailability(Math.round(row.availability * 100));
    onGWChange(value);
  }
  function apply() {
    const chosen =
      scope === "all"
        ? weeks
        : scope === "from"
          ? weeks.filter((w) => w >= selectedGW)
          : [selectedGW];
    const updated = { ...schedule };
    chosen.forEach((w) => {
      updated[String(w)] = {
        conditional_minutes: minutes,
        ...(ownAvailability ? { availability: availability / 100 } : {}),
      };
    });
    onSchedule(updated);
    onNotify(
      `${player.name} · GW${chosen[0]}${chosen.length > 1 ? `–${chosen.at(-1)}` : ""}: Saved for all plans. Updating forecasts…`,
    );
  }
  return (
    <div className="minutes-schedule-editor">
      <h3>Edit minutes</h3>
      <p className="help-text">
        Minutes and availability shared across all plans.
      </p>
      <div className="field-grid">
        <b className="editor-week">GW{selectedGW}</b>
        <label>
          Apply to
          <select
            aria-label="Minutes scenario scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="selected">This GW</option>
            <option value="from">From GW{selectedGW}</option>
            <option value="all">All remaining GWs</option>
          </select>
        </label>
      </div>
      <label className="range-label">
        <span>Conditional minutes per fixture</span>
        <b>{minutes} min</b>
        <input
          aria-label="Conditional player minutes"
          type="range"
          min={0}
          max={90}
          step={1}
          value={minutes}
          onChange={(e) => setMinutes(+e.target.value)}
        />
      </label>
      <label className="availability-toggle">
        <input
          type="checkbox"
          checked={ownAvailability}
          onChange={(e) => setOwnAvailability(e.target.checked)}
        />
        Use my availability assumption
      </label>
      {ownAvailability && (
        <label className="range-label">
          <span>Chance available for selection</span>
          <b>{availability}%</b>
          <input
            aria-label="Assumed player availability"
            type="range"
            min={0}
            max={100}
            step={5}
            value={availability}
            onChange={(e) => setAvailability(+e.target.value)}
          />
        </label>
      )}
      <details className="compact-details minutes-notes">
        <summary>Minutes notes</summary>
        <p className="help-text">
          Duration is conditional on appearance and applies per fixture in a
          double. Official availability remains unless you replace it. Injury
          recovery is your assumption. These edits take priority over point
          blends.
        </p>
      </details>
      <div className="button-row editor-actions">
        <button className="button primary small" onClick={apply}>
          Save minutes
        </button>
        <button className="button small" onClick={onReset}>
          Use model
        </button>
      </div>
      <p className="minutes-gw-summary">
        GW{selectedGW}: <b>{fmt(forecast?.points ?? 0)} xP</b> ·{" "}
        {fmt(forecast?.xmins ?? 0, 0)} expected minutes
        {forecast?.minutes_scenario ? " · human assumption active" : ""}
      </p>
      {globalMinutes !== undefined && (
        <p className="help-text">
          Legacy global duration: {globalMinutes} min. Scheduled weeks take
          priority.
        </p>
      )}
      {Object.keys(schedule).length > 0 && (
        <details className="minutes-assumption-list">
          <summary>
            {Object.keys(schedule).length} scheduled gameweek assumptions
          </summary>
          {Object.entries(schedule)
            .sort((a, b) => +a[0] - +b[0])
            .map(([week, row]) => (
              <div key={week}>
                <button onClick={() => selectGW(+week)}>
                  GW{week} ·{" "}
                  {row.conditional_minutes === undefined
                    ? "Model duration"
                    : `${row.conditional_minutes} min`}
                  {row.availability === undefined
                    ? ""
                    : ` · ${Math.round(row.availability * 100)}% available`}
                </button>
                <button
                  aria-label={`Clear minutes assumption for GW${week}`}
                  onClick={() => {
                    const next = { ...schedule };
                    delete next[week];
                    onSchedule(next);
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
        </details>
      )}
    </div>
  );
}

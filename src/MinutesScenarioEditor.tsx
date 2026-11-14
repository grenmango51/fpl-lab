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
  const defaultAvailability = (targetPlayer: Player) =>
    Math.round(
      (targetPlayer.chance != null
        ? targetPlayer.chance / 100
        : ["u", "i", "s", "n"].includes(targetPlayer.status)
          ? 0
          : 1) * 100,
    );
  const defaultMinutes = (
    row: MinutesScenario | undefined,
    fallbackGlobal: number | undefined,
  ) => row?.conditional_minutes ?? fallbackGlobal ?? 90;
  const currentRow = schedule[String(selectedGW)];
  const signature = `${player.id}:${selectedGW}:${globalMinutes ?? ""}:${player.chance ?? ""}:${player.status}:${JSON.stringify(currentRow ?? null)}`;
  const [prevSignature, setPrevSignature] = useState(signature);
  const [minutes, setMinutes] = useState(
    defaultMinutes(currentRow, globalMinutes),
  );
  const [ownAvailability, setOwnAvailability] = useState(
    currentRow?.availability !== undefined,
  );
  const [availability, setAvailability] = useState(
    currentRow?.availability !== undefined
      ? Math.round(currentRow.availability * 100)
      : defaultAvailability(player),
  );
  let activeMinutes = minutes;
  let activeOwnAvailability = ownAvailability;
  let activeAvailability = availability;
  if (prevSignature !== signature) {
    activeMinutes = defaultMinutes(currentRow, globalMinutes);
    activeOwnAvailability = currentRow?.availability !== undefined;
    activeAvailability =
      currentRow?.availability !== undefined
        ? Math.round(currentRow.availability * 100)
        : defaultAvailability(player);
    setPrevSignature(signature);
    setMinutes(activeMinutes);
    setOwnAvailability(activeOwnAvailability);
    setAvailability(activeAvailability);
  }
  const forecast = player.gw[String(selectedGW)];
  function syncLocalToRow(
    row: MinutesScenario | undefined,
    fallbackGlobal = globalMinutes,
    week = selectedGW,
  ) {
    setPrevSignature(
      `${player.id}:${week}:${fallbackGlobal ?? ""}:${player.chance ?? ""}:${player.status}:${JSON.stringify(row ?? null)}`,
    );
    setMinutes(defaultMinutes(row, fallbackGlobal));
    setOwnAvailability(row?.availability !== undefined);
    setAvailability(
      row?.availability !== undefined
        ? Math.round(row.availability * 100)
        : defaultAvailability(player),
    );
  }
  function selectGW(value: number) {
    syncLocalToRow(schedule[String(value)], globalMinutes, value);
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
        conditional_minutes: activeMinutes,
        ...(activeOwnAvailability
          ? { availability: activeAvailability / 100 }
          : {}),
      };
    });
    onSchedule(updated);
    onNotify(
      `${player.name} · GW${chosen[0]}${chosen.length > 1 ? `–${chosen.at(-1)}` : ""}: Saved for all plans.`,
    );
  }
  return (
    <div className="minutes-schedule-editor">
      <h3>Edit minutes</h3>
      <p className="help-text">
        Minutes and availability shared across all plans.
      </p>
      <div className="editor-scope-bar">
        <b className="editor-week">GW{selectedGW}</b>
        <label className="editor-scope-select">
          <span>Apply to</span>
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
        <b>{activeMinutes} min</b>
        <input
          aria-label="Conditional player minutes"
          type="range"
          min={0}
          max={90}
          step={1}
          value={activeMinutes}
          onChange={(e) => setMinutes(+e.target.value)}
        />
      </label>
      <label className="availability-toggle">
        <input
          type="checkbox"
          checked={activeOwnAvailability}
          onChange={(e) => setOwnAvailability(e.target.checked)}
        />
        Use my availability assumption
      </label>
      {activeOwnAvailability && (
        <label className="range-label">
          <span>Chance available for selection</span>
          <b>{activeAvailability}%</b>
          <input
            aria-label="Assumed player availability"
            type="range"
            min={0}
            max={100}
            step={5}
            value={activeAvailability}
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
        <button
          className="button small"
          disabled={!Object.keys(schedule).length && globalMinutes === undefined}
          onClick={() => {
            syncLocalToRow(undefined, undefined);
            onReset();
          }}
        >
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
            {Object.keys(schedule).length} edited GW
            {Object.keys(schedule).length === 1 ? "" : "s"}
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
                  className="icon-button"
                  aria-label={`Clear minutes assumption for GW${week}`}
                  onClick={() => {
                    const next = { ...schedule };
                    delete next[week];
                    onSchedule(next);
                    if (+week === selectedGW) syncLocalToRow(undefined);
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

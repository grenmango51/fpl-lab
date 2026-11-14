import { useState } from "react";
import { RotateCcw, X } from "lucide-react";
import type { Player, StatScenario } from "./types";
import { fmt } from "./lib";

export function StatScenarioEditor({
  player,
  weeks,
  gw,
  onGWChange,
  schedule,
  onSchedule,
  onNotify,
}: {
  player: Player;
  weeks: number[];
  gw: number;
  onGWChange: (gw: number) => void;
  schedule: Record<string, StatScenario>;
  onSchedule: (schedule: Record<string, StatScenario>) => void;
  onNotify: (message: string) => void;
}) {
  const selectedGW = gw;
  const [scope, setScope] = useState("selected");
  const formatStatValue = (key: string, value: number) =>
    String(
      key === "clean_sheet_probability"
        ? Math.round(value * 100)
        : Number(value.toFixed(2)),
    );
  const stringDraft = (row: StatScenario = {}) =>
    Object.fromEntries(
      Object.entries(row)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, formatStatValue(key, value)]),
    ) as Partial<Record<keyof StatScenario, string>>;
  const currentRow = schedule[String(selectedGW)];
  const signature = `${player.id}:${selectedGW}:${JSON.stringify(currentRow ?? null)}`;
  const [prevSignature, setPrevSignature] = useState(signature);
  const [draft, setDraft] = useState<
    Partial<Record<keyof StatScenario, string>>
  >(stringDraft(currentRow));
  let currentDraft = draft;
  if (prevSignature !== signature) {
    currentDraft = stringDraft(currentRow);
    setPrevSignature(signature);
    setDraft(currentDraft);
  }
  const hasGWEdit =
    Boolean(currentRow && Object.keys(currentRow).length) ||
    Object.keys(currentDraft).length > 0;
  const forecast = player.gw[String(selectedGW)];
  const defaults: StatScenario = {
    expected_points: forecast?.points ?? 0,
    xg: forecast?.fixtures.reduce((sum, item) => sum + item.xg, 0) ?? 0,
    xa: forecast?.fixtures.reduce((sum, item) => sum + item.xa, 0) ?? 0,
    clean_sheet_probability: forecast?.fixtures.length
      ? forecast.fixtures.reduce((sum, item) => sum + item.cs, 0) /
        forecast.fixtures.length
      : 0,
  };
  const fields: {
    key: keyof StatScenario;
    label: string;
    min: number;
    max: number;
    step: number;
  }[] = [
    {
      key: "expected_points",
      label: "Expected points",
      min: -5,
      max: 60,
      step: 0.1,
    },
    { key: "xg", label: "Expected goals", min: 0, max: 10, step: 0.05 },
    { key: "xa", label: "Expected assists", min: 0, max: 10, step: 0.05 },
    {
      key: "clean_sheet_probability",
      label: "Clean sheet chance",
      min: 0,
      max: 100,
      step: 1,
    },
  ];
  function selectWeek(value: number) {
    const nextRow = schedule[String(value)];
    setPrevSignature(`${player.id}:${value}:${JSON.stringify(nextRow ?? null)}`);
    setDraft(stringDraft(nextRow));
    onGWChange(value);
  }
  function save() {
    if (!Object.keys(currentDraft).length) {
      onNotify("Enable a stat to edit.");
      return;
    }
    const values: StatScenario = {};
    for (const field of fields) {
      const raw = currentDraft[field.key];
      if (raw === undefined) continue;
      const value = Number(raw);
      if (
        raw.trim() === "" ||
        !Number.isFinite(value) ||
        value < field.min ||
        value > field.max
      ) {
        onNotify(`${field.label}: enter ${field.min}–${field.max}.`);
        return;
      }
      values[field.key] =
        value / (field.key === "clean_sheet_probability" ? 100 : 1);
    }
    const chosen =
      scope === "all"
        ? weeks
        : scope === "from"
          ? weeks.filter((week) => week >= selectedGW)
          : [selectedGW];
    const next = { ...schedule };
    chosen.forEach((week) => {
      next[String(week)] = { ...values };
    });
    onSchedule(next);
    onNotify(
      `${player.name} · GW${chosen[0]}${chosen.length > 1 ? `–${chosen.at(-1)}` : ""}: Saved for all plans.`,
    );
  }
  return (
    <section className="stat-scenario-editor">
      <header>
        <h3>Edit player stats</h3>
        <span className="subtle-tag">All plans</span>
      </header>
      <p className="help-text">GW totals shared across all plans.</p>
      <div className="editor-scope-bar">
        <b className="editor-week">GW{selectedGW}</b>
        <label className="editor-scope-select">
          <span>Apply to</span>
          <select
            aria-label="Stat scenario scope"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
          >
            <option value="selected">This GW</option>
            <option value="from">From GW{selectedGW}</option>
            <option value="all">All remaining GWs</option>
          </select>
        </label>
      </div>
      <div className="stat-edit-fields">
        {fields.map((field) => {
          const enabled = currentDraft[field.key] !== undefined;
          const percentage = field.key === "clean_sheet_probability";
          return (
            <label key={field.key}>
              <span>
                <input
                  aria-label={`Override ${field.label}`}
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) =>
                    setDraft((current) => {
                      const next = { ...current };
                      if (event.target.checked)
                        next[field.key] = formatStatValue(
                          field.key,
                          defaults[field.key] ?? 0,
                        );
                      else delete next[field.key];
                      return next;
                    })
                  }
                />
                {field.label}
              </span>
              <input
                aria-label={`Assumed ${field.label}`}
                disabled={!enabled}
                type="number"
                min={field.min}
                max={field.max}
                step={field.step}
                value={
                  enabled
                    ? currentDraft[field.key]
                    : fmt(
                        (defaults[field.key] ?? 0) * (percentage ? 100 : 1),
                        percentage ? 0 : 2,
                      )
                }
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
              />
              {percentage ? <small>%</small> : null}
            </label>
          );
        })}
      </div>
      <details className="compact-details stat-notes">
        <summary>Stat notes</summary>
        <p className="help-text">
          xG/xA are unconditional GW totals. In doubles, CS chance applies to
          each fixture. Set minutes/availability first for unavailable players.
        </p>
      </details>
      <div className="button-row editor-actions">
        <button className="button primary small" onClick={save}>
          Save stats
        </button>
        <button
          className="button small"
          disabled={!hasGWEdit}
          onClick={() => {
            const next = { ...schedule };
            delete next[String(selectedGW)];
            onSchedule(next);
            setPrevSignature(`${player.id}:${selectedGW}:null`);
            setDraft({});
            onNotify(`${player.name} · GW${selectedGW}: Override cleared.`);
          }}
        >
          <RotateCcw size={12} />
          Reset GW
        </button>
        <button
          className="button small"
          disabled={!Object.keys(schedule).length}
          onClick={() => {
            onSchedule({});
            setPrevSignature(`${player.id}:${selectedGW}:null`);
            setDraft({});
            onNotify(`${player.name}: All stat edits cleared.`);
          }}
        >
          Reset all GWs
        </button>
      </div>
      {Object.keys(schedule).length ? (
        <details className="minutes-assumption-list">
          <summary>
            {Object.keys(schedule).length} edited GW
            {Object.keys(schedule).length === 1 ? "" : "s"}
          </summary>
          {Object.entries(schedule)
            .sort((a, b) => +a[0] - +b[0])
            .map(([week, row]) => (
              <div key={week}>
                <button onClick={() => selectWeek(+week)}>
                  GW{week} ·{" "}
                  {Object.entries(row)
                    .map(
                      ([key, value]) =>
                        `${key === "clean_sheet_probability" ? "CS" : key === "expected_points" ? "xPts" : key} ${fmt(value * (key === "clean_sheet_probability" ? 100 : 1), key === "clean_sheet_probability" ? 0 : 2)}${key === "clean_sheet_probability" ? "%" : ""}`,
                    )
                    .join(" · ")}
                </button>
                <button
                  className="icon-button"
                  aria-label={`Clear stat edit GW${week}`}
                  onClick={() => {
                    const next = { ...schedule };
                    delete next[week];
                    onSchedule(next);
                    if (+week === selectedGW) {
                      setPrevSignature(`${player.id}:${selectedGW}:null`);
                      setDraft({});
                    }
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
        </details>
      ) : null}
    </section>
  );
}

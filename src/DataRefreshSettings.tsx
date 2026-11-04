import { useEffect, useState } from "react";
import { api } from "./lib";

export type DataRefreshStatus = {
  enabled: boolean;
  interval_minutes: number;
  last_success_at?: string;
  last_error?: string | null;
  loaded_at?: string;
  next_gw?: number;
  next_refresh_at?: string | null;
  solio_capture?: string | null;
};

export default function DataRefreshSettings() {
  const [status, setStatus] = useState<DataRefreshStatus | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    const read = () =>
      api<DataRefreshStatus>("/data-refresh")
        .then((value) => {
          if (alive) {
            setStatus(value);
            setError("");
          }
        })
        .catch((e: Error) => {
          if (alive) setError(e.message);
        });
    void read();
    const timer = window.setInterval(read, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  async function save(values: Partial<DataRefreshStatus>) {
    if (!status) return;
    setSaving(true);
    try {
      setStatus(
        await api<DataRefreshStatus>("/data-refresh", {
          enabled: values.enabled ?? status.enabled,
          interval_minutes: values.interval_minutes ?? status.interval_minutes,
        }),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="auto-refresh-settings">
      <label className="toggle-row">
        <span>
          <b>Automatic data refresh</b>
          <small>Refresh feeds and archive available Solio values</small>
        </span>
        <input
          type="checkbox"
          aria-label="Automatic data refresh"
          checked={status?.enabled ?? false}
          disabled={!status || saving}
          onChange={(e) => void save({ enabled: e.target.checked })}
        />
      </label>
      <label className="field-row">
        Check every
        <select
          aria-label="Data refresh interval"
          value={status?.interval_minutes ?? 30}
          disabled={!status || saving}
          onChange={(e) =>
            void save({ interval_minutes: Number(e.target.value) })
          }
        >
          {[
            5,
            15,
            30,
            60,
            120,
            ...(status &&
            ![5, 15, 30, 60, 120].includes(status.interval_minutes)
              ? [status.interval_minutes]
              : []),
          ]
            .sort((a, b) => a - b)
            .map((value) => (
              <option key={value} value={value}>
                {value} minutes
              </option>
            ))}
        </select>
      </label>
      <p className="help-text">
        {status?.last_success_at
          ? `Last check ${new Date(status.last_success_at).toLocaleString()}. `
          : "Waiting for the first automatic check. "}
        Solio's public report publishes about every 4 hours. Background
        collection needs the app or server timer running.
      </p>
      {error || status?.last_error ? (
        <p role="alert">
          Refresh unavailable: {error || status?.last_error}. Previous data
          retained.
        </p>
      ) : null}
    </div>
  );
}

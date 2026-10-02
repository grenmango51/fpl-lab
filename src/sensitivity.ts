import { api, ApiError } from "./lib";
import type { SensitivityJob } from "./types";

export const stressRunning = (job: SensitivityJob | null) =>
  job?.status === "queued" || job?.status === "running";

export function watchSensitivity(
  id: string,
  callbacks: {
    update: (job: SensitivityJob) => void;
    error: (message: string) => void;
    missing: (message: string) => void;
  },
) {
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout>;
  async function poll() {
    try {
      const job = await api<SensitivityJob>(`/sensitivity/${id}`);
      if (stopped) return;
      failures = 0;
      callbacks.error("");
      callbacks.update(job);
      if (stressRunning(job)) timer = setTimeout(() => void poll(), 1500);
    } catch (e) {
      if (stopped) return;
      if (e instanceof ApiError && e.status === 404) {
        callbacks.missing(e.message);
        return;
      }
      failures += 1;
      callbacks.error(
        "Connection interrupted. The test may still be running; its ID is saved and this page will keep trying to reconnect.",
      );
      timer = setTimeout(
        () => void poll(),
        Math.min(30000, 1500 * 2 ** Math.min(failures, 5)),
      );
    }
  }
  void poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

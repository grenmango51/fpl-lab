import { api, ApiError } from "./lib";
import type { Plan } from "./types";
import type { ForecastConfiguration } from "./planningPersistence";
import type { SolverSettings } from "./Views";

export type SharedDocument = {
  version: 1;
  plans: Plan[];
  configuration: ForecastConfiguration;
  solver_settings: SolverSettings;
  active_id: string;
  watch: number[];
};
export type SharedState = {
  enabled: boolean;
  revision: number;
  document: SharedDocument | null;
  saved_at: string | null;
};
export type SaveStatus =
  "local" | "loading" | "saved" | "saving" | "error" | "conflict";
type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const pendingKey = "open-fpl-unsynced-workspace-v1";

/** Conditional writes never silently overwrite a different device's plans. */
export class SharedWorkspace {
  enabled = false;
  private revision = 0;
  private baseline = "";
  private pending: SharedDocument | null = null;
  private saving = false;
  private blocked = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private report: (status: SaveStatus) => void,
    private storage: PendingStorage | undefined = typeof localStorage ===
    "undefined"
      ? undefined
      : localStorage,
  ) {}

  private retainPending() {
    try {
      if (this.pending)
        this.storage?.setItem(
          pendingKey,
          JSON.stringify({ revision: this.revision, document: this.pending }),
        );
      else this.storage?.removeItem(pendingKey);
    } catch {
      /* Existing browser plan storage and export remain available. */
    }
  }

  async initialize(local: SharedDocument) {
    const state = await api<SharedState>("/workspace");
    if (this.stopped) return local;
    this.enabled = state.enabled;
    this.revision = state.revision;
    const document = state.document ?? local;
    this.baseline = JSON.stringify(document);
    this.report(state.enabled ? "saved" : "local");
    if (state.enabled) {
      try {
        const pending = JSON.parse(
          this.storage?.getItem(pendingKey) ?? "null",
        ) as { revision: number; document: SharedDocument } | null;
        if (
          pending &&
          Number.isInteger(pending.revision) &&
          pending.revision >= 0 &&
          pending.document?.version === 1 &&
          Array.isArray(pending.document.plans)
        ) {
          this.revision = pending.revision;
          this.blocked = pending.revision !== state.revision;
          this.report(this.blocked ? "conflict" : "saving");
          return pending.document;
        }
      } catch {
        /* Malformed local recovery metadata cannot replace the server. */
      }
    }
    // An empty server is intentionally populated from this browser, including
    // an imported backup. A new device must not replace an existing workspace.
    if (state.enabled && !state.document) this.baseline = "";
    return document;
  }

  queue(document: SharedDocument) {
    if (!this.enabled || this.stopped) return;
    const serialized = JSON.stringify(document);
    if (serialized === this.baseline && !this.saving) {
      this.pending = null;
      this.retainPending();
      if (!this.blocked) this.report("saved");
      return;
    }
    if (this.pending && JSON.stringify(this.pending) === serialized) return;
    this.pending = structuredClone(document);
    this.retainPending();
    clearTimeout(this.timer);
    if (this.blocked) return;
    this.report("saving");
    this.timer = setTimeout(() => void this.flush(), 1500);
  }

  async flush() {
    clearTimeout(this.timer);
    if (!this.enabled || this.saving || this.blocked || this.stopped) return;
    this.saving = true;
    try {
      while (this.pending && !this.stopped) {
        const document = this.pending;
        this.pending = null;
        this.report("saving");
        try {
          const saved = await api<SharedState>("/workspace", {
            revision: this.revision,
            document,
          });
          this.revision = saved.revision;
          this.baseline = JSON.stringify(document);
          if (this.pending && JSON.stringify(this.pending) === this.baseline)
            this.pending = null;
          this.retainPending();
          this.report(this.pending ? "saving" : "saved");
        } catch (error) {
          this.pending ??= document;
          this.retainPending();
          this.blocked = error instanceof ApiError && error.status === 409;
          this.report(this.blocked ? "conflict" : "error");
          return;
        }
      }
    } finally {
      this.saving = false;
    }
  }

  async pull(
    apply: (
      document: SharedDocument,
      current: () => boolean,
    ) => Promise<boolean>,
    force = false,
  ) {
    if (!this.enabled || this.saving || this.stopped) return;
    if (!force && (this.pending || this.blocked)) {
      await this.flush();
      return;
    }
    const before = this.baseline;
    try {
      const state = await api<SharedState>("/workspace");
      if (!state.document || (!force && state.revision === this.revision))
        return;
      const current = () =>
        !this.stopped &&
        (force || (!this.pending && !this.saving && this.baseline === before));
      if (!current() || !(await apply(state.document, current))) return;
      this.revision = state.revision;
      this.baseline = JSON.stringify(state.document);
      this.pending = null;
      this.retainPending();
      this.blocked = false;
      this.report("saved");
    } catch {
      this.report("error");
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}

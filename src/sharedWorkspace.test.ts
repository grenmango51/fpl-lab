import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedWorkspace, type SharedDocument } from "./sharedWorkspace";
import {
  defaultForecastConfiguration,
  defaultSolverSettings,
} from "./planningPersistence";

const document = (id: string): SharedDocument => ({
  version: 1,
  plans: [],
  configuration: defaultForecastConfiguration,
  solver_settings: defaultSolverSettings,
  active_id: id,
  watch: [],
});
const response = (revision: number, doc: SharedDocument | null) =>
  new Response(JSON.stringify({ enabled: true, revision, document: doc }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shared personal workspace", () => {
  it("restores unsaved edits after a reload and preserves a newer remote revision", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(1, document("first")))
      .mockRejectedValueOnce(new TypeError("Offline"))
      .mockResolvedValueOnce(response(2, document("other device")));
    vi.stubGlobal("fetch", fetcher);
    const first = new SharedWorkspace(vi.fn(), storage);
    await first.initialize(document("local"));
    first.queue(document("unsaved phone edit"));
    await first.flush();
    first.stop();
    const report = vi.fn();
    const resumed = new SharedWorkspace(report, storage);
    expect((await resumed.initialize(document("local"))).active_id).toBe(
      "unsaved phone edit",
    );
    expect(report).toHaveBeenLastCalledWith("conflict");
    resumed.queue(document("unsaved phone edit"));
    await resumed.flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
    resumed.stop();
  });

  it("can save retained offline edits after reload when the remote revision is unchanged", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(1, document("first")))
      .mockRejectedValueOnce(new TypeError("Offline"))
      .mockResolvedValueOnce(response(1, document("first")))
      .mockResolvedValueOnce(response(2, document("edited")));
    vi.stubGlobal("fetch", fetcher);
    const first = new SharedWorkspace(vi.fn(), storage);
    await first.initialize(document("local"));
    first.queue(document("edited"));
    await first.flush();
    first.stop();
    const resumed = new SharedWorkspace(vi.fn(), storage);
    const recovered = await resumed.initialize(document("local"));
    resumed.queue(recovered);
    await resumed.flush();
    expect(JSON.parse(fetcher.mock.calls[3][1].body).revision).toBe(1);
    expect(values.size).toBe(0);
    resumed.stop();
  });

  it("loads the saved server copy instead of overwriting it from a new device", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(4, document("server")));
    vi.stubGlobal("fetch", fetcher);
    const sync = new SharedWorkspace(vi.fn());
    expect((await sync.initialize(document("local"))).active_id).toBe("server");
    sync.queue(document("server"));
    await sync.flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    sync.stop();
  });

  it("retains conflicting local edits and never retries them as an unconditional overwrite", async () => {
    const status = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(1, document("first")))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Another device saved." }), {
          status: 409,
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const sync = new SharedWorkspace(status);
    await sync.initialize(document("local"));
    sync.queue(document("edited"));
    await sync.flush();
    expect(status).toHaveBeenLastCalledWith("conflict");
    sync.queue(document("newer edit"));
    await sync.flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).revision).toBe(1);
    sync.stop();
  });

  it("saves edits made while a previous save is in flight against the new revision", async () => {
    let resolveSave!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(1, document("first")))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveSave = resolve;
          }),
      )
      .mockResolvedValueOnce(response(3, document("latest")));
    vi.stubGlobal("fetch", fetcher);
    const sync = new SharedWorkspace(vi.fn());
    await sync.initialize(document("local"));
    sync.queue(document("edited"));
    const firstSave = sync.flush();
    sync.queue(document("latest"));
    resolveSave(response(2, document("edited")));
    await firstSave;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({
      revision: 2,
      document: { active_id: "latest" },
    });
    sync.stop();
  });

  it("does not adopt a remote workspace if the user edits during its forecast request", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(1, document("first")))
      .mockResolvedValueOnce(response(2, document("remote")));
    vi.stubGlobal("fetch", fetcher);
    const sync = new SharedWorkspace(vi.fn());
    await sync.initialize(document("local"));
    let applied = false;
    await sync.pull(async (_remote, current) => {
      sync.queue(document("new local edit"));
      applied = current();
      return applied;
    });
    expect(applied).toBe(false);
    sync.stop();
  });
});

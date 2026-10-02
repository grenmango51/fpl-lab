import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./lib";
import { watchSensitivity } from "./sensitivity";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("stress job observation", () => {
  it("retains a job through a transient failure, reconnects and allows cancellation", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network unavailable"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "job1", status: "running" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "job1", status: "cancelled" })),
      );
    vi.stubGlobal("fetch", fetcher);
    const callbacks = { update: vi.fn(), error: vi.fn(), missing: vi.fn() };
    const stop = watchSensitivity("job1", callbacks);
    await vi.advanceTimersByTimeAsync(0);
    expect(callbacks.error).toHaveBeenCalledWith(
      expect.stringContaining("ID is saved"),
    );
    expect(callbacks.missing).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(callbacks.update).toHaveBeenCalledWith({
      id: "job1",
      status: "running",
    });
    expect(callbacks.error).toHaveBeenLastCalledWith("");
    const cancelled = await api<{ status: string }>(
      "/sensitivity/job1/cancel",
      {},
    );
    expect(cancelled.status).toBe("cancelled");
    expect(fetcher).toHaveBeenLastCalledWith(
      "/api/sensitivity/job1/cancel",
      expect.objectContaining({ method: "POST" }),
    );
    stop();
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("stops after a confirmed missing job instead of retrying forever", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ detail: "Server restarted" }), {
          status: 404,
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const callbacks = { update: vi.fn(), error: vi.fn(), missing: vi.fn() };
    const stop = watchSensitivity("old-job", callbacks);
    await vi.advanceTimersByTimeAsync(0);
    expect(callbacks.missing).toHaveBeenCalledWith("Server restarted");
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    stop();
  });
});

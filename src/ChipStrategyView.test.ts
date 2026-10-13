import { afterEach, describe, expect, it, vi } from "vitest";
import { watchChipStrategy } from "./ChipStrategyView";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("chip strategy job recovery", () => {
  it("keeps its saved job through a connection failure and stops polling a terminal result", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Network unavailable"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "job-1", status: "running" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "job-1", status: "budget-exhausted" }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const callbacks = { update: vi.fn(), error: vi.fn(), missing: vi.fn() };
    const stop = watchChipStrategy("job-1", callbacks);
    await vi.advanceTimersByTimeAsync(0);
    expect(callbacks.missing).not.toHaveBeenCalled();
    expect(callbacks.error).toHaveBeenCalledWith(
      expect.stringContaining("ID is saved"),
    );
    await vi.advanceTimersByTimeAsync(3000);
    expect(callbacks.update).toHaveBeenLastCalledWith({
      id: "job-1",
      status: "running",
    });
    expect(callbacks.error).toHaveBeenLastCalledWith("");
    await vi.advanceTimersByTimeAsync(1500);
    expect(callbacks.update).toHaveBeenLastCalledWith({
      id: "job-1",
      status: "budget-exhausted",
    });
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    stop();
  });

  it("clears a confirmed missing server job without retrying it forever", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ detail: "Search report expired after a restart." }),
          { status: 404 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const callbacks = { update: vi.fn(), error: vi.fn(), missing: vi.fn() };
    const stop = watchChipStrategy("expired", callbacks);
    await vi.advanceTimersByTimeAsync(0);
    expect(callbacks.missing).toHaveBeenCalledWith(
      "Search report expired after a restart.",
    );
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    stop();
  });

  it("ignores an in-flight response after its observer has been disposed", async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const callbacks = { update: vi.fn(), error: vi.fn(), missing: vi.fn() };
    const stop = watchChipStrategy("old", callbacks);
    stop();
    resolve(new Response(JSON.stringify({ id: "old", status: "running" })));
    await vi.advanceTimersByTimeAsync(0);
    expect(callbacks.update).not.toHaveBeenCalled();
    expect(callbacks.error).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

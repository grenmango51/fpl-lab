import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Database, type Env } from "./worker";

function environment(email = "owner@example.com"): Env {
  const row = { user_id: "google:123", email };
  const statement = {
    bind: () => statement,
    first: async () => row,
    run: async () => ({}),
  };
  return {
    DB: {
      prepare: (sql: string) =>
        sql.includes("origin_config")
          ? {
              ...statement,
              first: async () => ({
                url: "https://private-origin.example:8443",
              }),
            }
          : statement,
      batch: async () => [],
    } as unknown as Database,
    ASSETS: { fetch: async () => new Response("App assets") },
    OWNER_EMAILS: "owner@example.com",
    ORIGIN_TOKEN: "unit-test-origin-credential",
  };
}
const cookie = `__Host-open_fpl_session=${"a".repeat(43)}`;
afterEach(() => vi.unstubAllGlobals());

describe("private Cloudflare gateway", () => {
  it("clears the session and returns to the login page after sign-out", async () => {
    const response = await worker.fetch(
      new Request("https://fpl.example/auth/signout", {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://fpl.example" },
      }),
      environment(),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("does not allow a browser to replace the origin connection", async () => {
    const env = environment();
    const prepare = vi.spyOn(env.DB, "prepare");
    const response = await worker.fetch(
      new Request("https://fpl.example/internal/origin", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://test.trycloudflare.com" }),
      }),
      env,
    );
    expect(response.status).toBe(403);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("restricts authenticated origin registration to Cloudflare tunnel addresses", async () => {
    const env = environment();
    const prepare = vi.spyOn(env.DB, "prepare");
    const response = await worker.fetch(
      new Request("https://fpl.example/internal/origin", {
        method: "POST",
        headers: {
          Authorization: "Bearer unit-test-origin-credential",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: "https://attacker.example" }),
      }),
      env,
    );
    expect(response.status).toBe(422);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("requires a session and a configured owner for every API request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const [headers, env] of [
      [{}, environment()],
      [{ Cookie: cookie }, environment("someone-else@example.com")],
    ] as const) {
      const response = await worker.fetch(
        new Request("https://fpl.example/api/workspace", { headers }),
        env,
      );
      expect(response.status).toBe(401);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("streams the API response and supplies only the server's origin credential", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"revision":1}'));
    vi.stubGlobal("fetch", fetcher);
    const response = await worker.fetch(
      new Request("https://fpl.example/api/workspace?test=1", {
        headers: {
          Cookie: cookie,
          Authorization: "Bearer browser-value",
          "X-Open-FPL-Origin-Token": "forged",
        },
      }),
      environment(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 1 });
    const [target, options] = fetcher.mock.calls[0];
    expect(target.href).toBe(
      "https://private-origin.example:8443/api/workspace?test=1",
    );
    expect(options.headers.get("x-open-fpl-origin-token")).toBe(
      "unit-test-origin-credential",
    );
    expect(options.headers.has("cookie")).toBe(false);
    expect(options.headers.has("authorization")).toBe(false);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects cross-site mutations before calling the origin", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await worker.fetch(
      new Request("https://fpl.example/api/refresh", {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://other.example" },
        body: "{}",
      }),
      environment(),
    );
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not expose source URLs or exception details when the origin is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("private origin and credential")),
    );
    const response = await worker.fetch(
      new Request("https://fpl.example/api/bootstrap", {
        headers: { Cookie: cookie },
      }),
      environment(),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("credential");
  });
});

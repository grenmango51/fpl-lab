import { authApi, sessionUserId } from "./auth";

export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch<T = Record<string, unknown>>(
    statements: Statement[],
  ): Promise<{ results: T[] }[]>;
}
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DB: Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  OWNER_EMAILS?: string;
  ORIGIN_TOKEN?: string;
}

const login = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open FPL</title><style>body{margin:0;background:#030712;color:#f1f5f9;font:16px/1.5 system-ui}main{max-width:400px;margin:18% auto;padding:24px}h1{font-size:32px}p{color:#a6b0c1}a{display:inline-block;background:#ff6a3d;color:#030712;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700}</style></head><body><main><h1>Open FPL</h1><p>Your personal FPL planner.</p><a href="/auth/google">Continue with Google</a></main></body></html>`;

function secure(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  // Native same-origin sign-out forms need a non-null Origin for the CSRF
  // check. Keep referrers private when navigating to other sites.
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cache-Control", "private, no-store");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://resources.premierleague.com https://fantasy.premierleague.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function sameSecret(left: string, right: string): Promise<boolean> {
  if (!right) return false;
  const digest = async (value: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/internal/origin") {
      if (
        request.method !== "POST" ||
        !(await sameSecret(
          request.headers.get("Authorization") ?? "",
          `Bearer ${env.ORIGIN_TOKEN ?? ""}`,
        )) ||
        !env.ORIGIN_TOKEN
      ) {
        return secure(new Response("Forbidden.", { status: 403 }));
      }
      const value = (await request.json().catch(() => null)) as {
        url?: unknown;
      } | null;
      if (
        typeof value?.url !== "string" ||
        !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(value.url)
      ) {
        return secure(new Response("Invalid tunnel address.", { status: 422 }));
      }
      await env.DB.prepare(
        "INSERT INTO origin_config(id,url) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url",
      )
        .bind(value.url)
        .run();
      return secure(Response.json({ registered: true }));
    }
    if (url.pathname.startsWith("/auth/"))
      return secure(await authApi(request, url.pathname, env, Date.now()));
    const user = await sessionUserId(
      request,
      env.DB,
      Date.now(),
      env.OWNER_EMAILS ?? "",
    );
    if (!user) {
      if (url.pathname.startsWith("/api/"))
        return secure(
          Response.json(
            { detail: "Sign in to open your planner." },
            { status: 401 },
          ),
        );
      return secure(
        new Response(login, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      );
    }
    if (!env.OWNER_EMAILS || !env.ORIGIN_TOKEN) {
      return secure(
        new Response("The planner is being configured.", { status: 503 }),
      );
    }
    if (url.pathname === "/api/hosting")
      return secure(
        Response.json({
          user,
          provider: "Cloudflare",
          storage: "personal-server",
        }),
      );
    if (url.pathname.startsWith("/api/")) {
      if (!["GET", "HEAD", "POST"].includes(request.method))
        return secure(new Response("Method not allowed.", { status: 405 }));
      if (
        request.method === "POST" &&
        request.headers.get("Origin") !== url.origin
      ) {
        return secure(new Response("Forbidden.", { status: 403 }));
      }
      const registered = await env.DB.prepare(
        "SELECT url FROM origin_config WHERE id=1",
      ).first<{ url: string }>();
      if (!registered?.url)
        return secure(
          Response.json(
            { detail: "Your planning server is connecting. Retry shortly." },
            { status: 503 },
          ),
        );
      const origin = new URL(registered.url);
      if (origin.protocol !== "https:")
        return secure(
          new Response("Invalid origin configuration.", { status: 503 }),
        );
      origin.pathname = url.pathname;
      origin.search = url.search;
      const headers = new Headers();
      for (const name of ["Content-Type", "Accept", "Accept-Encoding"]) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      headers.set("X-Open-FPL-Origin-Token", env.ORIGIN_TOKEN);
      try {
        const response = await fetch(origin, {
          method: request.method,
          headers,
          redirect: "manual",
          body: request.method === "POST" ? request.body : undefined,
        });
        if (
          (response.status >= 300 && response.status < 400) ||
          response.status >= 500
        )
          throw new Error("Origin unavailable");
        // Stream full-horizon forecasts; do not copy their large JSON into the
        // Worker's memory. The origin token never goes back to the browser.
        return secure(response);
      } catch {
        return secure(
          Response.json(
            {
              detail:
                "Your planning server is temporarily unavailable. Saved plans are retained.",
            },
            { status: 503 },
          ),
        );
      }
    }
    return secure(await env.ASSETS.fetch(request));
  },
};

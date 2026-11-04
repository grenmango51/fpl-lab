import type { Database } from "./worker";

// Google sign-in (OpenID Connect authorization-code flow with PKCE). The browser
// holds only an opaque random session token; D1 stores its SHA-256.
const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = new Set([
  "https://accounts.google.com",
  "accounts.google.com",
]);
export const SESSION_COOKIE = "__Host-open_fpl_session";
const OAUTH_COOKIE = "__Host-open_fpl_oauth";
const SESSION_SECONDS = 30 * 86400;
const OAUTH_SECONDS = 600;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface AuthEnv {
  DB: Database;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  OWNER_EMAILS?: string | undefined;
}

const time = (ms: number) => new Date(ms).toISOString();
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const randomToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async (value: string) =>
  new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
export const sessionHash = async (token: string) => hex(await sha256(token));
const cookieHeader = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const split = part.indexOf("=");
    if (split > 0 && part.slice(0, split).trim() === name)
      return part.slice(split + 1).trim();
  }
  return null;
}

function respond(
  status: number,
  location: string | null,
  cookies: string[],
  text?: string,
): Response {
  const headers = new Headers({ "cache-control": "no-store" });
  if (location) headers.set("location", location);
  if (text) headers.set("content-type", "text/plain; charset=utf-8");
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(text ?? null, { status, headers });
}

const failed = (message: string) =>
  respond(
    400,
    null,
    [cookieHeader(OAUTH_COOKIE, "", 0)],
    `${message} Go back to the site and choose "Continue with Google" again.`,
  );

export async function sessionUserId(
  request: Request,
  db: Database,
  now: number,
  allowedEmails: string,
): Promise<string | null> {
  const token = cookie(request, SESSION_COOKIE);
  if (!token || !TOKEN.test(token)) return null;
  const row = await db
    .prepare(
      "SELECT user_id,email FROM auth_sessions WHERE token_hash=? AND expires_at>?",
    )
    .bind(await sessionHash(token), time(now))
    .first<{ user_id: string; email: string }>();
  const allowed = new Set(
    allowedEmails
      .toLowerCase()
      .split(",")
      .map((value) => value.trim()),
  );
  return row && allowed.has(row.email) ? row.user_id : null;
}

function idTokenClaims(idToken: unknown): Record<string, unknown> | null {
  if (typeof idToken !== "string") return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const padded =
      payload.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat(-payload.length & 3);
    const parsed = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)),
      ),
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export async function authApi(
  request: Request,
  path: string,
  env: AuthEnv,
  now: number,
): Promise<Response> {
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/auth/google/callback`;
  if (path === "/auth/signout") {
    if (request.method !== "POST")
      return respond(405, null, [], "Method not allowed.");
    if (request.headers.get("origin") !== url.origin)
      return respond(403, null, [], "Forbidden.");
    const token = cookie(request, SESSION_COOKIE);
    if (token && TOKEN.test(token))
      await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?")
        .bind(await sessionHash(token))
        .run();
    return respond(303, "/", [cookieHeader(SESSION_COOKIE, "", 0)]);
  }
  if (request.method !== "GET")
    return respond(405, null, [], "Method not allowed.");
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    return respond(503, null, [], "Sign-in is not configured yet.");
  if (path === "/auth/google") {
    const state = randomToken(),
      verifier = randomToken();
    const target = new URL(GOOGLE_AUTHORIZE);
    target.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email",
      state,
      code_challenge: base64url(await sha256(verifier)),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return respond(302, target.toString(), [
      cookieHeader(OAUTH_COOKIE, `${state}.${verifier}`, OAUTH_SECONDS),
    ]);
  }
  if (path !== "/auth/google/callback")
    return respond(404, null, [], "Not found.");
  const [state, verifier] = (cookie(request, OAUTH_COOKIE) ?? "").split(".");
  const code = url.searchParams.get("code");
  if (
    !state ||
    !verifier ||
    !TOKEN.test(state) ||
    !TOKEN.test(verifier) ||
    url.searchParams.get("state") !== state
  )
    return failed("Sign-in expired or was started in another tab.");
  if (!code || code.length > 2048)
    return failed("Google did not complete sign-in.");
  const exchange = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!exchange.ok) return failed("Google did not accept the sign-in.");
  // The ID token comes straight from Google's token endpoint over TLS, so its
  // signature need not be rechecked (OpenID Connect Core 3.1.3.7, item 6).
  const claims = idTokenClaims(
    ((await exchange.json().catch(() => null)) as { id_token?: unknown } | null)
      ?.id_token,
  );
  const sub = claims?.["sub"],
    email = claims?.["email"],
    exp = claims?.["exp"];
  if (
    !claims ||
    !GOOGLE_ISSUERS.has(String(claims["iss"])) ||
    claims["aud"] !== env.GOOGLE_CLIENT_ID ||
    typeof exp !== "number" ||
    exp * 1000 <= now ||
    typeof sub !== "string" ||
    !/^[0-9]{1,64}$/.test(sub) ||
    claims["email_verified"] !== true ||
    typeof email !== "string" ||
    email.length > 320
  )
    return failed("Google returned an unusable account.");
  const allowed = new Set(
    (env.OWNER_EMAILS ?? "")
      .toLowerCase()
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!allowed.has(email.toLowerCase()))
    return respond(
      403,
      null,
      [cookieHeader(OAUTH_COOKIE, "", 0)],
      "This planner is private.",
    );
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at<=?").bind(
      time(now),
    ),
    env.DB.prepare(
      "INSERT INTO auth_sessions(token_hash,user_id,email,created_at,expires_at) VALUES(?,?,?,?,?)",
    ).bind(
      await sessionHash(token),
      `google:${sub}`,
      email.toLowerCase(),
      time(now),
      time(now + SESSION_SECONDS * 1000),
    ),
  ]);
  return respond(302, "/", [
    cookieHeader(OAUTH_COOKIE, "", 0),
    cookieHeader(SESSION_COOKIE, token, SESSION_SECONDS),
  ]);
}

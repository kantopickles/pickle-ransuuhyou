// LINE access is enforced in worker.ts, before either the data API or WebSocket
// reaches the app. Client-side display checks alone do not protect a schedule.
export type LineEnvironment = {
  LINE_ACCESS_REQUIRED?: string;
  LINE_CHANNEL_ID?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_SESSION_SECRET?: string;
  LINE_CALLBACK_URL?: string;
  LINE_OFFICIAL_ACCOUNT_ID?: string;
};

export type LineAccessState = "allowed" | "login_required" | "friend_required" | "unavailable" | "not_configured";
export type LineAccess = { state: LineAccessState; cookie?: string };
type Config = { channel: string; secret: string; encryption: string; callback: string; account: string };
type Flow = { state: string; verifier: string; returnTo: string; expires: number };
type Session = { accessToken: string; expires: number; friend: boolean; checked: number };

const DAY = 86400;
const FRIEND_CACHE_SECONDS = 300;
const encoder = new TextEncoder();
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "Referrer-Policy": "no-referrer" };
const seconds = () => Math.floor(Date.now() / 1000);

export function lineRequired(env: LineEnvironment) {
  return env.LINE_ACCESS_REQUIRED === "true";
}

function config(env: LineEnvironment): Config | null {
  try {
    const url = new URL(env.LINE_CALLBACK_URL ?? "");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) return null;
    if (url.pathname !== "/api/line/callback" || url.search || url.hash || url.username || url.password) return null;
    if (!/^\d+$/.test(env.LINE_CHANNEL_ID ?? "") || !env.LINE_CHANNEL_SECRET || (env.LINE_SESSION_SECRET?.length ?? 0) < 32) return null;
    if (!/^@[A-Za-z0-9_-]+$/.test(env.LINE_OFFICIAL_ACCOUNT_ID ?? "")) return null;
    return {
      channel: env.LINE_CHANNEL_ID!, secret: env.LINE_CHANNEL_SECRET!, encryption: env.LINE_SESSION_SECRET!,
      callback: url.href, account: env.LINE_OFFICIAL_ACCOUNT_ID!
    };
  } catch { return null; }
}

export function safeLineReturnTo(value: string | null) {
  return value && (/^\/s\/[A-Za-z0-9]{6,20}$/.test(value) || value === "/line-access") ? value : "/line-access";
}

function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function unbase64(value: string) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
}

function random() { return base64(crypto.getRandomValues(new Uint8Array(32))); }

async function key(settings: Config) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(settings.encryption));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// Tokens never enter localStorage, a URL, or readable JavaScript cookies. AES-GCM
// both hides their contents and rejects modified cookies. AAD prevents swapping
// login-flow cookies with sessions, or reusing them for another channel/account.
async function seal(value: Flow | Session, purpose: string, settings: Config) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(`${purpose}:${settings.channel}:${settings.account}:${settings.callback}`);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, await key(settings), encoder.encode(JSON.stringify(value)));
  return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}

async function open<T>(value: string | undefined, purpose: string, settings: Config): Promise<T | null> {
  if (!value || value.length > 3500) return null;
  try {
    const [iv, data, extra] = value.split(".");
    if (!iv || !data || extra) return null;
    const decrypted = await crypto.subtle.decrypt({
      name: "AES-GCM", iv: unbase64(iv),
      additionalData: encoder.encode(`${purpose}:${settings.channel}:${settings.account}:${settings.callback}`)
    }, await key(settings), unbase64(data));
    return JSON.parse(new TextDecoder().decode(decrypted)) as T;
  } catch { return null; }
}

function cookieName(request: Request, purpose: string) {
  return `${new URL(request.url).protocol === "https:" ? "__Host-" : ""}pickleball_line_${purpose}`;
}

function readCookie(request: Request, purpose: string) {
  const name = `${cookieName(request, purpose)}=`;
  return (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(name))?.slice(name.length);
}

function cookie(request: Request, purpose: string, value: string, age: number) {
  return `${cookieName(request, purpose)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(age))}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}

async function lineFetch(url: string, init?: RequestInit) {
  return fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(8000) });
}

async function friendship(accessToken: string) {
  const response = await lineFetch("https://api.line.me/friendship/v1/status", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (response.status === 401) return "expired";
  if (!response.ok) throw new Error("LINE friendship check failed");
  const data = await response.json() as { friendFlag?: unknown };
  if (typeof data.friendFlag !== "boolean") throw new Error("Invalid LINE response");
  return data.friendFlag;
}

export async function readLineAccess(request: Request, env: LineEnvironment, force = false, preview = false): Promise<LineAccess> {
  if (!lineRequired(env) && !preview) return { state: "allowed" };
  const settings = config(env);
  if (!settings) return { state: "not_configured" };
  const session = await open<Session>(readCookie(request, "session"), "session", settings);
  if (!session || typeof session.accessToken !== "string" || !Number.isFinite(session.expires) || session.expires <= seconds()) {
    return { state: "login_required" };
  }
  if (!force && typeof session.friend === "boolean" && Number.isFinite(session.checked) && session.checked > seconds() - FRIEND_CACHE_SECONDS && session.checked <= seconds()) {
    return { state: session.friend ? "allowed" : "friend_required" };
  }
  try {
    const friend = await friendship(session.accessToken);
    if (friend === "expired") return { state: "login_required", cookie: cookie(request, "session", "", 0) };
    session.friend = friend;
    session.checked = seconds();
    return {
      state: friend ? "allowed" : "friend_required",
      cookie: cookie(request, "session", await seal(session, "session", settings), session.expires - seconds())
    };
  } catch {
    // A timeout, malformed response or provider error must never grant access.
    return { state: "unavailable" };
  }
}

export function lineAccessResponse(access: LineAccess) {
  const status = access.state === "allowed" ? 200 : access.state === "login_required" ? 401 : access.state === "friend_required" ? 403 : 503;
  const headers = new Headers(PRIVATE_HEADERS);
  if (access.cookie) headers.append("Set-Cookie", access.cookie);
  return Response.json({ access: access.state }, { status, headers });
}

export function attachLineCookie(response: Response, access: LineAccess) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) headers.set(name, value);
  if (access.cookie) headers.append("Set-Cookie", access.cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function isProtectedShareRead(request: Request) {
  let path = new URL(request.url).pathname;
  try { path = decodeURIComponent(path); } catch { /* Invalid paths contain no valid schedule ID. */ }
  // Match the namespace, not only ASCII IDs: encoded IDs and trailing slashes
  // must not reach the router without the same authentication check.
  return (request.method === "GET" || request.method === "HEAD") && /^\/api\/(share|realtime)\//.test(path.replace(/\/+/g, "/"));
}

export async function handleLineRequest(request: Request, env: LineEnvironment): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/line/")) return null;
  const settings = config(env);
  if (url.pathname === "/api/line/status" && (request.method === "GET" || request.method === "POST")) {
    if (request.method === "POST" && request.headers.get("origin") !== url.origin) return new Response(null, { status: 403, headers: PRIVATE_HEADERS });
    const access = await readLineAccess(request, env, request.method === "POST", url.searchParams.get("preview") === "1");
    const headers = new Headers(PRIVATE_HEADERS);
    if (access.cookie) headers.append("Set-Cookie", access.cookie);
    return Response.json({ access: access.state, required: lineRequired(env), accountId: env.LINE_OFFICIAL_ACCOUNT_ID ?? null, friendUrl: settings ? `https://line.me/R/ti/p/${encodeURIComponent(settings.account)}` : null }, { headers });
  }
  if (url.pathname === "/api/line/logout" && request.method === "POST") {
    if (request.headers.get("origin") !== url.origin) return new Response(null, { status: 403, headers: PRIVATE_HEADERS });
    return new Response(null, { status: 204, headers: { ...PRIVATE_HEADERS, "Set-Cookie": cookie(request, "session", "", 0) } });
  }
  if (request.method !== "GET") return new Response(null, { status: 405, headers: PRIVATE_HEADERS });
  if (!settings || new URL(settings.callback).origin !== url.origin) return lineAccessResponse({ state: "not_configured" });

  if (url.pathname === "/api/line/start") {
    const state = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const verifier = random();
    const flow: Flow = { state, verifier, returnTo: safeLineReturnTo(url.searchParams.get("returnTo")), expires: seconds() + 600 };
    const authorize = new URL("https://access.line.me/oauth2/v2.1/authorize");
    authorize.search = new URLSearchParams({
      response_type: "code", client_id: settings.channel, redirect_uri: settings.callback,
      scope: "profile", state, bot_prompt: "aggressive", ui_locales: "ja",
      code_challenge: base64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)))),
      code_challenge_method: "S256"
    }).toString();
    if (url.searchParams.get("switch") === "1") authorize.searchParams.set("prompt", "login");
    return new Response(null, { status: 302, headers: { ...PRIVATE_HEADERS, Location: authorize.href, "Set-Cookie": cookie(request, "flow", await seal(flow, "flow", settings), 600) } });
  }
  if (url.pathname === "/api/line/callback") {
    const flow = await open<Flow>(readCookie(request, "flow"), "flow", settings);
    const validFlow = flow && flow.expires > seconds() && flow.state === url.searchParams.get("state") && typeof flow.verifier === "string";
    const destination = new URL(validFlow ? safeLineReturnTo(flow.returnTo) : "/line-access", url.origin);
    const headers = new Headers(PRIVATE_HEADERS);
    headers.append("Set-Cookie", cookie(request, "flow", "", 0));
    let error = "";
    if (!validFlow) error = "session";
    else if (url.searchParams.has("error")) error = "cancelled";
    else if (!url.searchParams.get("code")) error = "session";
    else {
      try {
        const tokenResponse = await lineFetch("https://api.line.me/oauth2/v2.1/token", {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "authorization_code", code: url.searchParams.get("code")!, redirect_uri: settings.callback, client_id: settings.channel, client_secret: settings.secret, code_verifier: flow.verifier })
        });
        if (!tokenResponse.ok) throw new Error("Token exchange failed");
        const token = await tokenResponse.json() as { access_token?: unknown; expires_in?: unknown; scope?: unknown; token_type?: unknown };
        if (typeof token.access_token !== "string" || token.access_token.length > 2000 || typeof token.expires_in !== "number" || token.expires_in <= 60 || token.token_type !== "Bearer" || typeof token.scope !== "string" || !token.scope.split(" ").includes("profile")) throw new Error("Invalid token response");
        const verifyUrl = new URL("https://api.line.me/oauth2/v2.1/verify");
        verifyUrl.searchParams.set("access_token", token.access_token);
        const verifyResponse = await lineFetch(verifyUrl.href);
        if (!verifyResponse.ok) throw new Error("Token verification failed");
        const verified = await verifyResponse.json() as { client_id?: unknown; expires_in?: unknown };
        if (verified.client_id !== settings.channel || typeof verified.expires_in !== "number" || verified.expires_in <= 60) throw new Error("Wrong token audience");
        const session: Session = {
          accessToken: token.access_token, friend: false, checked: 0,
          expires: seconds() + Math.min(30 * DAY, token.expires_in - 60, verified.expires_in - 60)
        };
        // The login callback does not infer friendship from
        // friendship_status_changed. Existing friends also return false there.
        // The status endpoint checks the actual friendFlag after redirect.
        headers.append("Set-Cookie", cookie(request, "session", await seal(session, "session", settings), session.expires - seconds()));
      } catch { error = "connection"; }
    }
    if (error) destination.searchParams.set("line_error", error);
    headers.set("Location", destination.href);
    return new Response(null, { status: 302, headers });
  }
  return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
}

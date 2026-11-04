// LINE access is enforced in worker.ts, before either the data API or WebSocket
// reaches the app. Client-side display checks alone do not protect a schedule.
import { InvalidJsonBody, readBoundedJson } from "./request-json.ts";
export type LineEnvironment = {
  LINE_ACCESS_REQUIRED?: string;
  LINE_CHANNEL_ID?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_SESSION_SECRET?: string;
  LINE_CALLBACK_URL?: string;
  LINE_OFFICIAL_ACCOUNT_ID?: string;
  LINE_MINIAPP_CHANNEL_ID?: string;
  LINE_MINIAPP_LIFF_ID?: string;
  LINE_MINIAPP_SHARE_ENABLED?: string;
  LINE_SERVICE_MESSAGES_REQUIRED?: string;
  LINE_MINIAPP_CHANNEL_SECRET?: string;
  LINE_SERVICE_TEMPLATE_NAME?: string;
  LINE_SERVICE_TEMPLATE_PARAMS?: string;
};

export type LineAccessState = "allowed" | "login_required" | "friend_required" | "unavailable" | "not_configured";
export type LineAccess = { state: LineAccessState; cookie?: string };
type Config = { channel: string; secret: string; encryption: string; callback: string; account: string };
type Flow = { state: string; verifier: string; returnTo: string; expires: number };
type ReturnContext = { returnTo: string; expires: number };
type ServiceSecret = { token: string };
type Session = { accessToken: string; expires: number; friend: boolean; checked: number; viewerKey?: string };

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
  return value && (/^\/s\/[A-Za-z0-9]{6,20}$/.test(value) || value === "/line-access" || value === "/recent" || value === "/resume") ? value : "/line-access";
}

export function lineMiniConfig(env: LineEnvironment) {
  return /^\d+$/.test(env.LINE_MINIAPP_CHANNEL_ID ?? "") && /^\d+-[A-Za-z0-9]+$/.test(env.LINE_MINIAPP_LIFF_ID ?? "")
    ? { channelId: env.LINE_MINIAPP_CHANNEL_ID!, liffId: env.LINE_MINIAPP_LIFF_ID! } : null;
}

function sessionContext(request: Request, env: LineEnvironment, settings: Config) {
  if (new URL(request.url).searchParams.get("line_context") !== "mini") return { settings, purpose: "session" };
  const mini = lineMiniConfig(env);
  return mini ? { settings: { ...settings, channel: mini.channelId }, purpose: "mini_session" } : null;
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

// The server stores tokens only in encrypted, HttpOnly cookies. LIFF manages its
// own SDK credentials; app code must not copy them to localStorage or URLs. AES-GCM
// hides cookie contents and rejects modification. AAD prevents swapping
// login-flow cookies with sessions, or reusing them for another channel/account.
async function seal(value: Flow | Session | ReturnContext | ServiceSecret, purpose: string, settings: Config) {
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

// Each login attempt gets its own cookie, so opening another QR/link or double
// tapping login cannot overwrite the first attempt's state and PKCE verifier.
function flowPurpose(state: string | null) {
  return state && /^[a-f0-9]{48,1000}$/.test(state) ? `flow_${state.slice(0, 48)}` : "flow";
}

async function returnContext(state: string | null, settings: Config) {
  if (!state || !/^[a-f0-9]{50,1000}$/.test(state) || state.length % 2 !== 0) return null;
  const bytes = Uint8Array.from(state.slice(48).match(/../g)!, (hex) => parseInt(hex, 16));
  const context = await open<ReturnContext>(new TextDecoder().decode(bytes), "return", settings);
  return context && Number.isFinite(context.expires) && context.expires > seconds()
    && context.returnTo === safeLineReturnTo(context.returnTo) ? context : null;
}

async function lineFetch(url: string, init?: RequestInit) {
  // Workers supports only "follow" and "manual", not the browser's "error".
  // Inspect redirects ourselves so credentials never follow another location.
  const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(8000) });
  if (response.status >= 300 && response.status < 400) throw new Error("Unexpected LINE redirect");
  return response;
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
  const context = sessionContext(request, env, settings);
  if (!context) return { state: "not_configured" };
  const { purpose, settings: sessionSettings } = context;
  const session = await open<Session>(readCookie(request, purpose), purpose, sessionSettings);
  if (!session || typeof session.accessToken !== "string" || !Number.isFinite(session.expires) || session.expires <= seconds()) {
    return { state: "login_required" };
  }
  if (!force && typeof session.friend === "boolean" && Number.isFinite(session.checked) && session.checked > seconds() - FRIEND_CACHE_SECONDS && session.checked <= seconds()) {
    return { state: session.friend ? "allowed" : "friend_required" };
  }
  try {
    const friend = await friendship(session.accessToken);
    if (friend === "expired") return { state: "login_required", cookie: cookie(request, purpose, "", 0) };
    session.friend = friend;
    session.checked = seconds();
    return {
      state: friend ? "allowed" : "friend_required",
      cookie: cookie(request, purpose, await seal(session, purpose, sessionSettings), session.expires - seconds())
    };
  } catch {
    // A timeout, malformed response or provider error must never grant access.
    return { state: "unavailable" };
  }
}

// The browser never supplies a user ID. Obtain it from LINE with the already
// verified token, then HMAC it before using it as a per-viewer database key.
// Web and mini-app channels must belong to the same LINE provider to share IDs.
export async function readLineViewer(request: Request, env: LineEnvironment, force = false) {
  const access = await readLineAccess(request, env, force, true);
  if (access.state !== "allowed") return { access, viewerKey: null };
  const settings = config(env)!;
  const context = sessionContext(request, env, settings)!;
  const refreshed = access.cookie?.split(";")[0].split("=").slice(1).join("=");
  const session = await open<Session>(refreshed ?? readCookie(request, context.purpose), context.purpose, context.settings);
  if (!session) return { access: { state: "login_required" } as LineAccess, viewerKey: null };
  if (session.viewerKey && /^[a-f0-9]{64}$/.test(session.viewerKey)) return { access, viewerKey: session.viewerKey };
  try {
    const response = await lineFetch("https://api.line.me/v2/profile", { headers: { Authorization: `Bearer ${session.accessToken}` } });
    if (!response.ok) throw new Error("Profile unavailable");
    const profile = await response.json() as { userId?: unknown };
    if (typeof profile.userId !== "string" || !/^U[a-f0-9]{32}$/.test(profile.userId)) throw new Error("Invalid identity");
    const hmacKey = await crypto.subtle.importKey("raw", encoder.encode(settings.encryption), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(`pickleball-viewer:${profile.userId}`));
    session.viewerKey = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
    return { access: { state: "allowed", cookie: cookie(request, context.purpose, await seal(session, context.purpose, context.settings), session.expires - seconds()) } as LineAccess, viewerKey: session.viewerKey };
  } catch {
    return { access: { state: "unavailable" } as LineAccess, viewerKey: null };
  }
}

// Server-only credentials for a verified mini session. Never return this object
// from an HTTP handler or log it; recipients and tokens are not browser inputs.
export async function readLineMiniCredentials(request: Request, env: LineEnvironment, force = false) {
  if (new URL(request.url).searchParams.get("line_context") !== "mini") return null;
  const viewer = await readLineViewer(request, env, force);
  if (viewer.access.state !== "allowed" || !viewer.viewerKey) return { ...viewer, session: null };
  const settings = config(env);
  if (!settings) return null;
  const context = sessionContext(request, env, settings);
  if (!context) return null;
  const refreshed = viewer.access.cookie?.split(";")[0].split("=").slice(1).join("=");
  const session = await open<Session>(refreshed ?? readCookie(request, context.purpose), context.purpose, context.settings);
  return { ...viewer, session };
}

export async function sealLineServiceToken(token: string, env: LineEnvironment) {
  const settings = config(env);
  const mini = lineMiniConfig(env);
  if (!settings || !mini) throw new Error("LINE configuration unavailable");
  return seal({ token }, "service_token", { ...settings, channel: mini.channelId });
}

export async function openLineServiceToken(value: string, env: LineEnvironment) {
  const settings = config(env);
  const mini = lineMiniConfig(env);
  if (!settings || !mini) return null;
  const data = await open<ServiceSecret>(value, "service_token", { ...settings, channel: mini.channelId });
  return typeof data?.token === "string" ? data.token : null;
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
  if (url.pathname === "/api/line/mini/config" && request.method === "GET") {
    const mini = lineMiniConfig(env);
    return Response.json({ enabled: Boolean(settings && mini), shareEnabled: Boolean(settings && mini && env.LINE_MINIAPP_SHARE_ENABLED === "true"), liffId: mini?.liffId ?? null, accountId: env.LINE_OFFICIAL_ACCOUNT_ID ?? null }, { headers: PRIVATE_HEADERS });
  }
  if (url.pathname === "/api/line/mini/session" && request.method === "POST") {
    if (request.headers.get("origin") !== url.origin) return new Response(null, { status: 403, headers: PRIVATE_HEADERS });
    const mini = lineMiniConfig(env);
    if (!settings || !mini || new URL(settings.callback).origin !== url.origin) return lineAccessResponse({ state: "not_configured" });
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return new Response(null, { status: 400, headers: PRIVATE_HEADERS });
    let token: unknown;
    try {
      const body = await readBoundedJson(request, 4096);
      token = body && typeof body === "object" && !Array.isArray(body) ? (body as { accessToken?: unknown }).accessToken : null;
    } catch (error) { return new Response(null, { status: error instanceof InvalidJsonBody ? error.status : 400, headers: PRIVATE_HEADERS }); }
    if (typeof token !== "string" || !token || token.length > 2000) return new Response(null, { status: 400, headers: PRIVATE_HEADERS });
    try {
      const verifyUrl = new URL("https://api.line.me/oauth2/v2.1/verify");
      verifyUrl.searchParams.set("access_token", token);
      const response = await lineFetch(verifyUrl.href);
      if (!response.ok) return lineAccessResponse({ state: "login_required" });
      const verified = await response.json() as { client_id?: unknown; expires_in?: unknown; scope?: unknown };
      if (verified.client_id !== mini.channelId || typeof verified.expires_in !== "number" || !Number.isFinite(verified.expires_in) || verified.expires_in <= 60 || typeof verified.scope !== "string" || !verified.scope.split(" ").includes("profile")) return lineAccessResponse({ state: "login_required" });
      const friend = await friendship(token);
      if (friend === "expired") return lineAccessResponse({ state: "login_required" });
      const session: Session = { accessToken: token, expires: seconds() + Math.min(30 * DAY, verified.expires_in - 60), friend, checked: seconds() };
      const value = await seal(session, "mini_session", { ...settings, channel: mini.channelId });
      return lineAccessResponse({ state: friend ? "allowed" : "friend_required", cookie: cookie(request, "mini_session", value, session.expires - seconds()) });
    } catch { return lineAccessResponse({ state: "unavailable" }); }
  }
  if (url.pathname === "/api/line/status" && (request.method === "GET" || request.method === "POST")) {
    if (request.method === "POST" && request.headers.get("origin") !== url.origin) return new Response(null, { status: 403, headers: PRIVATE_HEADERS });
    const access = await readLineAccess(request, env, request.method === "POST", url.searchParams.get("preview") === "1");
    const headers = new Headers(PRIVATE_HEADERS);
    if (access.cookie) headers.append("Set-Cookie", access.cookie);
    return Response.json({ access: access.state, required: lineRequired(env), accountId: env.LINE_OFFICIAL_ACCOUNT_ID ?? null, friendUrl: settings ? `https://line.me/R/ti/p/${encodeURIComponent(settings.account)}` : null }, { headers });
  }
  if (url.pathname === "/api/line/logout" && request.method === "POST") {
    if (request.headers.get("origin") !== url.origin) return new Response(null, { status: 403, headers: PRIVATE_HEADERS });
    const purpose = url.searchParams.get("line_context") === "mini" ? "mini_session" : "session";
    return new Response(null, { status: 204, headers: { ...PRIVATE_HEADERS, "Set-Cookie": cookie(request, purpose, "", 0) } });
  }
  if (request.method !== "GET") return new Response(null, { status: 405, headers: PRIVATE_HEADERS });
  if (!settings || new URL(settings.callback).origin !== url.origin) return lineAccessResponse({ state: "not_configured" });

  if (url.pathname === "/api/line/start") {
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const returnTo = safeLineReturnTo(url.searchParams.get("returnTo"));
    const expires = seconds() + 600;
    // The authenticated return context carries ONLY navigation information. It
    // never carries a token or verifier and never substitutes for the browser
    // cookie. If LINE returns in a different browser, we can keep the intended
    // share URL, but must start a fresh, cookie-bound login before granting access.
    // Hex encoding keeps LINE's state parameter strictly alphanumeric.
    const context = await seal({ returnTo, expires }, "return", settings);
    const state = nonce + Array.from(encoder.encode(context), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const verifier = random();
    const flow: Flow = { state, verifier, returnTo, expires };
    const authorize = new URL("https://access.line.me/oauth2/v2.1/authorize");
    authorize.search = new URLSearchParams({
      response_type: "code", client_id: settings.channel, redirect_uri: settings.callback,
      scope: "profile", state, bot_prompt: "aggressive", ui_locales: "ja",
      code_challenge: base64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)))),
      code_challenge_method: "S256"
    }).toString();
    if (url.searchParams.get("switch") === "1") authorize.searchParams.set("prompt", "login");
    if (url.searchParams.get("browser") === "1") authorize.searchParams.set("disable_auto_login", "true");
    return new Response(null, { status: 302, headers: { ...PRIVATE_HEADERS, Location: authorize.href, "Set-Cookie": cookie(request, flowPurpose(state), await seal(flow, "flow", settings), 600) } });
  }
  if (url.pathname === "/api/line/callback") {
    const state = url.searchParams.get("state");
    const purpose = flowPurpose(state);
    // Accept legacy in-flight logins during rollout without changing sessions.
    const flow = await open<Flow>(readCookie(request, purpose) ?? readCookie(request, "flow"), "flow", settings);
    const validFlow = flow && flow.expires > seconds() && flow.state === url.searchParams.get("state") && typeof flow.verifier === "string";
    const context = validFlow ? null : await returnContext(state, settings);
    const destination = new URL(validFlow ? safeLineReturnTo(flow.returnTo) : context?.returnTo ?? "/line-access", url.origin);
    const headers = new Headers(PRIVATE_HEADERS);
    headers.append("Set-Cookie", cookie(request, purpose, "", 0));
    if (readCookie(request, "flow")) headers.append("Set-Cookie", cookie(request, "flow", "", 0));
    let error = "";
    if (!validFlow) {
      error = context ? "browser" : "session";
      console.warn("LINE_FLOW_DIAGNOSTIC", JSON.stringify({ reason: context ? "browser_context_missing" : "invalid_or_expired_flow", hasFlowCookie: Boolean(readCookie(request, purpose) || readCookie(request, "flow")) }));
    }
    else if (url.searchParams.has("error")) error = "cancelled";
    else if (!url.searchParams.get("code")) error = "session";
    else {
      // Only allowlisted status/type checks are logged. Never log the callback
      // URL, authorization code, tokens, client secret, or provider error text.
      const diagnostic: Record<string, string | number | boolean> = { stage: "token_exchange" };
      try {
        const tokenResponse = await lineFetch("https://api.line.me/oauth2/v2.1/token", {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "authorization_code", code: url.searchParams.get("code")!, redirect_uri: settings.callback, client_id: settings.channel, client_secret: settings.secret, code_verifier: flow.verifier })
        });
        diagnostic.httpStatus = tokenResponse.status;
        if (!tokenResponse.ok) {
          const failure = await tokenResponse.json().catch(() => ({})) as { error?: unknown };
          const knownErrors = ["invalid_client", "invalid_grant", "invalid_request", "invalid_scope", "unsupported_grant_type"];
          diagnostic.providerError = typeof failure.error === "string" && knownErrors.includes(failure.error) ? failure.error : "other";
          throw new Error("Token exchange failed");
        }
        diagnostic.stage = "token_response";
        const token = await tokenResponse.json() as { access_token?: unknown; expires_in?: unknown; scope?: unknown; token_type?: unknown };
        diagnostic.hasAccessToken = typeof token.access_token === "string";
        diagnostic.validTokenLength = typeof token.access_token === "string" && token.access_token.length <= 2000;
        diagnostic.validExpiry = typeof token.expires_in === "number" && token.expires_in > 60;
        diagnostic.isBearer = token.token_type === "Bearer";
        diagnostic.hasProfileScope = typeof token.scope === "string" && token.scope.split(" ").includes("profile");
        if (typeof token.access_token !== "string" || token.access_token.length > 2000 || typeof token.expires_in !== "number" || token.expires_in <= 60 || token.token_type !== "Bearer" || typeof token.scope !== "string" || !token.scope.split(" ").includes("profile")) throw new Error("Invalid token response");
        diagnostic.stage = "token_verify";
        const verifyUrl = new URL("https://api.line.me/oauth2/v2.1/verify");
        verifyUrl.searchParams.set("access_token", token.access_token);
        const verifyResponse = await lineFetch(verifyUrl.href);
        diagnostic.httpStatus = verifyResponse.status;
        if (!verifyResponse.ok) throw new Error("Token verification failed");
        const verified = await verifyResponse.json() as { client_id?: unknown; expires_in?: unknown };
        diagnostic.validAudience = verified.client_id === settings.channel;
        diagnostic.validVerifiedExpiry = typeof verified.expires_in === "number" && verified.expires_in > 60;
        if (verified.client_id !== settings.channel || typeof verified.expires_in !== "number" || verified.expires_in <= 60) throw new Error("Wrong token audience");
        diagnostic.stage = "session_cookie";
        const session: Session = {
          accessToken: token.access_token, friend: false, checked: 0,
          expires: seconds() + Math.min(30 * DAY, token.expires_in - 60, verified.expires_in - 60)
        };
        // The login callback does not infer friendship from
        // friendship_status_changed. Existing friends also return false there.
        // The status endpoint checks the actual friendFlag after redirect.
        headers.append("Set-Cookie", cookie(request, "session", await seal(session, "session", settings), session.expires - seconds()));
      } catch {
        console.warn("LINE_CALLBACK_DIAGNOSTIC", JSON.stringify(diagnostic));
        error = "connection";
      }
    }
    if (error) destination.searchParams.set("line_error", error);
    headers.set("Location", destination.href);
    return new Response(null, { status: 302, headers });
  }
  return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
}

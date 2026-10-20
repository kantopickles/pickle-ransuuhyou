import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  handleLineRequest, isProtectedShareRead, lineAccessResponse,
  readLineAccess, safeLineReturnTo, type LineEnvironment
} from "../app/lib/line-access.ts";

const origin = "https://pickleball.example";
const env: LineEnvironment = {
  LINE_ACCESS_REQUIRED: "true", LINE_CHANNEL_ID: "1234567890",
  LINE_CHANNEL_SECRET: "test-channel-secret", LINE_SESSION_SECRET: "test-session-secret-at-least-32-characters",
  LINE_OFFICIAL_ACCOUNT_ID: "@892ixgpm", LINE_CALLBACK_URL: `${origin}/api/line/callback`
};
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function request(path: string, cookie = "", method = "GET") {
  return new Request(`${origin}${path}`, { method, headers: { cookie, origin } });
}

function cookieValue(response: Response, name: string) {
  return response.headers.getSetCookie().find((item) => item.startsWith(`__Host-pickleball_line_${name}=`))?.split(";")[0] ?? "";
}

async function begin() {
  const response = await handleLineRequest(request("/api/line/start?returnTo=/s/ABC12345"), env);
  assert.equal(response?.status, 302);
  return { authorize: new URL(response!.headers.get("location")!), flow: cookieValue(response!, "flow") };
}

function mockLine(friend: boolean | "timeout" | "expired", audience = env.LINE_CHANNEL_ID) {
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.redirect, "manual", "Cloudflare does not implement redirect:error; do not follow credentials to another location");
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.line.me");
    calls++;
    if (url.pathname === "/oauth2/v2.1/token") {
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("client_id"), env.LINE_CHANNEL_ID);
      assert.equal(body.get("redirect_uri"), env.LINE_CALLBACK_URL);
      assert.equal(body.get("code_verifier")?.length, 43);
      return Response.json({ access_token: "secret-user-token", expires_in: 2592000, scope: "profile", token_type: "Bearer" });
    }
    if (url.pathname === "/oauth2/v2.1/verify") return Response.json({ client_id: audience, expires_in: 2592000 });
    assert.equal(url.pathname, "/friendship/v1/status");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer secret-user-token");
    if (friend === "timeout") throw new Error("network timeout");
    if (friend === "expired") return new Response(null, { status: 401 });
    return Response.json({ friendFlag: friend });
  };
  return () => calls;
}

async function login() {
  const { authorize, flow } = await begin();
  const response = await handleLineRequest(request(`/api/line/callback?code=test-code&state=${authorize.searchParams.get("state")}`, flow), env);
  assert.equal(response?.headers.get("location"), `${origin}/s/ABC12345`);
  const session = cookieValue(response!, "session");
  assert.ok(session);
  assert.ok(!session.includes("secret-user-token"));
  return session;
}

test("off by default, but enabling without credentials fails closed", async () => {
  assert.equal((await readLineAccess(request("/api/share/ABC12345"), {})).state, "allowed");
  assert.equal((await readLineAccess(request("/api/share/ABC12345"), { LINE_ACCESS_REQUIRED: "true" })).state, "not_configured");
  assert.equal((await readLineAccess(request("/api/share/ABC12345"), env)).state, "login_required");
});

test("same read protection covers encoded IDs, namespace encodings, duplicate and trailing slashes", () => {
  for (const path of ["/api/share/ABC12345", "/api/share/%41BC12345", "/api/%73hare/ABC12345/", "/api//share/ABC12345", "/api/realtime/ABC12345"]) assert.ok(isProtectedShareRead(request(path)), path);
  assert.ok(!isProtectedShareRead(request("/api/share", "", "POST")));
  assert.ok(!isProtectedShareRead(request("/api/admin/schedules")));
});

test("return URL accepts only known local pages", () => {
  for (const path of ["https://attacker.example/s/ABC12345", "//attacker.example", "/s/ABC12345?next=evil", "/s/../admin", null]) assert.equal(safeLineReturnTo(path), "/line-access");
  assert.equal(safeLineReturnTo("/s/ABC12345"), "/s/ABC12345");
});

test("authorization uses state, S256 PKCE and add-friend prompt without requesting email", async () => {
  const { authorize, flow } = await begin();
  assert.equal(authorize.origin, "https://access.line.me");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorize.searchParams.get("scope"), "profile");
  assert.equal(authorize.searchParams.get("bot_prompt"), "aggressive");
  assert.match(authorize.searchParams.get("state")!, /^[a-f0-9]{48}$/);
  assert.ok(flow);
  assert.notEqual((await begin()).authorize.searchParams.get("state"), authorize.searchParams.get("state"));
});

test("wrong state, missing flow and cancelled consent never issue a session", async () => {
  const calls = mockLine(true);
  const { flow, authorize } = await begin();
  for (const req of [request("/api/line/callback?code=test-code&state=wrong", flow), request(`/api/line/callback?code=test-code&state=${authorize.searchParams.get("state")}`), request(`/api/line/callback?error=access_denied&state=${authorize.searchParams.get("state")}`, flow)]) {
    const response = await handleLineRequest(req, env);
    assert.equal(cookieValue(response!, "session"), "");
    assert.ok(response?.headers.get("location")?.includes("line_error="));
    assert.ok(response?.headers.getSetCookie().some((value) => value.includes("Max-Age=0")));
  }
  assert.equal(calls(), 0);
});

test("callback validates token audience and refuses tokens for another channel", async () => {
  mockLine(true, "wrong-channel");
  const { flow, authorize } = await begin();
  const response = await handleLineRequest(request(`/api/line/callback?code=test-code&state=${authorize.searchParams.get("state")}`, flow), env);
  assert.equal(cookieValue(response!, "session"), "");
  assert.ok(response?.headers.get("location")?.includes("line_error=connection"));
});

test("a LINE API redirect fails closed without following it or issuing a session", async () => {
  const { flow, authorize } = await begin();
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "https://other.example/collect" } });
  };
  const response = await handleLineRequest(request(`/api/line/callback?code=test-code&state=${authorize.searchParams.get("state")}`, flow), env);
  assert.equal(cookieValue(response!, "session"), "");
  assert.ok(response?.headers.get("location")?.includes("line_error=connection"));
  assert.equal(calls, 1);
});

test("callback diagnostics never log credentials, codes, tokens or raw provider messages", async () => {
  const { flow, authorize } = await begin();
  const warnings: unknown[][] = [];
  const warn = console.warn;
  try {
    console.warn = (...args) => { warnings.push(args); };
    globalThis.fetch = async () => { throw new Error(`Unsafe provider message: ${env.LINE_CHANNEL_SECRET} secret-user-token test-code`); };
    await handleLineRequest(request(`/api/line/callback?code=test-code&state=${authorize.searchParams.get("state")}`, flow), env);
    const logged = JSON.stringify(warnings);
    assert.ok(logged.includes("token_exchange"));
    for (const value of [env.LINE_CHANNEL_SECRET!, "secret-user-token", "test-code", "Unsafe provider message"]) assert.ok(!logged.includes(value));
  } finally { console.warn = warn; }
});

test("a login flow expires after ten minutes and cannot be moved to another origin", async () => {
  const calls = mockLine(true);
  const { flow, authorize } = await begin();
  const now = Date.now;
  try {
    Date.now = () => now() + 11 * 60 * 1000;
    const response = await handleLineRequest(request(`/api/line/callback?code=test-code&state=${authorize.searchParams.get("state")}`, flow), env);
    assert.ok(response?.headers.get("location")?.includes("line_error=session"));
    assert.equal(cookieValue(response!, "session"), "");
  } finally { Date.now = now; }
  const wrongHost = await handleLineRequest(new Request("https://other.example/api/line/start"), env);
  assert.equal(wrongHost?.status, 503);
  assert.equal(calls(), 0);
});

test("friend-only access persists as encrypted, HttpOnly, Secure cookie and cached verification", async () => {
  const calls = mockLine(true);
  const session = await login();
  const access = await readLineAccess(request("/api/share/ABC12345", session), env);
  assert.equal(access.state, "allowed");
  assert.match(access.cookie!, /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/);
  assert.ok(!access.cookie!.includes("secret-user-token"));
  const before = calls();
  assert.equal((await readLineAccess(request("/api/share/ABC12345", access.cookie!.split(";")[0]), env)).state, "allowed");
  assert.equal(calls(), before);
});

test("non-friends and blocked users cannot read; forced recheck observes new friendship", async () => {
  mockLine(false);
  const session = await login();
  const access = await readLineAccess(request("/api/share/ABC12345", session), env);
  assert.equal(access.state, "friend_required");
  assert.equal(lineAccessResponse(access).status, 403);
  mockLine(true);
  assert.equal((await readLineAccess(request("/api/line/status", access.cookie!.split(";")[0]), env, true)).state, "allowed");
});

test("friendship is rechecked after five minutes, and a newly blocked user is refused", async () => {
  mockLine(true);
  const session = await login();
  const allowed = await readLineAccess(request("/api/share/ABC12345", session), env);
  const now = Date.now;
  try {
    Date.now = () => now() + 301000;
    const calls = mockLine(false);
    assert.equal((await readLineAccess(request("/api/share/ABC12345", allowed.cookie!.split(";")[0]), env)).state, "friend_required");
    assert.equal(calls(), 1);
  } finally { Date.now = now; }
});

test("malformed friendship responses do not count as confirmed friendship", async () => {
  mockLine(true);
  const session = await login();
  globalThis.fetch = async () => Response.json({ friendFlag: "true" });
  assert.equal((await readLineAccess(request("/api/share/ABC12345", session), env)).state, "unavailable");
});

test("provider failure and revoked access tokens never grant access", async () => {
  mockLine("timeout");
  const session = await login();
  assert.equal((await readLineAccess(request("/api/share/ABC12345", session), env)).state, "unavailable");
  mockLine("expired");
  const expired = await readLineAccess(request("/api/share/ABC12345", session), env);
  assert.equal(expired.state, "login_required");
  assert.match(expired.cookie!, /Max-Age=0/);
});

test("tampering, channel/account changes, encryption-key rotation and expiration invalidate a session", async () => {
  mockLine(true);
  const session = await login();
  assert.equal((await readLineAccess(request("/api/share/ABC12345", session + "a"), env)).state, "login_required");
  for (const changed of [{ LINE_CHANNEL_ID: "9999" }, { LINE_OFFICIAL_ACCOUNT_ID: "@another" }, { LINE_SESSION_SECRET: "different-test-secret-more-than-32-characters" }]) assert.equal((await readLineAccess(request("/api/share/ABC12345", session), { ...env, ...changed })).state, "login_required");
  const now = Date.now;
  try {
    Date.now = () => now() + 31 * 86400 * 1000;
    assert.equal((await readLineAccess(request("/api/share/ABC12345", session), env)).state, "login_required");
  } finally { Date.now = now; }
});

test("cross-origin rechecks/logout are refused; responses never expose tokens", async () => {
  for (const path of ["/api/line/status", "/api/line/logout"]) {
    const response = await handleLineRequest(new Request(`${origin}${path}`, { method: "POST", headers: { origin: "https://attacker.example" } }), env);
    assert.equal(response?.status, 403);
  }
  mockLine(true);
  const session = await login();
  const response = await handleLineRequest(request("/api/line/status", session), env);
  const data = await response!.json() as { access: string; friendUrl: string };
  assert.equal(data.access, "allowed");
  assert.equal(data.friendUrl, "https://line.me/R/ti/p/%40892ixgpm");
  assert.ok(!JSON.stringify(data).includes("secret-user-token"));
  assert.equal(response?.headers.get("Cache-Control"), "private, no-store");
});

test("connection test verifies LINE even while public shares remain unrestricted", async () => {
  const disabled = { ...env, LINE_ACCESS_REQUIRED: "false" };
  const response = await handleLineRequest(request("/api/line/status?preview=1"), disabled);
  assert.equal((await response!.json() as { access: string }).access, "login_required");
  assert.equal((await readLineAccess(request("/api/share/ABC12345"), disabled)).state, "allowed");
});

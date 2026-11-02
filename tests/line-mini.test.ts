import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { handleLineRequest, readLineAccess, readLineViewer, type LineEnvironment } from "../app/lib/line-access.ts";

const origin = "https://pickleball.example";
const env: LineEnvironment = {
  LINE_ACCESS_REQUIRED: "true", LINE_CHANNEL_ID: "1234567890", LINE_CHANNEL_SECRET: "channel-secret",
  LINE_SESSION_SECRET: "session-secret-for-test-at-least-32-characters", LINE_CALLBACK_URL: `${origin}/api/line/callback`,
  LINE_OFFICIAL_ACCOUNT_ID: "@892ixgpm", LINE_MINIAPP_CHANNEL_ID: "2222222222", LINE_MINIAPP_LIFF_ID: "2222222222-abcdef"
};
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function req(path: string, cookie = "", body?: unknown, requestOrigin = origin) {
  return new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: { origin: requestOrigin, cookie, "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
function sessionCookie(response: Response, purpose = "mini_session") {
  return response.headers.getSetCookie().find(value => value.startsWith(`__Host-pickleball_line_${purpose}=`))?.split(";")[0] ?? "";
}
function mockLine(options: { friend?: boolean; channel?: string; scope?: string; expires?: number; profileId?: string; networkFail?: boolean } = {}) {
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.redirect, "manual");
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.line.me");
    calls.push(url.pathname);
    if (options.networkFail) throw new Error("provider offline");
    if (url.pathname === "/oauth2/v2.1/token") return Response.json({ access_token: "web-test-token", expires_in: 2592000, token_type: "Bearer", scope: "profile" });
    if (url.pathname === "/oauth2/v2.1/verify") return Response.json({ client_id: options.channel ?? (url.searchParams.get("access_token") === "web-test-token" ? env.LINE_CHANNEL_ID : env.LINE_MINIAPP_CHANNEL_ID), scope: options.scope ?? "profile openid", expires_in: options.expires ?? 3600 });
    if (url.pathname === "/friendship/v1/status") return Response.json({ friendFlag: options.friend ?? true });
    if (url.pathname === "/v2/profile") return Response.json({ userId: options.profileId ?? `U${"a".repeat(32)}`, displayName: "must-not-store-name", pictureUrl: "https://example.test/must-not-store.jpg" });
    throw new Error("Unexpected LINE route");
  };
  return calls;
}
async function miniLogin() {
  const response = await handleLineRequest(req("/api/line/mini/session", "", { accessToken: "mini-test-token" }), env);
  return { response: response!, cookie: sessionCookie(response!) };
}
async function webLogin() {
  const start = await handleLineRequest(req("/api/line/start?returnTo=/recent"), env);
  const state = new URL(start!.headers.get("location")!).searchParams.get("state");
  const flow = start!.headers.getSetCookie()[0].split(";")[0];
  const callback = await handleLineRequest(req(`/api/line/callback?code=test-code&state=${state}`, flow), env);
  return sessionCookie(callback!, "session");
}

test("mini configuration is explicit and exposes no secrets", async () => {
  const response = await handleLineRequest(req("/api/line/mini/config"), env);
  assert.deepEqual(await response!.json(), { enabled: true, shareEnabled: false, liffId: env.LINE_MINIAPP_LIFF_ID, accountId: "@892ixgpm" });
  const disabled = await handleLineRequest(req("/api/line/mini/config"), { ...env, LINE_MINIAPP_CHANNEL_ID: undefined });
  assert.equal((await disabled!.json() as { enabled: boolean }).enabled, false);
});

test("mini session verifies token audience, expiry, profile scope and actual friendship", async () => {
  const calls = mockLine();
  const { response, cookie } = await miniLogin();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { access: "allowed" });
  assert.deepEqual(calls, ["/oauth2/v2.1/verify", "/friendship/v1/status"]);
  assert.ok(cookie && !cookie.includes("mini-test-token"));
  assert.match(response.headers.getSetCookie()[0], /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/);
  assert.equal((await readLineAccess(req("/api/share/ABC12345?line_context=mini", cookie), env)).state, "allowed");
  assert.equal((await readLineAccess(req("/api/share/ABC12345", cookie), env)).state, "login_required");
});

test("web and mini accounts never silently substitute for each other", async () => {
  mockLine();
  const web = await webLogin();
  assert.equal((await readLineAccess(req("/api/share/ABC12345?line_context=mini", web), env)).state, "login_required");
  const mini = await miniLogin();
  assert.equal((await readLineAccess(req("/api/share/ABC12345", `${web}; ${mini.cookie}`), env)).state, "allowed");
  assert.equal((await readLineAccess(req("/api/share/ABC12345?line_context=mini", `${web}; ${mini.cookie}`), env)).state, "allowed");
});

test("wrong-channel, expired and insufficient-scope tokens never issue a mini session", async () => {
  for (const options of [{ channel: env.LINE_CHANNEL_ID }, { expires: 30 }, { scope: "openid" }, { scope: "profile-like" }]) {
    const calls = mockLine(options);
    const { response, cookie } = await miniLogin();
    assert.equal(response.status, 401);
    assert.equal(cookie, "");
    assert.deepEqual(calls, ["/oauth2/v2.1/verify"]);
  }
});

test("non-friends remain blocked and a provider outage does not grant access", async () => {
  mockLine({ friend: false });
  const { response, cookie } = await miniLogin();
  assert.equal(response.status, 403);
  assert.equal((await readLineAccess(req("/api/share/ABC12345?line_context=mini", cookie), env)).state, "friend_required");
  mockLine({ networkFail: true });
  const failed = await miniLogin();
  assert.equal(failed.response.status, 503);
  assert.equal(failed.cookie, "");
});

test("mini login rejects cross-origin and malformed input before calling LINE", async () => {
  const calls = mockLine();
  const crossOrigin = await handleLineRequest(req("/api/line/mini/session", "", { accessToken: "mini-test-token" }, "https://evil.example"), env);
  assert.equal(crossOrigin?.status, 403);
  for (const body of [{ userId: "fake" }, { accessToken: 123 }, { accessToken: "x".repeat(2100) }]) {
    const response = await handleLineRequest(req("/api/line/mini/session", "", body), env);
    assert.equal(response?.status, 400);
  }
  assert.equal(calls.length, 0);
});

test("viewer identity is server-derived, pseudonymous and shared across same-provider channels", async () => {
  const calls = mockLine();
  const web = await webLogin();
  const webViewer = await readLineViewer(req("/api/line/recent", web), env);
  const mini = await miniLogin();
  const miniViewer = await readLineViewer(req("/api/line/recent?line_context=mini", mini.cookie), env);
  assert.match(webViewer.viewerKey!, /^[a-f0-9]{64}$/);
  assert.equal(webViewer.viewerKey, miniViewer.viewerKey);
  assert.ok(!JSON.stringify(webViewer).includes("must-not-store"));
  assert.ok(!JSON.stringify(webViewer).includes(`U${"a".repeat(32)}`));
  const before = calls.length;
  const cached = await readLineViewer(req("/api/line/recent", webViewer.access.cookie!.split(";")[0]), env);
  assert.equal(cached.viewerKey, webViewer.viewerKey);
  assert.equal(calls.length, before);
});

test("history identity cannot be fetched without friendship or from an invalid LINE profile", async () => {
  const calls = mockLine({ friend: false });
  const mini = await miniLogin();
  const denied = await readLineViewer(req("/api/line/recent?line_context=mini", mini.cookie), env);
  assert.equal(denied.viewerKey, null);
  assert.ok(!calls.includes("/v2/profile"));
  mockLine({ profileId: "client-supplied-fake-id" });
  const allowed = await miniLogin();
  const invalid = await readLineViewer(req("/api/line/recent?line_context=mini", allowed.cookie), env);
  assert.equal(invalid.viewerKey, null);
  assert.equal(invalid.access.state, "unavailable");
});

test("mini logout clears only its own session and does not log the web account out", async () => {
  mockLine();
  const web = await webLogin();
  const mini = await miniLogin();
  const response = await handleLineRequest(req("/api/line/logout?line_context=mini", `${web}; ${mini.cookie}`, {}), env);
  assert.equal(response?.status, 204);
  const cleared = response!.headers.getSetCookie();
  assert.equal(cleared.length, 1);
  assert.match(cleared[0], /^__Host-pickleball_line_mini_session=;.*Max-Age=0/);
  assert.equal((await readLineAccess(req("/api/share/ABC12345", web), env)).state, "allowed");
});

test("mini login stops reading oversized streamed bodies before consuming the full stream", async () => {
  const calls = mockLine();
  let read = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { read++; if (read <= 64) controller.enqueue(new Uint8Array(1024)); else controller.close(); } });
  const request = new Request(origin + "/api/line/mini/session", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  const response = await handleLineRequest(request, env);
  assert.equal(response?.status, 413);
  assert.ok(read < 64);
  assert.equal(calls.length, 0);
});

test("external mini reconnect clears a stale SDK token; in-client reconnect re-enters the LINE URL", () => {
  const source = readFileSync(new URL("../app/components/LineMiniAppProvider.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("liff.logout();"));
  assert.ok(source.includes("liff.login({ redirectUri:"));
  assert.ok(source.includes("https://miniapp.line.me/${liffId.current}${path}"));
  assert.ok(!source.includes("Tokens stay out of storage"));
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { handleLineRequest } from "../app/lib/line-access.ts";
import { guardLineServiceRead, handleLineServiceRequest } from "../app/lib/line-service.ts";
import { cleanupServiceStore, deliverLineService, handleServiceRoom, serviceConfig, type ServiceStore } from "../app/lib/line-service-delivery.ts";

const base = {
  LINE_ACCESS_REQUIRED: "true", LINE_CHANNEL_ID: "1111111111", LINE_CHANNEL_SECRET: "web-secret",
  LINE_SESSION_SECRET: "a-session-secret-at-least-thirty-two-characters", LINE_CALLBACK_URL: "https://app.example/api/line/callback",
  LINE_OFFICIAL_ACCOUNT_ID: "@892ixgpm", LINE_MINIAPP_CHANNEL_ID: "2222222222", LINE_MINIAPP_LIFF_ID: "2222222222-abcdef",
  LINE_SERVICE_MESSAGES_REQUIRED: "true", LINE_MINIAPP_CHANNEL_SECRET: "mini-private-secret",
  LINE_SERVICE_TEMPLATE_NAME: "test_notice_ja", LINE_SERVICE_TEMPLATE_PARAMS: JSON.stringify({ btn1_url: "{{shareUrl}}", detail: "{{title}}" })
};

class MemoryStore {
  values = new Map<string, unknown>();
  alarm = 0;
  async get<T>(key: string) { return structuredClone(this.values.get(key)) as T | undefined; }
  async put(key: string, value: unknown) { this.values.set(key, structuredClone(value)); }
  async list<T>() { return structuredClone(this.values) as Map<string, T>; }
  async delete(keys: string[]) { for (const key of keys) this.values.delete(key); }
  async setAlarm(time: number) { this.alarm = time; }
}

function fixture(t: test.TestContext) {
  const original = globalThis.fetch;
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const controls = { friend: true, failure: "", final: false, reply: "" };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(init?.redirect, "manual", "credentials must never follow redirects");
    const body = init?.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path: url.pathname, body });
    if (controls.failure === url.pathname) throw new Error("provider failure with secret-user-token");
    if (url.pathname === "/oauth2/v2.1/verify") return Response.json({ client_id: base.LINE_MINIAPP_CHANNEL_ID, scope: "profile openid", expires_in: 3600 });
    if (url.pathname === "/friendship/v1/status") return Response.json({ friendFlag: controls.friend });
    if (url.pathname === "/v2/profile") {
      const token = new Headers(init?.headers).get("Authorization") ?? "";
      return Response.json({ userId: `U${(token.includes("other-user") ? "b" : "a").repeat(32)}` });
    }
    if (url.pathname === "/oauth2/v3/token") return Response.json({ access_token: "private-channel-token", token_type: "Bearer", expires_in: 900 });
    if (url.pathname === "/message/v3/notifier/token") return Response.json({ notificationToken: "private-notification-token", remainingCount: 5, expiresIn: 86400, sessionId: "session" });
    if (url.pathname === "/message/v3/notifier/send") {
      if (controls.reply === "redirect") return new Response(null, { status: 302, headers: { Location: "https://evil.example" } });
      if (controls.reply === "rejected") return Response.json({ secret: "private-provider-error" }, { status: 403 });
      if (controls.reply === "invalid") return Response.json({ accepted: true });
      return Response.json({ notificationToken: controls.final ? "" : "rotated-notification-token", remainingCount: controls.final ? 0 : 4, expiresIn: controls.final ? 0 : 86400 });
    }
    throw new Error(`Unexpected mocked endpoint ${url.pathname}`);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  const stores = new Map<string, MemoryStore>();
  const queues = new Map<string, Promise<unknown>>();
  const records = new Map([ ["SHARE01", JSON.stringify({ t: "練習会", n: ["非公開の参加者"] })], ["SHARE02", "{}"] ]);
  const env = { ...base,
    DB: { prepare: () => ({ bind: (id: string) => ({ first: async () => records.has(id) ? { payload: records.get(id) } : null }) }) },
    SCHEDULE_ROOMS: { getByName: (name: string) => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const store = stores.get(name) ?? new MemoryStore();
      stores.set(name, store);
      const result = (queues.get(name) ?? Promise.resolve()).then(() => handleServiceRoom(new Request(input, init), store, env as unknown as Env));
      queues.set(name, result.catch(() => null));
      return result;
    } }) }
  } as unknown as Env;
  const req = (path: string, cookie = "", method = "GET", body?: string, origin = "https://app.example") => new Request(`https://app.example${path}`, {
    method, headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body })
  });
  async function login(token = "private-user-token") {
    const response = await handleLineRequest(req("/api/line/mini/session", "", "POST", JSON.stringify({ accessToken: token })), env);
    assert.equal(response?.status, 200);
    return response!.headers.get("set-cookie")!.split(";")[0];
  }
  const endpoint = "/api/line/service/SHARE01?line_context=mini";
  return { env, calls, controls, stores, records, req, login, endpoint };
}

test("service delivery is off by default; required mode fails closed without approved configuration", async t => {
  const f = fixture(t);
  assert.equal(serviceConfig({ ...base, LINE_SERVICE_TEMPLATE_NAME: "" }), null);
  assert.equal(serviceConfig({ ...base, LINE_SERVICE_TEMPLATE_PARAMS: "{}" }), null);
  const off = { ...f.env, LINE_SERVICE_MESSAGES_REQUIRED: "false" };
  assert.deepEqual(await (await handleLineServiceRequest(f.req(f.endpoint), off))!.json(), { notice: "disabled" });
  assert.equal(await guardLineServiceRead(f.req("/api/share/SHARE01"), off), null);
  assert.equal(f.calls.length, 0);
  const cookie = await f.login();
  const missing = { ...f.env, LINE_MINIAPP_CHANNEL_SECRET: undefined };
  assert.equal((await handleLineServiceRequest(f.req(f.endpoint, cookie), missing))?.status, 503);
  assert.equal((await guardLineServiceRead(f.req("/api/share/SHARE01?line_context=mini", cookie), missing))?.status, 503);
});

test("only verified mini friends can request delivery, and caller identity/recipient/URL inputs are rejected", async t => {
  const f = fixture(t);
  assert.equal((await handleLineServiceRequest(f.req(f.endpoint), f.env))?.status, 401);
  const web = await handleLineServiceRequest(f.req("/api/line/service/SHARE01"), f.env);
  assert.equal(web?.status, 409);
  assert.equal((await web!.json() as { miniUrl: string }).miniUrl, "https://miniapp.line.me/2222222222-abcdef/s/SHARE01");
  const cookie = await f.login();
  for (const body of ['{"userId":"Ufake"}', '{"shareUrl":"https://evil.example"}', '{"accessToken":"injected"}', '{"retry":false}', 'null']) {
    assert.equal((await handleLineServiceRequest(f.req(f.endpoint, cookie, "POST", body), f.env))?.status, 400);
  }
  assert.equal((await handleLineServiceRequest(f.req(f.endpoint, cookie, "POST", "{}", "https://evil.example"), f.env))?.status, 403);
  assert.equal((await handleLineServiceRequest(f.req(f.endpoint, cookie, "POST", JSON.stringify({ junk: "x".repeat(2000) })), f.env))?.status, 413);
  f.controls.friend = false;
  assert.equal((await handleLineServiceRequest(f.req(f.endpoint, cookie, "POST", "{}"), f.env))?.status, 403);
  assert.equal(f.calls.filter(call => call.path.includes("notifier")).length, 0);
});

test("read and realtime gates open only after successful service delivery, without exposing private tokens", async t => {
  const f = fixture(t);
  const cookie = await f.login();
  for (const path of ["/api/share/SHARE01", "/api/realtime/SHARE01", "/api/share/%53HARE01/", "/api//share/SHARE01"]) {
    assert.equal((await guardLineServiceRead(f.req(`${path}?line_context=mini`, cookie), f.env))?.status, 403);
  }
  const sent = await handleLineServiceRequest(f.req(f.endpoint, cookie, "POST", "{}"), f.env);
  assert.equal(sent?.status, 200);
  assert.deepEqual(await sent!.json(), { notice: "accepted" });
  assert.equal(sent!.headers.get("cache-control"), "private, no-store");
  assert.equal(await guardLineServiceRead(f.req("/api/share/SHARE01?line_context=mini", cookie), f.env), null);
  assert.equal(await guardLineServiceRead(f.req("/api/realtime/SHARE01?line_context=mini", cookie), f.env), null);
  const send = f.calls.find(call => call.path.endsWith("notifier/send"))!;
  assert.deepEqual(send.body, { templateName: "test_notice_ja", notificationToken: "private-notification-token", params: { btn1_url: "https://miniapp.line.me/2222222222-abcdef/s/SHARE01", detail: "練習会" } });
  const persisted = JSON.stringify([...f.stores.values()].flatMap(store => [...store.values]));
  for (const secret of ["private-user-token", "private-notification-token", "rotated-notification-token", "private-channel-token", "非公開の参加者"]) assert.ok(!persisted.includes(secret));
});

test("concurrent opens and revisits send once per viewer/share; a LIFF token issues only one notification token", async t => {
  const f = fixture(t);
  const cookie = await f.login();
  const results = await Promise.all(Array.from({ length: 5 }, () => handleLineServiceRequest(f.req(f.endpoint, cookie, "POST", "{}"), f.env)));
  assert.ok(results.every(result => result?.status === 200));
  assert.equal(f.calls.filter(call => call.path.endsWith("notifier/token")).length, 1);
  assert.equal(f.calls.filter(call => call.path.endsWith("notifier/send")).length, 1);
  await handleLineServiceRequest(f.req(f.endpoint.replace("SHARE01", "SHARE02"), cookie, "POST", "{}"), f.env);
  assert.equal(f.calls.filter(call => call.path.endsWith("notifier/token")).length, 1);
  assert.equal(f.calls.filter(call => call.path.endsWith("notifier/send")).length, 2);
  const other = await f.login("other-user-token");
  assert.equal((await guardLineServiceRead(f.req("/api/share/SHARE01?line_context=mini", other), f.env))?.status, 403);
});

test("send timeout never grants access or automatically retries; explicit retry requires a fresh LINE session", async t => {
  const f = fixture(t);
  const cookie = await f.login();
  f.controls.failure = "/message/v3/notifier/send";
  assert.equal((await handleLineServiceRequest(f.req(f.endpoint, cookie, "POST", "{}"), f.env))?.status, 503);
  assert.equal((await guardLineServiceRead(f.req("/api/share/SHARE01?line_context=mini", cookie), f.env))?.status, 403);
  f.controls.failure = "";
  await handleLineServiceRequest(f.req(f.endpoint, cookie, "POST", '{"retry":true}'), f.env);
  assert.equal(f.calls.filter(call => call.path.endsWith("notifier/send")).length, 1);
  const fresh = await f.login("fresh-private-user-token");
  await handleLineServiceRequest(f.req(f.endpoint, fresh, "POST", "{}"), f.env);
  assert.equal(f.calls.filter(call => call.path.endsWith("notifier/send")).length, 1);
  assert.equal((await handleLineServiceRequest(f.req(f.endpoint, fresh, "POST", '{"retry":true}'), f.env))?.status, 200);
  assert.equal(f.calls.filter(call => call.path.endsWith("notifier/send")).length, 2);
});

test("an ambiguous token-issue failure is not repeated for the same LIFF token", async t => {
  const f = fixture(t);
  const cookie = await f.login();
  f.controls.failure = "/message/v3/notifier/token";
  await handleLineServiceRequest(f.req(f.endpoint, cookie, "POST", "{}"), f.env);
  f.controls.failure = "";
  await handleLineServiceRequest(f.req(f.endpoint, cookie, "POST", '{"retry":true}'), f.env);
  assert.equal(f.calls.filter(call => call.path.endsWith("notifier/token")).length, 1);
  assert.equal(f.calls.filter(call => call.path.endsWith("notifier/send")).length, 0);
});

test("a successful last message with zero remaining/expiry opens the table but cannot re-mint for a new share", async t => {
  const f = fixture(t);
  const cookie = await f.login();
  f.controls.final = true;
  assert.equal((await handleLineServiceRequest(f.req(f.endpoint, cookie, "POST", "{}"), f.env))?.status, 200);
  const next = await handleLineServiceRequest(f.req(f.endpoint.replace("SHARE01", "SHARE02"), cookie, "POST", "{}"), f.env);
  assert.deepEqual(await next!.json(), { notice: "session_limit" });
  assert.equal(f.calls.filter(call => call.path.endsWith("notifier/token")).length, 1);
});

test("LINE refusal, redirects and malformed success responses never grant access or reveal provider errors", async t => {
  const f = fixture(t);
  for (const mode of ["redirect", "rejected", "invalid"]) {
    const id = `BAD${mode.slice(0, 3).toUpperCase()}`;
    f.records.set(id, "{}");
    f.controls.reply = mode;
    const cookie = await f.login(`token-${mode}`);
    const result = await handleLineServiceRequest(f.req(f.endpoint.replace("SHARE01", id), cookie, "POST", "{}"), f.env);
    assert.equal(result?.status, 503);
    const body = await result!.text();
    assert.ok(!body.includes("private-provider-error"));
    assert.ok(!body.includes("token-"));
    assert.equal((await guardLineServiceRead(f.req(`/api/share/${id}?line_context=mini`, cookie), f.env))?.status, 403);
  }
});

test("expired notification tokens cannot be reissued for the same LIFF token, and expired sessions cannot use accepted receipts", async t => {
  const f = fixture(t);
  const cookie = await f.login();
  await handleLineServiceRequest(f.req(f.endpoint, cookie, "POST", "{}"), f.env);
  const store = [...f.stores.values()][0];
  for (const [key, value] of store.values) {
    if (key.startsWith("token:")) await store.put(key, { ...(value as object), notificationExpires: Date.now() - 1 });
  }
  const next = await handleLineServiceRequest(f.req(f.endpoint.replace("SHARE01", "SHARE02"), cookie, "POST", "{}"), f.env);
  assert.deepEqual(await next!.json(), { notice: "session_limit" });
  assert.equal(f.calls.filter(call => call.path.endsWith("notifier/token")).length, 1);
  const original = Date.now;
  try {
    const future = original() + 3601_000;
    Date.now = () => future;
    assert.equal((await guardLineServiceRead(f.req("/api/share/SHARE01?line_context=mini", cookie), f.env))?.status, 401);
  } finally { Date.now = original; }
});

test("missing schedules never send; retained state expires and is removed by alarms", async t => {
  const f = fixture(t);
  const cookie = await f.login();
  assert.equal((await handleLineServiceRequest(f.req(f.endpoint.replace("SHARE01", "MISSING"), cookie, "POST", "{}"), f.env))?.status, 404);
  assert.equal(f.calls.filter(call => call.path.includes("notifier")).length, 0);
  const store = new MemoryStore();
  await store.put("receipt:expired", { state: "accepted", expires: Date.now() - 1, accessKey: "x" });
  const future = Date.now() + 10000;
  await store.put("token:live", { state: "uncertain", remaining: 0, expires: future });
  await cleanupServiceStore(store as ServiceStore);
  assert.equal(store.values.size, 1);
  assert.equal(store.alarm, future);
  assert.equal(await deliverLineService(store as ServiceStore, base, { shareId: "SHARE01" }), "required");
});

test("protected APIs, websocket and client viewer all use the prerequisite; existing configuration stays off", () => {
  const worker = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
  assert.ok(worker.indexOf("await guardLineServiceRead") < worker.indexOf("const realtimeMatch"));
  assert.ok(worker.indexOf("await guardLineServiceRead") < worker.indexOf("await vinextHandler.fetch"));
  assert.match(worker, /this\.ctx\.blockConcurrencyWhile/);
  const viewer = readFileSync(new URL("../app/s/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(viewer, /<LineServiceGate[^>]*><SharedScheduleViewer/);
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /"LINE_SERVICE_MESSAGES_REQUIRED": "false"/);
  assert.ok(!config.includes("LINE_MINIAPP_CHANNEL_SECRET"));
});

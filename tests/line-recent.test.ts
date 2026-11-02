import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test, type TestContext } from "node:test";
import { handleLineRequest } from "../app/lib/line-access.ts";
import { cleanupLineHistory, handleLineRecentRequest, type LineRecentEnvironment } from "../app/lib/line-recent.ts";

type SQLiteStatement = {
  all(...values: unknown[]): Record<string, unknown>[];
  run(...values: unknown[]): { changes: number | bigint };
};
type SQLiteDatabase = { exec(sql: string): void; prepare(sql: string): SQLiteStatement; close(): void };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (filename: string) => SQLiteDatabase;
};

// Execute the production SQL against SQLite, including real FK and transaction behavior.
class SQLiteD1 {
  sqlite = new DatabaseSync(":memory:");
  queries: string[] = [];
  failBatchAt: number | null = null;
  failRead = false;
  failRun = false;

  prepare(sql: string) { return new Statement(this, sql); }
  async batch(statements: Statement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement, index) => {
        if (this.failBatchAt === index) throw new Error("secret SQL database failure");
        return statement.execute();
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

class Statement {
  readonly db: SQLiteD1;
  readonly sql: string;
  readonly values: unknown[];
  constructor(db: SQLiteD1, sql: string, values: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.values = values;
  }
  bind(...values: unknown[]) { return new Statement(this.db, this.sql, values); }
  execute() {
    this.db.queries.push(this.sql);
    if (this.db.failRun) throw new Error("secret SQL database failure");
    const result = this.db.sqlite.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  async run() { return this.execute(); }
  async all() {
    this.db.queries.push(this.sql);
    if (this.db.failRead) throw new Error("secret SQL database failure");
    return { success: true, results: this.db.sqlite.prepare(this.sql).all(...this.values), meta: { changes: 0 } };
  }
}

const origin = "https://pickleball.example";
const alice = "a".repeat(64);
const bob = "b".repeat(64);
const day = 24 * 60 * 60 * 1000;
const lineEnv = {
  LINE_ACCESS_REQUIRED: "true", LINE_CHANNEL_ID: "1234567890",
  LINE_CHANNEL_SECRET: "test-channel-secret", LINE_SESSION_SECRET: "test-session-secret-at-least-32-characters",
  LINE_OFFICIAL_ACCOUNT_ID: "@892ixgpm", LINE_CALLBACK_URL: `${origin}/api/line/callback`
};
const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("Unexpected provider fetch"); };
});
afterEach(() => { globalThis.fetch = originalFetch; });

function fixture(t: TestContext) {
  const db = new SQLiteD1();
  t.after(() => db.sqlite.close());
  for (const migration of ["0001_initial.sql", "0002_line_view_history.sql"]) {
    db.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
  return { db, env: { ...lineEnv, DB: db as unknown as D1Database } satisfies LineRecentEnvironment };
}

function addShare(db: SQLiteD1, id: string, payload: unknown = { t: `Title ${id}`, n: ["PRIVATE PARTICIPANT"], m: [] }) {
  db.sqlite.prepare(`INSERT INTO pickleball_shared_schedules (id, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?)`).run(id, JSON.stringify(payload), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
}

function addHistory(db: SQLiteD1, viewer: string, id: string, viewedAt = new Date().toISOString()) {
  db.sqlite.prepare("INSERT INTO pickleball_line_view_history (viewer_key, share_id, viewed_at) VALUES (?, ?, ?)")
    .run(viewer, id, viewedAt);
}

function rows(db: SQLiteD1) {
  return db.sqlite.prepare("SELECT viewer_key, share_id, viewed_at FROM pickleball_line_view_history ORDER BY viewer_key, share_id").all();
}

async function session(viewerKey = alice, overrides: Record<string, unknown> = {}) {
  const encoder = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const payload = { accessToken: "test-token-never-sent", expires: now + 3600, friend: true, checked: now, viewerKey, ...overrides };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", encoder.encode(lineEnv.LINE_SESSION_SECRET)), "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({
    name: "AES-GCM", iv,
    additionalData: encoder.encode(`session:${lineEnv.LINE_CHANNEL_ID}:${lineEnv.LINE_OFFICIAL_ACCOUNT_ID}:${lineEnv.LINE_CALLBACK_URL}`)
  }, key, encoder.encode(JSON.stringify(payload)));
  return `__Host-pickleball_line_session=${Buffer.from(iv).toString("base64url")}.${Buffer.from(encrypted).toString("base64url")}`;
}

function request(cookie: string, method = "GET", body?: string, headers: Record<string, string> = {}, path = "/api/line/recent") {
  return new Request(`${origin}${path}`, {
    method, headers: { cookie, origin, "content-type": "application/json", ...headers }, body
  });
}

function privateResponse(response: Response | null, status: number) {
  assert.ok(response);
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  return response;
}

type Item = { id: string; title: string; viewedAt: string; createdAt: string };
async function items(cookie: string, env: LineRecentEnvironment): Promise<Item[]> {
  const response = privateResponse(await handleLineRecentRequest(request(cookie), env), 200);
  const body = await response.json() as { items: Item[] };
  assert.deepEqual(Object.keys(body), ["items"]);
  for (const item of body.items) assert.deepEqual(Object.keys(item).sort(), ["createdAt", "id", "title", "viewedAt"]);
  return body.items;
}

test("only the exact recent endpoint and GET/POST/DELETE are handled", async t => {
  const { db, env } = fixture(t);
  for (const path of ["/api/line/recent/", "/api/line/recently", "/api/line/status", "/api/line/%72ecent"]) {
    assert.equal(await handleLineRecentRequest(request("", "GET", undefined, {}, path), env), null);
  }
  for (const method of ["HEAD", "OPTIONS", "PUT", "PATCH"]) {
    assert.equal(await handleLineRecentRequest(request("", method), env), null);
  }
  assert.equal(db.queries.length, 0);
});

test("verified viewers are isolated; DELETE removes only their history, never schedules", async t => {
  const { db, env } = fixture(t);
  addShare(db, "SHARE01");
  addShare(db, "SHARE02");
  const a = await session(alice);
  const b = await session(bob);
  privateResponse(await handleLineRecentRequest(request(a, "POST", '{"id":"SHARE01"}'), env), 204);
  privateResponse(await handleLineRecentRequest(request(b, "POST", '{"id":"SHARE02"}'), env), 204);
  assert.deepEqual((await items(a, env)).map(item => item.id), ["SHARE01"]);
  assert.deepEqual((await items(b, env)).map(item => item.id), ["SHARE02"]);
  privateResponse(await handleLineRecentRequest(request(a, "DELETE", "{}"), env), 204);
  assert.deepEqual(await items(a, env), []);
  assert.deepEqual((await items(b, env)).map(item => item.id), ["SHARE02"]);
  assert.equal(db.sqlite.prepare("SELECT id FROM pickleball_shared_schedules").all().length, 2);
  privateResponse(await handleLineRecentRequest(request(b, "DELETE"), env), 204);
  assert.equal(rows(db).length, 0);
});

test("POST caps each viewer at ten, and revisits move to the top without duplication", async t => {
  const { db, env } = fixture(t);
  const a = await session();
  for (let index = 0; index < 12; index++) addShare(db, `SHARE${String(index).padStart(2, "0")}`);
  addHistory(db, bob, "SHARE00");
  for (let index = 0; index < 10; index++) {
    addHistory(db, alice, `SHARE${String(index).padStart(2, "0")}`, new Date(Date.now() - (20 - index) * day).toISOString());
  }
  privateResponse(await handleLineRecentRequest(request(a, "POST", '{"id":"SHARE10"}'), env), 204);
  assert.equal((await items(a, env)).length, 10);
  assert.ok(!(await items(a, env)).some(item => item.id === "SHARE00"));
  privateResponse(await handleLineRecentRequest(request(a, "POST", '{"id":"SHARE01"}'), env), 204);
  const recent = await items(a, env);
  assert.equal(recent.length, 10);
  assert.equal(recent[0].id, "SHARE01");
  assert.equal(rows(db).filter(row => row.viewer_key === alice && row.share_id === "SHARE01").length, 1);
  assert.equal(rows(db).filter(row => row.viewer_key === bob).length, 1);
  privateResponse(await handleLineRecentRequest(request(a, "POST", '{"id":"SHARE11"}'), env), 204);
  assert.equal((await items(a, env)).length, 10);
});

test("only existing shares can be recorded and schedule deletion cascades for all viewers", async t => {
  const { db, env } = fixture(t);
  const a = await session();
  privateResponse(await handleLineRecentRequest(request(a, "POST", '{"id":"MISSING1"}'), env), 404);
  assert.deepEqual(rows(db), []);
  addShare(db, "SHARE01");
  addHistory(db, alice, "SHARE01");
  addHistory(db, bob, "SHARE01");
  db.sqlite.prepare("DELETE FROM pickleball_shared_schedules WHERE id = ?").run("SHARE01");
  assert.deepEqual(rows(db), []);
  assert.deepEqual(await items(a, env), []);
  assert.throws(() => addHistory(db, alice, "MISSING1"), /FOREIGN KEY/);
});

test("GET filters ninety-day history; POST prunes only its viewer and scheduled cleanup prunes globally", async t => {
  const { db, env } = fixture(t);
  const a = await session();
  for (const id of ["EXPIRED1", "EXPIRED2", "CURRENT1", "CURRENT2", "NEWVIEW1"]) addShare(db, id);
  const expired = new Date(Date.now() - 90 * day - 1000).toISOString();
  const active = new Date(Date.now() - 90 * day + 60_000).toISOString();
  addHistory(db, alice, "EXPIRED1", expired);
  addHistory(db, bob, "EXPIRED2", expired);
  addHistory(db, alice, "CURRENT1", active);
  addHistory(db, bob, "CURRENT2", active);
  assert.deepEqual((await items(a, env)).map(item => item.id), ["CURRENT1"]);
  assert.equal(rows(db).length, 4, "GET is read-only");
  privateResponse(await handleLineRecentRequest(request(a, "POST", '{"id":"NEWVIEW1"}'), env), 204);
  assert.ok(!rows(db).some(row => row.share_id === "EXPIRED1"));
  assert.ok(rows(db).some(row => row.share_id === "EXPIRED2"));
  await cleanupLineHistory(env.DB);
  assert.deepEqual(rows(db).map(row => row.share_id), ["CURRENT1", "NEWVIEW1", "CURRENT2"]);
  assert.equal(db.sqlite.prepare("SELECT id FROM pickleball_shared_schedules").all().length, 5);
});

test("GET projects only safe current titles from compact/full JSON and tolerates malformed payloads", async t => {
  const { db, env } = fixture(t);
  const values: [string, unknown, string][] = [
    ["TITLE01", { t: "Compact", title: "Full", n: ["SECRET"] }, "Compact"],
    ["TITLE02", { title: " Full title ", names: ["SECRET"] }, "Full title"],
    ["TITLE03", { t: {}, title: "Fallback" }, "Fallback"],
    ["TITLE04", { t: " ", title: "Fallback" }, "Fallback"],
    ["TITLE05", { t: ["SECRET"], title: 42, names: ["SECRET"] }, "\u4e71\u6570\u8868"],
    ["TITLE06", { t: "x".repeat(100) }, "x".repeat(60)],
    ["TITLE07", { t: "Control\n\ttitle" }, "Controltitle"],
    ["TITLE08", null, "\u4e71\u6570\u8868"],
    ["TITLE09", { t: "Nul\u0000suffix" }, "Nul"]
  ];
  for (const [id, payload] of values) { addShare(db, id, payload); addHistory(db, alice, id); }
  addShare(db, "BROKEN01");
  db.sqlite.prepare("UPDATE pickleball_shared_schedules SET payload = ? WHERE id = ?").run("{bad json", "BROKEN01");
  addHistory(db, alice, "BROKEN01");
  const a = await session();
  const recent = await items(a, env);
  for (const [id, , title] of values) {
    assert.equal(recent.find(item => item.id === id)?.title, title);
    assert.equal(recent.find(item => item.id === id)?.createdAt, "2026-01-01T00:00:00.000Z");
  }
  assert.equal(recent.find(item => item.id === "BROKEN01")?.title, "\u4e71\u6570\u8868");
  assert.ok(!JSON.stringify(recent).includes("SECRET"));
  db.sqlite.prepare("UPDATE pickleball_shared_schedules SET payload = ? WHERE id = ?").run('{"title":"Renamed"}', "TITLE01");
  assert.equal((await items(a, env)).find(item => item.id === "TITLE01")?.title, "Renamed");
  assert.deepEqual(db.sqlite.prepare("PRAGMA table_info(pickleball_line_view_history)").all().map(column => column.name), ["viewer_key", "share_id", "viewed_at"]);
});

test("missing, expired, tampered and blocked sessions cannot read or mutate history even when access gate is disabled", async t => {
  const { db, env } = fixture(t);
  addShare(db, "SHARE01");
  addHistory(db, alice, "SHARE01");
  const valid = await session();
  const cases: [string, number][] = [
    ["", 401], [valid + "tampered", 401],
    [await session(alice, { expires: 1 }), 401], [await session(alice, { friend: false }), 403]
  ];
  for (const [cookie, status] of cases) {
    for (const method of ["GET", "POST", "DELETE"]) {
      privateResponse(await handleLineRecentRequest(request(cookie, method, method === "POST" ? '{"id":"SHARE01"}' : method === "DELETE" ? "{}" : undefined), { ...env, LINE_ACCESS_REQUIRED: "false" }), status);
    }
  }
  privateResponse(await handleLineRecentRequest(request(""), { DB: env.DB }), 503);
  assert.equal(db.queries.length, 0);
  assert.equal(rows(db).length, 1);
});

test("mutations require same-origin JSON, reject extra identity fields and bound the body", async t => {
  const { db, env } = fixture(t);
  addShare(db, "SHARE01");
  const a = await session();
  for (const method of ["POST", "DELETE"]) {
    const body = method === "POST" ? '{"id":"SHARE01"}' : "{}";
    for (const badOrigin of ["https://attacker.example", "null", ""]) {
      privateResponse(await handleLineRecentRequest(request(a, method, body, { origin: badOrigin }), env), 403);
    }
    for (const type of ["text/plain", "application/jsonp", ""]) {
      privateResponse(await handleLineRecentRequest(request(a, method, body, { "content-type": type }), env), 415);
    }
    privateResponse(await handleLineRecentRequest(request(a, method, body, { "content-length": "1025" }), env), 413);
    privateResponse(await handleLineRecentRequest(request(a, method, `"${"x".repeat(1024)}"`), env), 413);
    privateResponse(await handleLineRecentRequest(request(a, method, "{bad"), env), 400);
    privateResponse(await handleLineRecentRequest(request(a, method, '{"userId":"victim"}'), env), 400);
  }
  for (const body of ["null", "[]", "{}", "", '{"id":7}', '{"id":"abc12"}', '{"id":"a23456789012345678901"}', '{"id":"abc/123"}', '{"id":"SHARE01","viewerKey":"victim"}', '{"id":"SHARE01","userId":"victim"}', '{"id":"SHARE01","title":"snapshot"}', '{"id":["SHARE01","SHARE02"]}']) {
    privateResponse(await handleLineRecentRequest(request(a, "POST", body), env), 400);
  }
  assert.equal(db.queries.length, 0);
  privateResponse(await handleLineRecentRequest(request(a, "POST", '{"id":"SHARE01"}', { "content-type": "Application/JSON; charset=utf-8" }), env), 204);
});

test("streamed bodies are bounded without trusting content-length", async t => {
  const { db, env } = fixture(t);
  const a = await session();
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(600))); },
    cancel() { canceled = true; }
  });
  const streamed = new Request(`${origin}/api/line/recent`, {
    method: "POST", headers: { cookie: a, origin, "content-type": "application/json" }, body, duplex: "half"
  } as RequestInit & { duplex: string });
  privateResponse(await handleLineRecentRequest(streamed, env), 413);
  assert.ok(canceled);
  assert.equal(db.queries.length, 0);
});

test("write and prune are atomic, and database errors are generic private 503 responses", async t => {
  const { db, env } = fixture(t);
  addShare(db, "SHARE01");
  const a = await session();
  db.failBatchAt = 1;
  const response = privateResponse(await handleLineRecentRequest(request(a, "POST", '{"id":"SHARE01"}'), env), 503);
  assert.deepEqual(await response.json(), { error: "Recent history unavailable" });
  assert.deepEqual(rows(db), [], "insert rolls back when pruning fails");
  db.failRead = true;
  privateResponse(await handleLineRecentRequest(request(a), env), 503);
  db.failRun = true;
  privateResponse(await handleLineRecentRequest(request(a, "DELETE", "{}"), env), 503);
  await assert.rejects(cleanupLineHistory(env.DB), /secret SQL database failure/);
});

test("refreshed access cookies survive success, validation/origin failure, denial and database failure", async t => {
  const { db, env } = fixture(t);
  const stale = await session(alice, { checked: Math.floor(Date.now() / 1000) - 301 });
  let friend = true;
  let expired = false;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), "https://api.line.me/friendship/v1/status");
    assert.equal(init?.redirect, "manual");
    return expired ? new Response(null, { status: 401 }) : Response.json({ friendFlag: friend });
  };
  const scenarios: [Request, number][] = [
    [request(stale), 200],
    [request(stale, "POST", "{}"), 400],
    [request(stale, "DELETE", "{}", { origin: "https://attacker.example" }), 403],
    [request(stale, "POST", "{}", { "content-type": "text/plain" }), 415]
  ];
  for (const [req, status] of scenarios) {
    const response = privateResponse(await handleLineRecentRequest(req, env), status);
    assert.equal(response.headers.getSetCookie().length, 1);
    assert.match(response.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax/);
  }
  db.failRead = true;
  assert.equal(privateResponse(await handleLineRecentRequest(request(stale), env), 503).headers.getSetCookie().length, 1);
  friend = false;
  assert.equal(privateResponse(await handleLineRecentRequest(request(stale), env), 403).headers.getSetCookie().length, 1);
  expired = true;
  assert.match(privateResponse(await handleLineRecentRequest(request(stale), env), 401).headers.get("set-cookie")!, /Max-Age=0/);
  assert.equal(calls, 7);
});

test("mocked LINE login derives hashed identity server-side, caches it and ignores client identity hints", async t => {
  const { db, env } = fixture(t);
  addShare(db, "SHARE01");
  addShare(db, "SHARE02");
  let userId = `U${"1".repeat(32)}`;
  let profileCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.line.me");
    assert.equal(init?.redirect, "manual");
    switch (url.pathname) {
      case "/oauth2/v2.1/token":
        return Response.json({ access_token: "mock-login-token", expires_in: 3600, token_type: "Bearer", scope: "profile" });
      case "/oauth2/v2.1/verify":
        return Response.json({ client_id: env.LINE_CHANNEL_ID, expires_in: 3600 });
      case "/friendship/v1/status":
        return Response.json({ friendFlag: true });
      case "/v2/profile":
        profileCalls++;
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer mock-login-token");
        return Response.json({ userId, displayName: "NEVER STORE THIS" });
      default: throw new Error(`Unexpected mock endpoint: ${url.pathname}`);
    }
  };
  async function login() {
    const start = await handleLineRequest(request("", "GET", undefined, {}, "/api/line/start?returnTo=/recent"), env);
    assert.equal(start?.status, 302);
    const state = new URL(start!.headers.get("location")!).searchParams.get("state")!;
    const flow = start!.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const callback = await handleLineRequest(request(flow, "GET", undefined, {}, `/api/line/callback?code=test-code&state=${state}`), env);
    assert.equal(callback?.status, 302);
    const cookie = callback!.headers.getSetCookie().find(value => value.startsWith("__Host-pickleball_line_session="));
    assert.ok(cookie);
    return cookie.split(";")[0];
  }
  const first = privateResponse(await handleLineRecentRequest(request(await login(), "POST", '{"id":"SHARE01"}'), env), 204);
  const cached = first.headers.getSetCookie()[0].split(";")[0];
  assert.equal(profileCalls, 1);
  userId = `U${"2".repeat(32)}`;
  privateResponse(await handleLineRecentRequest(request(await login(), "POST", '{"id":"SHARE02"}'), env), 204);
  const keys = rows(db).map(row => row.viewer_key);
  assert.equal(new Set(keys).size, 2);
  assert.ok(keys.every(key => typeof key === "string" && /^[a-f0-9]{64}$/.test(key)));
  assert.ok(!JSON.stringify(rows(db)).includes(userId));
  assert.ok(!JSON.stringify(rows(db)).includes("NEVER STORE THIS"));
  const spoofed = privateResponse(await handleLineRecentRequest(request(cached, "GET", undefined, { "x-user-id": userId }, `/api/line/recent?userId=${userId}&viewerKey=${keys[1]}`), env), 200);
  assert.deepEqual(((await spoofed.json()) as { items: Item[] }).items.map(item => item.id), ["SHARE01"]);
  assert.equal(profileCalls, 2, "cached verified identity does not call LINE profile again");
});

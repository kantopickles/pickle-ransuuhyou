import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("LINE development and review deploy the same build with isolated non-production bindings", async () => {
  const configs = await Promise.all(["dev", "review"].map(async stage =>
    JSON.parse(await readFile(new URL(`../wrangler.line-${stage}.json`, import.meta.url), "utf8"))));
  const channels = ["2012345210", "2012345211"];
  for (const [index, config] of configs.entries()) {
    assert.equal(config.main, "dist/server/index.js");
    assert.notEqual(config.name, "pickleball-randomizer");
    assert.equal(config.vars.LINE_CHANNEL_ID, channels[index]);
    assert.equal(config.vars.LINE_MINIAPP_CHANNEL_ID, channels[index]);
    assert.ok(config.vars.LINE_MINIAPP_LIFF_ID.startsWith(`${channels[index]}-`));
    assert.equal(config.vars.LINE_ACCESS_REQUIRED, "true");
    assert.equal(config.vars.LINE_SERVICE_MESSAGES_REQUIRED, "false");
    assert.equal(new URL(config.vars.LINE_CALLBACK_URL).hostname, `${config.name}.kanto-pickles-draw.workers.dev`);
    assert.equal(config.d1_databases[0].database_name, "pickleball-line-staging");
    assert.notEqual(config.d1_databases[0].database_id, "e7d30a93-51b3-4a98-926a-e34be823eebc");
    assert.ok(!JSON.stringify(config).includes("SECRET"));
    assert.equal(config.durable_objects.bindings[0].class_name, "ScheduleRoom");
    assert.equal(config.exports.ScheduleRoom.storage, "sqlite");
  }
  assert.notEqual(configs[0].name, configs[1].name);
  assert.notEqual(configs[0].vars.LINE_MINIAPP_LIFF_ID, configs[1].vars.LINE_MINIAPP_LIFF_ID);
});

test("LINE staging fixture is idempotent and contains only fictitious schedule data", async () => {
  const sql = await readFile(new URL("../fixtures/line-staging.sql", import.meta.url), "utf8");
  assert.match(sql, /ON CONFLICT\(id\) DO NOTHING/);
  assert.doesNotMatch(sql, /\b(?:DELETE|DROP|UPDATE|REPLACE)\b/i);
  const payload = JSON.parse(sql.match(/'({"title".*})'/)![1]);
  assert.equal(payload.names.length, 8);
  assert.ok(payload.names.every((name: string) => /^Sample [1-8]$/.test(name)));
  assert.equal(payload.matches.length, 5);
  for (const match of payload.matches) {
    const players = [...match.courts[0].teamA, ...match.courts[0].teamB, ...match.resting];
    assert.deepEqual([...players].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
  }
});

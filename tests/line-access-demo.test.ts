import assert from "node:assert/strict";
import test from "node:test";
import { demoReducer, INITIAL_DEMO_STATE, type DemoScenario } from "../app/demo/line-access/flow.ts";

test("デモの初期状態はログイン前で対戦表を表示しない", () => {
  assert.equal(INITIAL_DEMO_STATE.stage, "sign-in");
  assert.equal(demoReducer(INITIAL_DEMO_STATE, { type: "confirm-friend" }).stage, "sign-in");
});

test("未登録のデモ参加者はログインと友だち追加の順で対戦表へ進む", () => {
  const signedIn = demoReducer(INITIAL_DEMO_STATE, { type: "sign-in" });
  assert.equal(signedIn.stage, "friend");
  assert.equal(demoReducer(signedIn, { type: "confirm-friend" }).stage, "schedule");
});

test("友だち追加済みのデモ参加者はログイン後に直接対戦表へ進む", () => {
  const registered = demoReducer(INITIAL_DEMO_STATE, { type: "scenario", scenario: "friend" });
  assert.equal(demoReducer(registered, { type: "sign-in" }).stage, "schedule");
});

test("追加・解除をスキップするとデモの閲覧不可画面になり、再試行できる", () => {
  for (const scenario of ["new", "blocked"] as DemoScenario[]) {
    let state = demoReducer(INITIAL_DEMO_STATE, { type: "scenario", scenario });
    state = demoReducer(state, { type: "sign-in" });
    assert.equal(state.stage, "friend");
    state = demoReducer(state, { type: "skip-friend" });
    assert.equal(state.stage, "denied");
    assert.equal(demoReducer(state, { type: "sign-in" }).stage, "denied");
    assert.equal(demoReducer(state, { type: "confirm-friend" }).stage, "denied");
    state = demoReducer(state, { type: "retry" });
    assert.equal(state.stage, "friend");
    assert.equal(demoReducer(state, { type: "confirm-friend" }).stage, "schedule");
  }
});

test("デモの条件変更とやり直しでログイン前に戻る", () => {
  const ready = { scenario: "blocked", stage: "schedule" } as const;
  assert.deepEqual(demoReducer(ready, { type: "reset" }), { scenario: "blocked", stage: "sign-in" });
  assert.deepEqual(demoReducer(ready, { type: "scenario", scenario: "friend" }), { scenario: "friend", stage: "sign-in" });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lineCallbackMessage, lineRecoveryReturnTo } from "../app/lib/line-access-ui.ts";

test("successful current login or confirmed non-friend never shows a stale callback error", () => {
  for (const reason of ["session", "browser", "cancelled", "connection"]) {
    assert.equal(lineCallbackMessage(reason, "allowed"), "");
    assert.equal(lineCallbackMessage(reason, "friend_required"), "");
  }
});

test("missing browser context is explained without incorrectly claiming the login expired", () => {
  assert.match(lineCallbackMessage("browser", "login_required"), /ブラウザ/);
  assert.match(lineCallbackMessage("browser", "login_required"), /友だち登録をやり直す必要はありません/);
  assert.doesNotMatch(lineCallbackMessage("browser", "login_required"), /有効時間が切れ/);
  assert.doesNotMatch(lineCallbackMessage("session", "login_required"), /有効時間が切れ/);
  assert.match(lineCallbackMessage("cancelled", "login_required"), /キャンセル/);
  assert.equal(lineCallbackMessage(null, "login_required"), "");
});

test("legacy fallback page can return to a remembered share, but never an external URL", () => {
  assert.equal(lineRecoveryReturnTo("/line-access", "/s/ABC12345"), "/s/ABC12345");
  assert.equal(lineRecoveryReturnTo("/s/NEW12345", "/s/ABC12345"), "/s/NEW12345");
  for (const path of [null, "https://attacker.example", "//attacker.example", "/admin", "/s/ABC12345?next=bad"]) {
    assert.equal(lineRecoveryReturnTo("/line-access", path), "/line-access");
  }
});

test("gate clears callback errors using verified status and exposes recovery rather than a dead-end test result", () => {
  const source = readFileSync(new URL("../app/components/LineAccessGate.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("setError(lineCallbackMessage(reason, result.access))"));
  assert.ok(source.includes("対戦表を開く"));
  assert.ok(source.includes("このブラウザでログインし直す"));
  assert.ok(!source.includes("接続テストに成功しました"));
});

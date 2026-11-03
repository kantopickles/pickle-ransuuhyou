import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { MAX_PARTICIPANTS, MIN_PARTICIPANTS, PARTICIPANT_OPTIONS } from "../app/lib/participant-limits.ts";

test("人数の選択肢は4〜30名を欠けずに含む", () => {
  assert.equal(MIN_PARTICIPANTS, 4);
  assert.equal(MAX_PARTICIPANTS, 30);
  assert.deepEqual(PARTICIPANT_OPTIONS, Array.from({ length: 27 }, (_, index) => index + 4));
});

test("受付票の取り込み・途中参加の制限にも同じ上限を使う", () => {
  const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /importedNames\.slice\(0, MAX_PARTICIPANTS\)/);
  assert.match(source, /if \(participantCount >= MAX_PARTICIPANTS\)/);
  assert.match(source, /disabled=\{participantCount >= MAX_PARTICIPANTS\}/);
  assert.doesNotMatch(source, /最大20[名人]|先頭20名/);
});

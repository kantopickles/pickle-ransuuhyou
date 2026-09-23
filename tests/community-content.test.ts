import assert from "node:assert/strict";
import test from "node:test";
import { getPracticeLevels } from "../app/lib/community-content.ts";

test("初級・初中級の記載がある練習会は初級に分類する", () => {
  assert.deepEqual(getPracticeLevels("【初級〜初中級】3時間ピックル♪"), ["beginner"]);
  assert.deepEqual(getPracticeLevels("【🔰〜初中級】体験練習会"), ["beginner"]);
});

test("中級以上の記載がある練習会は中級に分類する", () => {
  assert.deepEqual(getPracticeLevels("【中級〜】ゲーム練習会"), ["intermediate"]);
  assert.deepEqual(getPracticeLevels("中上級向け練習会"), ["intermediate"]);
});

test("初級・中級の記載がない練習会は両方に分類する", () => {
  assert.deepEqual(getPracticeLevels("休日に3時間ピックル♪"), ["beginner", "intermediate"]);
});

test("初級と中級がそれぞれ明記されていれば両方に分類する", () => {
  assert.deepEqual(getPracticeLevels("初級・中級合同練習会"), ["beginner", "intermediate"]);
});

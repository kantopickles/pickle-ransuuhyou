import assert from "node:assert/strict";
import test from "node:test";
import {
  currentMatch, initialJumpTarget, normalizeCheckedMatches, normalizePayload, playerStatus,
  readViewerPreference, rememberParticipant, resolveParticipant, saveViewerPreference
} from "../app/s/[id]/viewer-helpers.ts";

const names = ["Alice", "Bob", "Carol", "Dan", "Eve", "Frank"];
const compact = { n: names, m: [[[0, 1, 2, 3]], [[1, 2, 3, 4]], [[0, 2, 3, 4]]], t: "Practice" };
const payload = normalizePayload(compact)!;

test("compact and full payloads normalize without mutating input; resting is derived", () => {
  assert.equal(payload.title, "Practice");
  assert.deepEqual(payload.matches[0].resting, [4, 5]);
  const full = { names, matches: [{ match: 4, courts: payload.matches[0].courts, participants: [0, 1, 2, 3, 4], resting: [0, 99] }] };
  assert.deepEqual(normalizePayload(full)?.matches[0].resting, [4]);
  assert.deepEqual(full.matches[0].resting, [0, 99]);
  assert.deepEqual(normalizePayload(payload), payload);
});

test("unknown/malformed payloads never reach stats or name rendering", () => {
  for (const value of [null, 1, "bad", {}, { names: [null], matches: [] }, { n: names, m: [null] },
    { n: names, m: [[[0, 0, 1, 2]]] }, { n: names, m: [[[0, 1, 2, 99]]] },
    { n: names, m: [[[0, 1, 2]]] }, { n: names, m: [[[0, 1, 2, "3"]]] },
    { names, matches: [{ ...payload.matches[0], participants: [0, 1] }] },
    { names, matches: [payload.matches[0], payload.matches[0]] },
    { names, matches: [{ ...payload.matches[0], courts: [payload.matches[0].courts[0], payload.matches[0].courts[0]] }] }]) {
    assert.equal(normalizePayload(value), null, JSON.stringify(value));
  }
  assert.deepEqual(normalizePayload({ names: [], matches: [] }), { names: [], matches: [] });
});

test("checked values are completed round IDs, not counts, contiguous prefixes, courts or clocks", () => {
  const checked = normalizeCheckedMatches([3, 3, 0, 20, -1, "1", null, 1.5], payload.matches);
  assert.deepEqual([...checked], [3]);
  assert.equal(currentMatch(payload.matches, checked)?.match, 1);
  checked.add(1);
  assert.equal(currentMatch(payload.matches, checked)?.match, 2);
  checked.add(2);
  assert.equal(currentMatch(payload.matches, checked), null);
  assert.equal(normalizeCheckedMatches({}, payload.matches).size, 0);
});

test("initial jump picks first incomplete or last completed; every explicit hash wins", () => {
  assert.equal(initialJumpTarget(payload.matches, new Set([1, 3]), ""), "match-2");
  assert.equal(initialJumpTarget(payload.matches, new Set([1, 2, 3]), ""), "match-3");
  assert.equal(initialJumpTarget([], new Set(), ""), null);
  for (const hash of ["#match-1", "#today-match-cards", "#schedule-summary", "#unknown"]) {
    assert.equal(initialJumpTarget(payload.matches, new Set(), hash), hash.slice(1));
  }
  assert.equal(initialJumpTarget(payload.matches, new Set(), "#match%2D2"), "match-2");
  assert.equal(initialJumpTarget(payload.matches, new Set(), "#%broken"), null);
});

test("selection survives reordering but never falls back to a different player at the old index", () => {
  const memory = rememberParticipant(names, 0);
  assert.equal(resolveParticipant(memory, [...names].reverse()), 5);
  assert.equal(resolveParticipant(memory, names.slice(1)), null);
  assert.equal(resolveParticipant(memory, ["Renamed", ...names.slice(1)]), null);
  assert.equal(resolveParticipant(memory, ["Alice", ...names]), null);
  for (const index of [null, -1, 99, NaN, 1.5]) assert.equal(rememberParticipant(names, index), null);
  assert.equal(resolveParticipant(null, names), null);
});

test("duplicate names restore only with exactly the same roster", () => {
  const roster = ["Alex", "Alex", "Bob", "Carol"];
  const memory = rememberParticipant(roster, 1);
  assert.equal(resolveParticipant(memory, roster), 1);
  assert.equal(resolveParticipant(memory, ["Alex", "Bob", "Alex", "Carol"]), null);
  assert.equal(resolveParticipant(memory, ["Alex", "Bob", "Carol"]), null);
});

test("status distinguishes court, resting, and absent including late arrivals/departures", () => {
  const match = normalizePayload({ names, matches: [{ ...payload.matches[0], participants: [0, 1, 2, 3, 4] }] })!.matches[0];
  assert.equal(playerStatus(match, 0), "コート1");
  assert.equal(playerStatus(match, 4), "休み");
  assert.equal(playerStatus(match, 5), "不参加");
  assert.equal(playerStatus(match, null), "");
  assert.equal(playerStatus(null, 0), "");
});

test("preferences are share-scoped and tolerate corrupt data or blocked storage", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const preference = { participant: rememberParticipant(names, 1), dismissed: true };
  saveViewerPreference(storage, "FIRST123", preference);
  assert.deepEqual(readViewerPreference(storage, "FIRST123"), preference);
  assert.deepEqual(readViewerPreference(storage, "OTHER123"), { participant: null, dismissed: false });
  for (const value of ["invalid", "null", "[]", '{"version":2}', JSON.stringify({ version: 1, participant: { name: "Bob", index: 0, roster: names } })]) {
    storage.setItem("pickleball-shared-viewer-v1:FIRST123", value);
    assert.equal(readViewerPreference(storage, "FIRST123").participant, null);
  }
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } };
  assert.deepEqual(readViewerPreference(blocked, "FIRST123"), { participant: null, dismissed: false });
  assert.doesNotThrow(() => saveViewerPreference(blocked, "FIRST123", preference));
});

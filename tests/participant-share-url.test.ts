import assert from "node:assert/strict";
import test from "node:test";
import { participantShareUrl } from "../app/lib/participant-share-url.ts";

test("mini links preserve individual schedule paths under the /mini endpoint", () => {
  assert.equal(participantShareUrl("https://app.example", "ABC12345", "123456-abcdef"), "https://miniapp.line.me/123456-abcdef/s/ABC12345");
  assert.equal(participantShareUrl("https://app.example", "ABC12345"), "https://app.example/s/ABC12345");
  assert.equal(participantShareUrl("https://app.example", "ABC12345", "https://evil.example"), "https://app.example/s/ABC12345");
  assert.throws(() => participantShareUrl("https://app.example", "../admin", "123456-abcdef"));
});

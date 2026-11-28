// Active time (review of step 07: a short session showed 101 min): a tick counts only while the tab
// is visible AND the student did something (pointer, key, scroll, typing) in the last minute.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countsAsActive, IDLE_AFTER_MS } from "./progress.js";

test("active time: counts while visible and the last input was within a minute (edge included)", () => {
  assert.equal(IDLE_AFTER_MS, 60_000);
  const now = 1_000_000;
  assert.equal(countsAsActive({ visible: true, now, lastInput: now - 5_000 }), true);
  assert.equal(countsAsActive({ visible: true, now, lastInput: now - 60_000 }), true, "exactly one minute");
  assert.equal(countsAsActive({ visible: true, now, lastInput: now - 60_001 }), false, "idle");
  assert.equal(countsAsActive({ visible: false, now, lastInput: now }), false, "tab hidden");
  assert.equal(countsAsActive({ visible: true, now, lastInput: null }), false, "no input yet");
});

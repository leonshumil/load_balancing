// The rail's "current section" (review-2 P0: with Submit in view the rail lit Questions, because the
// last section can never scroll up to the line).
import { test } from "node:test";
import assert from "node:assert/strict";
import { currentSection } from "./ui.js";

const ids = ["read", "watch", "tutor", "lab", "questions", "submit"];
// section tops relative to the viewport (px), as getBoundingClientRect().top gives them
const at = (tops, extra = {}) => currentSection({ ids, tops, line: 140, atBottom: false, hash: "", inView: () => true, ...extra });

test("the current section is the last one whose top has passed the line", () => {
  assert.equal(at([-2000, -1200, -400, 100, 900, 1500]), "lab");
  assert.equal(at([20, 900, 1800, 2600, 3400, 4000]), "read");
  assert.equal(at([300, 900, 1800, 2600, 3400, 4000]), "read", "above the first: still the first");
});

test("scrolled to the very bottom: the last section is current, even though its top never reached the line", () => {
  assert.equal(at([-5000, -4000, -3000, -1500, -300, 380], { atBottom: true }), "submit");
});

test("at the bottom, a section named in the URL hash wins if it is on screen (a click on a short section's rail icon)", () => {
  assert.equal(at([-5000, -4000, -3000, -1500, -300, 380], { atBottom: true, hash: "questions" }), "questions");
  assert.equal(at([-5000, -4000, -3000, -1500, -300, 380], { atBottom: true, hash: "read", inView: (id) => id !== "read" }), "submit", "hash section off screen: ignored");
  assert.equal(at([-5000, -4000, -3000, -1500, -300, 380], { atBottom: false, hash: "submit" }), "questions", "not at the bottom: the hash doesn't matter");
});

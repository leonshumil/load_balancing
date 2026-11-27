// Read and Watch completion (bug fixes before step 05).
import { test } from "node:test";
import assert from "node:assert/strict";
import { toggleRead, readDone, cleanRead, watchMode, watchedEnough } from "./model.js";

const IDS = ["passage-1", "passage-2", "passage-3", "passage-4", "passage-5"];

test("toggleRead: ticks and unticks one passage, keeps the list sorted and unique", () => {
  assert.deepEqual(toggleRead([], "passage-3"), ["passage-3"]);
  assert.deepEqual(toggleRead(["passage-3"], "passage-1"), ["passage-1", "passage-3"]);
  assert.deepEqual(toggleRead(["passage-1", "passage-3"], "passage-3"), ["passage-1"]);
});

test("readDone: the Read section is done only when all 5 passages are ticked", () => {
  assert.equal(readDone(IDS.slice(0, 4), IDS), false);
  assert.equal(readDone(IDS, IDS), true);
  assert.equal(readDone([...IDS].reverse(), IDS), true);
  assert.equal(readDone([], []), false); // no passages on the page: never done by accident
});

test("cleanRead: a stored list keeps only passages that exist on the page", () => {
  assert.deepEqual(cleanRead(["passage-2", "x", 3, "passage-2", "passage-9"], IDS), ["passage-2"]);
  assert.deepEqual(cleanRead(null, IDS), []);
  assert.deepEqual(cleanRead("passage-1", IDS), []);
});

test("watchMode: how the end of the video is detected, by source", () => {
  assert.equal(watchMode({ tag: "VIDEO", src: "conga-summary.mp4" }), "ended");
  assert.equal(watchMode({ tag: "IFRAME", src: "https://www.youtube.com/embed/abc123?rel=0" }), "youtube");
  assert.equal(watchMode({ tag: "IFRAME", src: "https://www.youtube-nocookie.com/embed/abc123" }), "youtube");
  assert.equal(watchMode({ tag: "IFRAME", src: "https://drive.google.com/file/d/xyz/preview" }), "button");
  assert.equal(watchMode({ tag: "IFRAME", src: "https://player.example.com/v/1" }), "button");
  assert.equal(watchMode(null), "button");
});

test("watchedEnough: Watch is done at 90% of the duration (or on ended)", () => {
  assert.equal(watchedEnough(0, 223), false);
  assert.equal(watchedEnough(200, 223), false); // 89.7%
  assert.equal(watchedEnough(200.8, 223), true); // 90.04%
  assert.equal(watchedEnough(223, 223), true);
  assert.equal(watchedEnough(10, NaN), false); // metadata not loaded yet
  assert.equal(watchedEnough(10, Infinity), false); // live stream: never by time
  assert.equal(watchedEnough(10, 0), false);
});

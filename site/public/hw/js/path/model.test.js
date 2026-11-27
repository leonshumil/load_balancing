// Tests for the Figure 1 model. Every label is checked against the paper:
// CONGA (Alizadeh et al., SIGCOMM 2014), Figure 1, PDF page 2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  TREE, FORKS, PROPERTIES, congaPath, scoreFork, progress, costsVisible,
} from "./model.js";

const node = (id) => TREE[id];

// ---------- labels (CONGA Fig 1, p.2) ----------

test("CONGA Fig 1 (p.2): every node label, example list and printed note", () => {
  const expected = {
    centralized: ["Centralized", "e.g., Hedera, B4, SWAN", "slow to react for DCs"],
    distributed: ["Distributed", null, null],
    "host-based": ["Host-Based", "e.g., MPTCP", "Hard to deploy, increases Incast"],
    "in-network": ["In-Network", null, null],
    local: ["Local (Stateless or Congestion-Aware)", "e.g., ECMP, Flare, LocalFlow", "Poor with asymmetry, especially with TCP traffic"],
    global: ["Global, Congestion-Aware", null, null],
    "link-state": ["General, Link State", null, "Complex, hard to deploy"],
    "leaf-to-leaf": ["Leaf to Leaf", null, "Near-optimal for 2-tier, deployable with an overlay"],
    "per-flow": ["Per Flow", null, "Suboptimal for “heavy” flow distributions (with large flows)"],
    "per-flowlet": ["Per Flowlet (CONGA)", null, "No TCP modifications, resilient to flow distribution"],
    "per-packet": ["Per Packet", null, "Optimal, needs reordering-resilient TCP"],
  };
  assert.deepEqual(Object.keys(TREE).filter((id) => id !== "root").sort(), Object.keys(expected).sort());
  for (const [id, [label, examples, note]] of Object.entries(expected)) {
    assert.equal(node(id).label, label, `${id} label`);
    assert.equal(node(id).examples, examples, `${id} examples`);
    assert.equal(node(id).note, note, `${id} note`);
  }
});

test("CONGA Fig 1 (p.2): tree shape, parent of every node", () => {
  const parent = {
    centralized: "root", distributed: "root",
    "host-based": "distributed", "in-network": "distributed",
    local: "in-network", global: "in-network",
    "link-state": "global", "leaf-to-leaf": "global",
    "per-flow": "leaf-to-leaf", "per-flowlet": "leaf-to-leaf", "per-packet": "leaf-to-leaf",
  };
  for (const [id, p] of Object.entries(parent)) {
    assert.equal(node(id).parent, p, id);
    assert.ok(node(p).children.includes(id), `${p} lists ${id}`);
  }
});

test("CONGA Fig 1 (p.2): the thick red line runs Distributed → In-Network → Global → Leaf to Leaf → Per Flowlet", () => {
  assert.deepEqual(congaPath(), ["distributed", "in-network", "global", "leaf-to-leaf", "per-flowlet"]);
  for (const id of Object.keys(TREE)) assert.equal(node(id).onCongaPath, id === "root" || congaPath().includes(id), id);
});

// If the private docs repo is cloned, check the strings against the extracted paper text too.
const paperPath = fileURLToPath(new URL("../../../../../docs/papers/conga.md", import.meta.url));
const paper = existsSync(paperPath) ? readFileSync(paperPath, "utf8") : null;
const flat = (s) => s.replace(/\s+/g, " ");

test("CONGA Fig 1 (p.2): every label and note appears in the paper's extracted figure text", { skip: !paper && "docs/papers/conga.md not cloned" }, () => {
  const text = flat(paper);
  for (const n of Object.values(TREE)) {
    for (const s of [n.label, n.examples, n.note]) {
      if (!s) continue;
      // The PDF breaks some notes over two lines; check each line-sized piece.
      for (const piece of s.split(/, (?=[a-z])/)) assert.ok(text.includes(piece), `"${piece}" not found in conga.md`);
    }
  }
});

// ---------- properties (CONGA §2.1) ----------

test("CONGA §2.1: the five desired properties, in order, with the paper's names", () => {
  assert.deepEqual(PROPERTIES.map((p) => [p.id, p.name]), [
    ["P1", "Responsive"],
    ["P2", "Transport independent"],
    ["P3", "Robust to asymmetry"],
    ["P4", "Incrementally deployable"],
    ["P5", "Optimized for Leaf-Spine topology"],
  ]);
});

// ---------- forks (CONGA §1 text next to Fig 1, §2.2-§2.6) ----------

test("CONGA §2.2-§2.6: five forks, each tied to the section that argues it", () => {
  assert.deepEqual(FORKS.map((f) => [f.id, f.section]), [
    ["F1", "§2.2"], ["F2", "§2.3"], ["F3", "§2.4"], ["F4", "§2.5"], ["F5", "§2.6"],
  ]);
});

test("CONGA Fig 1: each fork's options are the children of the node above it, and CONGA's pick is on the red line", () => {
  const at = { F1: "root", F2: "distributed", F3: "in-network", F4: "global", F5: "leaf-to-leaf" };
  for (const f of FORKS) {
    assert.equal(f.at, at[f.id], f.id);
    assert.deepEqual(f.options.map((o) => o.id), node(f.at).children, f.id);
    assert.ok(f.options.some((o) => o.id === f.congaPick), f.id);
    assert.ok(node(f.congaPick).onCongaPath, f.id);
    for (const o of f.options) assert.equal(o.label, node(o.id).label, `${f.id} ${o.id}`);
  }
});

test("CONGA Fig 1: costs are the printed notes of the rejected branches only", () => {
  const rejected = {
    F1: ["centralized"], F2: ["host-based"], F3: ["local"], F4: ["link-state"], F5: ["per-flow", "per-packet"],
  };
  for (const f of FORKS) {
    assert.deepEqual(Object.keys(f.costs), rejected[f.id], f.id);
    for (const [id, text] of Object.entries(f.costs)) assert.equal(text, node(id).note, `${f.id} ${id}`);
  }
});

test("each fork has a one-line question, a passage link and at least one §2.1 property", () => {
  const ids = new Set(PROPERTIES.map((p) => p.id));
  for (const f of FORKS) {
    assert.ok(f.question.length > 20 && !f.question.includes("\n"), f.id);
    assert.match(f.passageId, /^passage-[1-5]$/, f.id);
    assert.ok(f.properties.length >= 1, f.id);
    for (const p of f.properties) assert.ok(ids.has(p), `${f.id} ${p}`);
    // every property in the key has at least one quote as evidence
    for (const p of f.properties) assert.ok(f.evidence.some((e) => e.property === p), `${f.id} ${p} has evidence`);
  }
});

test("questions don't name CONGA's pick (nothing hints at the answer before REVEAL_AT)", () => {
  for (const f of FORKS) {
    const pick = node(f.congaPick).label.replace(" (CONGA)", "").toLowerCase();
    assert.ok(!f.question.toLowerCase().includes("conga"), `${f.id} mentions CONGA`);
    // the question may name every option (a choice), but not only the right one
    const named = f.options.filter((o) => f.question.toLowerCase().includes(o.label.replace(" (CONGA)", "").toLowerCase()));
    assert.ok(!(named.length === 1 && named[0].id === f.congaPick), `${f.id} names only ${pick}`);
  }
});

test("evidence quotes are verbatim from the paper", { skip: !paper && "docs/papers/conga.md not cloned" }, () => {
  const text = flat(paper);
  for (const f of FORKS) for (const e of f.evidence) {
    assert.ok(text.includes(flat(e.quote)), `${f.id} ${e.property}: "${e.quote.slice(0, 60)}…" not in conga.md`);
    assert.match(e.source, /^CONGA §\d/, `${f.id} ${e.property} source`);
  }
});

// ---------- scoreFork ----------

test("scoreFork: CONGA's pick with the key's properties scores full marks (F3, CONGA §2.4)", () => {
  const r = scoreFork("F3", { pick: "global", properties: ["P3"] });
  assert.equal(r.pickCorrect, true);
  assert.equal(r.costMatches, null); // no cost matching attempted
  assert.deepEqual(r.propertyOverlap, { hit: ["P3"], missed: [], extra: [], score: 1 });
});

test("scoreFork: the rejected branch is not correct (F1 Centralized, CONGA §2.2)", () => {
  assert.equal(scoreFork("F1", { pick: "centralized" }).pickCorrect, false);
});

test("scoreFork: property overlap lists hits, misses and extras (F4, CONGA §1/§2.5)", () => {
  const r = scoreFork("F4", { pick: "leaf-to-leaf", properties: ["P5", "P1"] });
  assert.deepEqual(r.propertyOverlap.hit, ["P5"]);
  assert.deepEqual(r.propertyOverlap.missed, ["P4"]);
  assert.deepEqual(r.propertyOverlap.extra, ["P1"]);
  assert.equal(r.propertyOverlap.score, 0.5);
});

test("scoreFork: unknown or repeated properties are ignored", () => {
  const r = scoreFork("F3", { pick: "global", properties: ["P3", "P3", "P9"] });
  assert.deepEqual(r.propertyOverlap, { hit: ["P3"], missed: [], extra: [], score: 1 });
});

test("scoreFork: cost matching, student assigns each printed cost to a rejected branch (F5, CONGA Fig 1)", () => {
  const right = scoreFork("F5", { pick: "per-flowlet", costs: { "per-flow": "per-flow", "per-packet": "per-packet" } });
  assert.deepEqual(right.costMatches, { correct: 2, total: 2, byOption: { "per-flow": true, "per-packet": true } });
  const swapped = scoreFork("F5", { pick: "per-flowlet", costs: { "per-flow": "per-packet", "per-packet": "per-flow" } });
  assert.deepEqual(swapped.costMatches, { correct: 0, total: 2, byOption: { "per-flow": false, "per-packet": false } });
  const half = scoreFork("F5", { pick: "per-flowlet", costs: { "per-flow": "per-flow" } });
  assert.deepEqual(half.costMatches, { correct: 1, total: 2, byOption: { "per-flow": true, "per-packet": false } });
});

test("scoreFork: empty answer scores nothing and doesn't throw", () => {
  const r = scoreFork("F2", {});
  assert.equal(r.pickCorrect, false);
  assert.equal(r.costMatches, null);
  assert.equal(r.propertyOverlap.score, 0);
});

test("scoreFork: unknown fork throws", () => {
  assert.throws(() => scoreFork("F9", { pick: "x" }), /unknown fork/i);
});

// ---------- progress ----------

test("progress: a fork is done once it has a valid pick and at least one valid property", () => {
  assert.deepEqual(progress({}), { done: 0, total: 5, next: "F1" });
  assert.deepEqual(progress(undefined), { done: 0, total: 5, next: "F1" });
  const answers = {
    F1: { pick: "distributed", properties: ["P1"] },
    F2: { pick: "host-based", properties: ["P2"] }, // wrong pick still counts as done
    F3: { pick: "global" },                          // no property yet: not done
    F4: { pick: "nope", properties: ["P4"] },        // not an option of F4: not done
  };
  assert.deepEqual(progress(answers), { done: 2, total: 5, next: "F3" });
  const all = Object.fromEntries(FORKS.map((f) => [f.id, { pick: f.congaPick, properties: f.properties }]));
  assert.deepEqual(progress(all), { done: 5, total: 5, next: null });
});

// ---------- when costs may be shown ----------

test("costsVisible: never before REVEAL_AT in 'after-reveal' mode; after answering in 'after-answer' mode", () => {
  const revealAt = Date.parse("2027-01-01T00:00:00+02:00");
  const before = revealAt - 1, after = revealAt + 1;
  assert.equal(costsVisible({ answered: true, now: before, revealAt, mode: "after-reveal" }), false);
  assert.equal(costsVisible({ answered: false, now: after, revealAt, mode: "after-reveal" }), true);
  assert.equal(costsVisible({ answered: false, now: before, revealAt, mode: "after-answer" }), false);
  assert.equal(costsVisible({ answered: true, now: before, revealAt, mode: "after-answer" }), true);
  assert.equal(costsVisible({ answered: false, now: after, revealAt, mode: "after-answer" }), true);
  // default mode is the strict one until the user decides
  assert.equal(costsVisible({ answered: true, now: before, revealAt }), false);
});

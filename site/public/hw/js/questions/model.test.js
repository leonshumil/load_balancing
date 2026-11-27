// Questions (step 09): checking per type, attempts, score, and the bank itself against the
// paper (CONGA, Alizadeh et al., SIGCOMM 2014) and the lab model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { check, answered, record, score, isDone, cleanState, submission, validateBank } from "./model.js";
import { buildNet, runAll } from "../lab/model.js";
import { TREE, congaPath } from "../path/model.js";

const BANK = JSON.parse(readFileSync(new URL("../../data/questions.json", import.meta.url), "utf8"));
const byId = Object.fromEntries(BANK.map((q) => [q.id, q]));

const MC = { id: "m", type: "mc", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], answer: "b" };
const MULTI = { id: "x", type: "multi", options: ["a", "b", "c", "d"].map((id) => ({ id, text: id })), answer: ["a", "c"] };
const NUM = { id: "n", type: "numeric", answer: 70, tolerance: 1, unit: "Gbps" };
const ORDER = { id: "o", type: "order", options: ["c", "a", "b"].map((id) => ({ id, text: id })), answer: ["a", "b", "c"] };
const Q = [MC, MULTI, NUM, ORDER];

// ---------- check, one block per type ----------

test("mc: the right option is correct, any other is not", () => {
  assert.equal(check(MC, "b").correct, true);
  assert.equal(check(MC, "a").correct, false);
  assert.match(check(MC, "a").feedback, /try again/i);
});

test("multi: correct only with exactly the right set, in any order", () => {
  assert.equal(check(MULTI, ["c", "a"]).correct, true);
  assert.equal(check(MULTI, ["a"]).correct, false);
  assert.equal(check(MULTI, ["a", "c", "d"]).correct, false);
  assert.equal(check(MULTI, ["a", "a", "c"]).correct, true, "duplicates don't count twice");
  assert.equal(check(MULTI, ["a", "d"]).feedback, "1 of 2 right, 1 that isn't.");
  assert.equal(check(MULTI, ["a"]).feedback, "1 of 2 right.");
});

test("numeric: within the tolerance is correct, including both edges", () => {
  assert.equal(check(NUM, 70).correct, true);
  assert.equal(check(NUM, "71").correct, true, "upper edge");
  assert.equal(check(NUM, "69").correct, true, "lower edge");
  assert.equal(check(NUM, " 70.5 ").correct, true, "spaces and decimals");
  assert.equal(check(NUM, 71.01).correct, false);
  assert.equal(check(NUM, 68.99).correct, false);
  assert.match(check(NUM, 90).feedback, /too high/i);
  assert.match(check(NUM, 40).feedback, /too low/i);
  assert.equal(check({ ...NUM, tolerance: undefined }, 70).correct, true, "no tolerance means exact");
  assert.equal(check({ ...NUM, tolerance: undefined }, 70.4).correct, false);
});

test("order: correct only in the exact order; feedback counts the items in place", () => {
  assert.equal(check(ORDER, ["a", "b", "c"]).correct, true);
  assert.equal(check(ORDER, ["c", "a", "b"]).correct, false);
  assert.equal(check(ORDER, ["a", "c", "b"]).feedback, "1 of 3 in the right place.");
  assert.equal(check(ORDER, ["a", "b"]).correct, false, "missing items");
});

test("answered: nothing to check until there is an answer", () => {
  assert.equal(answered(MC, null), false);
  assert.equal(answered(MC, "zz"), false, "not an option");
  assert.equal(answered(MULTI, []), false);
  assert.equal(answered(NUM, ""), false);
  assert.equal(answered(NUM, "abc"), false);
  assert.equal(answered(NUM, "0"), true);
  assert.equal(answered(ORDER, ["c", "a", "b"]), true);
  assert.equal(answered(ORDER, ["c", "a"]), false);
  assert.equal(check(NUM, "").correct, false);
});

// ---------- attempts and score ----------

test("record keeps firstAnswer, counts tries, and stops once correct", () => {
  let s = cleanState(null, Q);
  s = record(s, MC, "a");
  assert.deepEqual(s.attempts.m, { firstAnswer: "a", answer: "a", tries: 1, correct: false, firstCorrect: false });
  s = record(s, MC, "b");
  assert.deepEqual(s.attempts.m, { firstAnswer: "a", answer: "b", tries: 2, correct: true, firstCorrect: false });
  assert.equal(record(s, MC, "a"), s, "a correct question is not re-checked");
  assert.equal(record(s, NUM, ""), s, "an empty answer is not an attempt");
});

test("score: first-try correct out of N, and where each missed question came from", () => {
  let s = cleanState(null, Q);
  s = record(s, MC, "b");
  s = record(s, NUM, 90);
  s = record(s, NUM, 70);
  const r = score(s, Q);
  assert.equal(r.firstTry, 1);
  assert.equal(r.total, 4);
  assert.equal(r.checked, 2);
  assert.deepEqual(r.missed, ["n"]);
  assert.equal(isDone(s, Q), false);
  s = record(record(s, MULTI, ["a"]), ORDER, ["a", "b", "c"]);
  assert.equal(isDone(s, Q), true, "done once every question has been checked");
  assert.deepEqual(score(s, Q).missed, ["x", "n"], "in bank order");
});

test("cleanState drops unknown ids, bad shapes and a bad current question", () => {
  const s = cleanState({ current: "nope", drafts: { m: "a", zz: 1 }, attempts: { m: { firstAnswer: "a", answer: "a", tries: 1, correct: false, firstCorrect: false }, zz: {}, n: "bad" } }, Q);
  assert.equal(s.current, "m");
  assert.deepEqual(Object.keys(s.drafts), ["m"]);
  assert.deepEqual(Object.keys(s.attempts), ["m"]);
  assert.deepEqual(cleanState("garbage", Q), { current: "m", drafts: {}, attempts: {} });
  assert.equal(cleanState({ current: "o" }, Q).current, "o");
});

test("submission lists every question in bank order", () => {
  const s = record(cleanState(null, Q), NUM, 69.5);
  const sub = submission(s, Q);
  assert.deepEqual(sub.map((x) => x.id), ["m", "x", "n", "o"]);
  assert.deepEqual(sub[2], { id: "n", firstAnswer: 69.5, answer: 69.5, tries: 1, correct: true, firstCorrect: true });
  assert.deepEqual(sub[0], { id: "m", firstAnswer: null, answer: null, tries: 0, correct: false, firstCorrect: false });
});

// ---------- the bank ----------

test("bank: 6-8 well-formed questions covering all four types, each with a paper source", () => {
  assert.deepEqual(validateBank(BANK), []);
  assert.ok(BANK.length >= 6 && BANK.length <= 8);
  assert.deepEqual(new Set(BANK.map((q) => q.type)), new Set(["mc", "multi", "numeric", "order"]));
  for (const q of BANK) {
    assert.match(q.source, /^CONGA /, `${q.id}: source names the paper`);
    assert.ok(["read", "watch", "tutor", "lab"].includes(q.section), `${q.id}: links back to a section`);
  }
  assert.ok(validateBank([{ ...MC, answer: "zz" }]).length > 0, "validateBank catches a bad answer");
});

test("Q2 (CONGA §2.4, Fig 2, weak link at 20G): the answer is the lab model's ECMP throughput", () => {
  const net = buildNet(["L0", "L1"], ["S0", "S1"], { "L0-S0": 80, "S0-L1": 80, "L0-S1": 80, "S1-L1": 20 });
  const ecmp = runAll(net, [{ src: "L0", dst: "L1", gbps: 100 }]).ecmp.result.total;
  assert.equal(byId.q2.answer, ecmp);
  assert.equal(byId.q2.unit, "Gbps");
  assert.ok(byId.q2.tolerance < 10, "the tolerance can't accept the 80 or 90 neighbours by mistake");
});

test("Q4 (CONGA Fig 1): the order is the thick red line, top to bottom", () => {
  assert.deepEqual(byId.q4.answer, congaPath());
  assert.notDeepEqual(byId.q4.options.map((o) => o.id), byId.q4.answer, "not shown already solved");
});

test("Q5 (CONGA Fig 1): the answer is the branch printed with 'Hard to deploy, increases Incast'", () => {
  const branch = Object.values(TREE).find((n) => n.note === "Hard to deploy, increases Incast");
  const opt = byId.q5.options.find((o) => o.id === byId.q5.answer);
  assert.equal(branch.id, "host-based");
  assert.ok(opt.text.startsWith(branch.label), opt.text);
});

test("Q6 (CONGA §3.1): the four overlay fields, with the paper's bit widths", () => {
  const right = byId.q6.options.filter((o) => byId.q6.answer.includes(o.id)).map((o) => o.text);
  assert.deepEqual(right, ["LBTag (4 bits)", "CE (3 bits)", "FB_LBTag (4 bits)", "FB_Metric (3 bits)"]);
});

test("Q8 (CONGA §3): the source leaf decides", () => {
  assert.match(byId.q8.options.find((o) => o.id === byId.q8.answer).text, /source leaf/i);
});

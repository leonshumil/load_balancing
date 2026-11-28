// Lab UI state (step 06): pure rules for the guided flow, predictions, editing and results.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialState, setScenario, effective, results, visibleSchemes, canEdit, setShare, setWeight,
  predict, reveal, commitWeights, setLinkCap, setDemands, resetScenario, setAnswer, steps, isDone,
  restore, submission, showEcmpWins,
} from "./state.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("starts on Fig 2 with ECMP selected and nothing revealed", () => {
  const s = initialState();
  assert.equal(s.scenario, "fig2");
  assert.equal(s.scheme, "ecmp");
  assert.deepEqual([...visibleSchemes(s, "fig2")], []);
});

test("Fig 2 (CONGA §2.4): no result before its prediction; reveal needs a number first", () => {
  let s = initialState();
  assert.throws(() => reveal(s, "fig2", "ecmp"), /predict/);
  s = predict(s, "fig2", "ecmp", 95);
  s = reveal(s, "fig2", "ecmp");
  assert.deepEqual([...visibleSchemes(s, "fig2")], ["ecmp"]);
  const r = results(s, "fig2");
  near(r.ecmp.total, 90, 1e-6, "ECMP");
  assert.equal(r.paper.ecmp, 90); // the paper's number, tagged in the UI
});

test("Fig 2: editable once all three are revealed; the step is done when the question is answered too", () => {
  let s = initialState();
  assert.equal(canEdit(s, "fig2"), false);
  for (const k of ["ecmp", "localOnly", "conga"]) s = reveal(predict(s, "fig2", k, 90), "fig2", k);
  assert.equal(canEdit(s, "fig2"), true);
  assert.equal(steps(s).fig2, false);
  s = setAnswer(s, "fig2Why", "TCP slows the bottlenecked path, so its uplink looks idle.");
  assert.equal(steps(s).fig2, true);
});

test("Fig 3: tune weights in (a) (only Weighted shows), commit, predict (b), reveal; the same weights carry over", () => {
  let s = setScenario(initialState(), "fig3a");
  assert.deepEqual([...visibleSchemes(s, "fig3a")], ["weighted"]);
  s = setWeight(s, "L1>L2", { S0: 0.5, S1: 0.5 });
  near(results(s, "fig3a").weighted.total, 80, 1e-6, "(a) with 50/50");
  s = commitWeights(s);
  assert.deepEqual([...visibleSchemes(s, "fig3a")].sort(), ["conga", "ecmp", "localOnly", "weighted"]);
  s = setScenario(s, "fig3b");
  assert.deepEqual([...visibleSchemes(s, "fig3b")], []);
  assert.throws(() => reveal(s, "fig3b", "all"), /predict/);
  s = reveal(predict(s, "fig3b", "weighted", 80), "fig3b", "all");
  const r = results(s, "fig3b");
  assert.ok(r.weighted.total < 70, `the (a) weights fail in (b): ${r.weighted.total}`);
  near(r.conga.total, 80, 0.5, "CONGA adapts");
  assert.equal(steps(s).fig3, false); // still needs the answer to "why can't one set of weights fit both?"
  s = setAnswer(s, "fig3Why", "Because the right split depends on the traffic matrix.");
  assert.equal(steps(s).fig3, true);
});

test("Fig 3b can't be revealed before the (a) weights are committed", () => {
  const s = setScenario(initialState(), "fig3a");
  assert.throws(() => reveal(predict(setScenario(s, "fig3b"), "fig3b", "weighted", 50), "fig3b", "all"), /3a/);
});

test("setShare: one slider moves, the others rescale so the shares sum to 100%", () => {
  const sh = setShare({ S0: 0.5, S1: 0.3, S2: 0.2 }, "S0", 0.8);
  near(sh.S0, 0.8, 1e-9, "S0");
  near(sh.S1, 0.12, 1e-9, "S1 keeps its 60% of the rest");
  near(sh.S2, 0.08, 1e-9, "S2");
  const z = setShare({ S0: 1, S1: 0 }, "S0", 0.4);
  near(z.S1, 0.6, 1e-9, "the rest goes to the others equally when they were all 0");
});

test("ECMP wins? (§6.1 Fig 17 first, then stale feedback): predict who wins, then reveal; both needed", () => {
  let s = setScenario(initialState(), "ecmpWins");
  assert.equal(s.ecmpWinsView, null); // the hint card first; "Show me" loads Fig 17
  s = showEcmpWins(s, "fig17");
  assert.deepEqual([...visibleSchemes(s, "ecmpWins")], []);
  s = reveal(predict(s, "ecmpWins:fig17", "winner", "ecmp"), "ecmpWins:fig17", "all");
  let r = results(s, "ecmpWins");
  near(r.ecmp.total, 600, 0.01, "ECMP");
  near(r.conga.total, 400, 0.01, "CONGA in the Nash flow");
  near(r.congaFromEcmp, 600, 0.5, "CONGA started from ECMP");
  assert.equal(r.beyondPaper, false);
  assert.equal(steps(s).ecmpWins, false);
  s = showEcmpWins(s, "delay");
  s = reveal(predict(s, "ecmpWins:delay", "winner", "conga"), "ecmpWins:delay", "all");
  r = results(s, "ecmpWins");
  assert.equal(r.beyondPaper, true);
  assert.ok(r.conga.total < r.ecmp.total - 10, "stale feedback: CONGA below ECMP on average");
  assert.ok(r.trace.length > 10, "a trace for the chart");
  assert.equal(steps(s).ecmpWins, true);
});

test("Sandbox: always live, editable; link and demand edits recompute; Reset to paper restores", () => {
  let s = setScenario(initialState(), "sandbox");
  assert.equal(canEdit(s, "sandbox"), true);
  assert.equal(visibleSchemes(s, "sandbox").size, 4);
  const before = results(s, "sandbox").ecmp.total;
  s = setLinkCap(s, "sandbox", "S1-L2", 0);
  const net = effective(s, "sandbox").net;
  assert.equal(net.cap["S1>L2"], 0);
  assert.equal(net.cap["L2>S1"], 0);
  assert.ok(results(s, "sandbox").ecmp.total < before, "a failed link costs ECMP throughput");
  s = setDemands(s, "sandbox", [{ src: "L0", dst: "L1", gbps: 30 }]);
  near(results(s, "sandbox").ecmp.total, 30, 1e-6, "new demand");
  s = resetScenario(s, "sandbox");
  near(results(s, "sandbox").ecmp.total, before, 1e-6, "reset");
});

test("editing a guided scenario is refused until its step is done", () => {
  assert.throws(() => setLinkCap(initialState(), "fig2", "S1-L1", 80), /not yet/);
});

test("Why not (step 4) needs a short written answer; the section is done when all four steps are", () => {
  let s = initialState();
  assert.equal(steps(s).whyNot, false);
  s = setAnswer(s, "whyNot", "too short");
  assert.equal(steps(s).whyNot, false);
  s = setAnswer(s, "whyNot", "Stale feedback can make leaves herd onto one path.");
  assert.equal(steps(s).whyNot, true);
  assert.equal(isDone(s), false);
});

test("restore: a saved lab comes back; junk starts fresh", () => {
  const s = reveal(predict(initialState(), "fig2", "ecmp", 85), "fig2", "ecmp");
  assert.deepEqual(restore(JSON.parse(JSON.stringify(s))), s);
  for (const junk of [null, 3, { v: 2 }, { ...s, scenario: "nope" }, { ...s, predictions: 5 }]) assert.deepEqual(restore(junk), initialState());
});

test("weights belong to a scenario (Fig 3a and 3b share theirs): Fig 3's weights don't leak into Fig 17's L1->L2", () => {
  let s = setWeight(setScenario(initialState(), "fig3a"), "L1>L2", { S0: 1, S1: 0 });
  assert.deepEqual(setScenario(s, "fig3b").weights.fig3["L1>L2"], { S0: 1, S1: 0 });
  s = showEcmpWins(s, "fig17");
  near(results(s, "ecmpWins").weighted.total, results(s, "ecmpWins").ecmp.total, 1e-6, "Fig 17 Weighted without weights = ECMP");
});

test("submission: predictions, answers, weights and sandbox edits (what Submit sends)", () => {
  let s = reveal(predict(initialState(), "fig2", "ecmp", 85), "fig2", "ecmp");
  s = setWeight(setScenario(s, "fig3a"), "L1>L2", { S0: 0.7, S1: 0.3 });
  s = setLinkCap(setScenario(s, "sandbox"), "sandbox", "L0-S0", 40);
  const sub = submission(s);
  assert.equal(sub.predictions["fig2"].ecmp, 85);
  assert.deepEqual(sub.weights.fig3["L1>L2"], { S0: 0.7, S1: 0.3 });
  assert.equal(sub.edits.sandbox.links["L0-S0"], 40);
  assert.equal(sub.done, false);
});

// ---------- step 14 (lab redesign) ----------
import { whyLine, SCENARIO_IDS as IDS } from "./state.js";

test("Fig 2: one 'Check my predictions' reveals all three, and only when all three are entered", () => {
  let s = predict(predict(initialState(), "fig2", "ecmp", 90), "fig2", "localOnly", 85);
  assert.throws(() => reveal(s, "fig2", "all"), /predict/);
  s = reveal(predict(s, "fig2", "conga", 100), "fig2", "all");
  assert.deepEqual([...visibleSchemes(s, "fig2")].sort(), ["conga", "ecmp", "localOnly", "weighted"]);
  assert.equal(canEdit(s, "fig2"), true);
});

test("the stepper has a Why not view (no graph) and the Sandbox", () => {
  assert.deepEqual(IDS, ["fig2", "fig3a", "fig3b", "ecmpWins", "whyNot", "sandbox"]);
  const s = setScenario(initialState(), "whyNot");
  assert.equal(s.scenario, "whyNot");
  assert.equal(visibleSchemes(s, "whyNot").size, 0);
});

test("each scenario opens on its most telling demand (Fig 3b: L1->L2, the one with a choice)", () => {
  assert.equal(setScenario(initialState(), "fig3b").selected, 1);
  assert.equal(setScenario(initialState(), "fig2").selected, 0);
});

test("whyLine: one sentence per scheme, from the paper's argument (CONGA §2.4)", () => {
  const s = initialState();
  assert.match(whyLine(s, "fig2", "localOnly"), /TCP slows the lower path/);
  assert.match(whyLine(s, "fig2", "conga"), /66\.6/);
  assert.match(whyLine(setScenario(s, "fig3b"), "fig3b", "weighted"), /S0/);
  for (const sc of ["fig2", "fig3a", "fig3b"]) for (const k of ["ecmp", "localOnly", "conga", "weighted"]) assert.ok(whyLine(s, sc, k).length > 20, `${sc} ${k}`);
  assert.match(whyLine(setScenario(s, "sandbox"), "sandbox", "ecmp"), /full|No link/);
});

// review 12: the shares move from the spine labels into the results card
import { pathSplitLine } from "./state.js";
test("pathSplitLine (CONGA §2.4, Fig 2): upper / lower path shares of what the selected demand delivers", () => {
  const s = initialState();
  assert.equal(pathSplitLine(s, "fig2", "ecmp"), "Upper path (S0) 56% · lower path (S1) 44%", "ECMP: 50 + 40 delivered");
  assert.equal(pathSplitLine(s, "fig2", "conga"), "Upper path (S0) 67% · lower path (S1) 33%", "CONGA: 66.7 / 33.3");
  assert.equal(pathSplitLine(s, "fig2", "localOnly"), "Upper path (S0) 50% · lower path (S1) 50%", "local only: 40 / 40");
});

test("pathSplitLine: three or more paths are listed by spine; one path says so", () => {
  const s = showEcmpWins(initialState(), "fig17");
  assert.equal(pathSplitLine(s, "ecmpWins", "conga"), "S0 0% · S1 100% · S2 0%", "Fig 17: L0→L1 stuck on S1 (Nash)");
  assert.equal(pathSplitLine(s, "ecmpWins", "ecmp"), "S0 33% · S1 33% · S2 33%");
  let one = initialState();
  for (const k of ["ecmp", "localOnly", "conga"]) one = predict(one, "fig2", k, 90);
  one = setLinkCap(reveal(one, "fig2", "all"), "fig2", "L0-S1", 0);
  assert.equal(pathSplitLine(one, "fig2", "ecmp"), "One path (S0)");
});

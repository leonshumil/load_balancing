// Tutor client state machine (step 12). Fork data and the answer key come from
// hw/js/path/model.js (CONGA Fig 1, §2.1-§2.6); the LLM never decides a reveal or a score.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORKS } from "../path/model.js";
import {
  MAX_TURNS, initialState, start, currentForkId, addStudent, applyReply, revealCurrent, advance,
  fallbackAnswer, goOffline, goLive, historyFor, requestBody, treeView, nodeQuestion,
  recap, propertiesUsed, isDone, restore, submission,
} from "./model.js";

const reply = (over = {}) => ({ reply: "Why?", cites: [], detected_pick: null, properties_mentioned: [], ready_to_reveal: false, fallback: false, ...over });
const live = () => start(initialState("sid-1234567"), "live");

test("start: opening (Unit 4 gap) + the F1 question; mode set; nothing picked", () => {
  const s = live();
  assert.equal(s.mode, "live");
  assert.equal(currentForkId(s), "F1");
  assert.equal(s.messages.length, 2);
  assert.match(s.messages[0].text, /FlowBender/);
  assert.match(s.messages[1].text, new RegExp(FORKS[0].question.slice(0, 30)));
  assert.equal(s.messages[1].fork, "F1");
  // starting again doesn't repeat the opening
  assert.equal(start(s, "fallback").messages.length, 2);
});

test("applyReply: saves detected_pick (only this fork's branches) and unions properties", () => {
  let s = addStudent(live(), "Distributed, P1");
  let r = applyReply(s, reply({ detected_pick: "distributed", properties_mentioned: ["P1"], cites: ["2.2-p1"] }));
  s = r.state;
  assert.equal(r.reveal, false);
  assert.equal(s.forks.F1.pick, "distributed");
  assert.deepEqual(s.forks.F1.properties, ["P1"]);
  assert.equal(s.forks.F1.turns, 1);
  assert.deepEqual(s.messages.at(-1).cites, ["2.2-p1"]);
  r = applyReply(s, reply({ detected_pick: "per-flowlet", properties_mentioned: ["P5", "P1", "P9"] }));
  assert.equal(r.state.forks.F1.pick, "distributed"); // not an F1 branch: ignored
  assert.deepEqual(r.state.forks.F1.properties, ["P1", "P5"]);
});

test("reveal rule: ready_to_reveal, or the 6th turn on a fork (code decides, not the LLM)", () => {
  assert.equal(applyReply(live(), reply({ ready_to_reveal: true })).reveal, true);
  let s = live();
  for (let i = 1; i <= MAX_TURNS; i++) {
    const r = applyReply(addStudent(s, `try ${i}`), reply());
    assert.equal(r.reveal, i === MAX_TURNS, `turn ${i}`);
    s = r.state;
  }
});

test("revealCurrent: by the tutor adds nothing; otherwise a scripted reveal from model.js with Figure 1's cost", () => {
  const byTutor = revealCurrent(live(), "tutor");
  assert.equal(byTutor.forks.F1.revealed, true);
  assert.equal(byTutor.forks.F1.revealedBy, "tutor");
  assert.equal(byTutor.messages.length, 2);
  const byButton = revealCurrent(live(), "button");
  const msg = byButton.messages.at(-1);
  assert.equal(msg.kind, "reveal");
  assert.match(msg.text, /Distributed/);
  assert.match(msg.text, /slow to react for DCs/); // CONGA Fig 1: Centralized's note
});

test("advance: next fork's question; after F5 the walk is done", () => {
  let s = live();
  for (const f of FORKS) {
    assert.equal(currentForkId(s), f.id);
    s = advance(revealCurrent(s, "button"));
  }
  assert.equal(isDone(s), true);
  assert.equal(currentForkId(s), null);
  assert.equal(s.messages.at(-1).kind, "done");
});

test("advance refuses to skip an unrevealed fork", () => {
  assert.throws(() => advance(live()), /not revealed/);
});

test("fallback: branch + 1-3 properties -> score from model.js, student line + reveal in the log", () => {
  const s = goOffline(live(), "quota");
  assert.equal(s.mode, "fallback");
  assert.equal(s.offline, "quota");
  const r = fallbackAnswer(s, "centralized", ["P1"]);
  assert.equal(r.score.pickCorrect, false);
  assert.deepEqual(r.score.propertyOverlap.hit, ["P1"]);
  assert.equal(r.state.forks.F1.pick, "centralized");
  assert.equal(r.state.forks.F1.revealed, true);
  assert.equal(r.state.forks.F1.revealedBy, "fallback");
  assert.equal(r.state.messages.at(-2).role, "student");
  assert.match(r.state.messages.at(-2).text, /Centralized/);
  assert.equal(r.state.messages.at(-1).kind, "reveal");
  assert.throws(() => fallbackAnswer(s, "per-flowlet", ["P1"]), /branch/);
  assert.throws(() => fallbackAnswer(s, "distributed", []), /1-3/);
  assert.throws(() => fallbackAnswer(s, "distributed", ["P1", "P2", "P3", "P4"]), /1-3/);
});

test("switching modes keeps the walk where it was", () => {
  let s = advance(revealCurrent(live(), "button"));
  s = goOffline(s, "error");
  assert.equal(currentForkId(s), "F2");
  s = goLive(s);
  assert.equal(s.mode, "live");
  assert.equal(s.offline, null);
  assert.equal(currentForkId(s), "F2");
});

test("requestBody: session, fork, last 6 turns as user/assistant, picks + properties; no class code", () => {
  let s = live();
  for (let i = 0; i < 5; i++) s = applyReply(addStudent(s, `q${i}`), reply({ reply: `a${i}` })).state;
  s = applyReply(addStudent(s, "Distributed (P1)"), reply({ detected_pick: "distributed", properties_mentioned: ["P1"] })).state;
  const b = requestBody(s, "and P5?");
  assert.equal(b.session_id, "sid-1234567");
  assert.ok(!("class_code" in b));
  assert.equal(b.fork_id, "F1");
  assert.equal(b.message, "and P5?");
  assert.equal(b.history.length, 6);
  assert.deepEqual(b.history.at(-1), { role: "assistant", text: "Why?" });
  assert.ok(b.history.every((t) => t.role === "user" || t.role === "assistant"));
  assert.deepEqual(b.state, { picks: { F1: "distributed" }, properties_used: { F1: ["P1"] } });
  // after the walk, questions are free questions (no fork)
  let done = live();
  for (let i = 0; i < FORKS.length; i++) done = advance(revealCurrent(done, "button"));
  assert.equal(requestBody(done, "what is DRE?").fork_id, null);
});

test("treeView: current fork glows, revealed forks show the path and the rejected branches with costs", () => {
  let s = applyReply(addStudent(live(), "centralized"), reply({ detected_pick: "centralized" })).state;
  let v = treeView(s);
  assert.equal(v.centralized.status, "current");
  assert.equal(v.distributed.status, "current");
  assert.equal(v.centralized.mine, true);
  assert.equal(v.centralized.cost, null); // not before the reveal
  assert.equal(v["host-based"].status, "future");
  s = advance(revealCurrent(s, "button"));
  v = treeView(s);
  assert.equal(v.distributed.status, "path");
  assert.equal(v.centralized.status, "rejected");
  assert.equal(v.centralized.cost, "slow to react for DCs");
  assert.equal(v["host-based"].status, "current");
  assert.equal(v["in-network"].status, "current");
});

test("nodeQuestion: about this fork or earlier ones only", () => {
  let s = live();
  assert.equal(nodeQuestion(s, "centralized"), "What about Centralized?");
  assert.equal(nodeQuestion(s, "host-based"), null); // F2 not reached
  s = advance(revealCurrent(s, "button"));
  assert.equal(nodeQuestion(s, "centralized"), "Why not Centralized?");
  assert.equal(nodeQuestion(s, "distributed"), "Why Distributed?");
  assert.equal(nodeQuestion(s, "host-based"), "What about Host-Based?");
});

test("recap: picks vs the paper's, disagreements, properties used", () => {
  let s = goOffline(live(), "disabled");
  const answers = [["centralized", ["P1"]], ["in-network", ["P2"]], ["global", ["P3"]], ["leaf-to-leaf", ["P4", "P5"]], ["per-packet", ["P1"]]];
  for (const [pick, props] of answers) s = advance(fallbackAnswer(s, pick, props).state);
  const r = recap(s);
  assert.equal(r.rows.length, 5);
  assert.deepEqual(r.rows.map((x) => x.agree), [false, true, true, true, false]);
  assert.deepEqual(r.disagreements, ["F1", "F5"]);
  assert.equal(r.rows[0].congaLabel, "Distributed");
  assert.deepEqual(propertiesUsed(s), ["P1", "P2", "P3", "P4", "P5"]);
});

test("restore: a saved walk comes back; junk gives a fresh state", () => {
  let s = applyReply(addStudent(live(), "x"), reply({ detected_pick: "distributed" })).state;
  const back = restore(JSON.parse(JSON.stringify(s)), () => "new-id-123456");
  assert.deepEqual(back, s);
  for (const junk of [null, 42, "x", { v: 9 }, { ...s, fork: 9 }, { ...s, forks: {} }, { ...s, messages: [{ role: "hacker", text: 1 }] }]) {
    const r = restore(junk, () => "new-id-123456");
    assert.equal(r.sessionId, "new-id-123456");
    assert.equal(r.messages.length, 0);
  }
});

test("submission: what Submit (step 07) sends: picks, properties, turns per fork, mode; not the chat", () => {
  let s = applyReply(addStudent(live(), "x"), reply({ detected_pick: "distributed", properties_mentioned: ["P1"] })).state;
  s = advance(revealCurrent(s, "tutor"));
  const sub = submission(s);
  assert.equal(sub.forks.F1.pick, "distributed");
  assert.equal(sub.forks.F1.turns, 1);
  assert.equal(sub.forks.F1.revealedBy, "tutor");
  assert.equal(sub.forks.F1.agree, true);
  assert.equal(sub.mode, "live");
  assert.ok(!("messages" in sub));
});

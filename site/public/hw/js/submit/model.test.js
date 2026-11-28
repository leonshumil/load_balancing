// Submit by email (step 07): validation, the summary, the Web3Forms payload and sending (fetch mocked).
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, clip, buildSummary, collect, payload, send, ENDPOINT, QUESTION_MIN, QUESTION_MAX, SUMMARY_MAX } from "./model.js";
import * as T from "../tutor/model.js";
import * as L from "../lab/state.js";

const good = { name: "Dana Levi", email: "dana@post.bgu.ac.il", question: "Why does CONGA use flowlets and not packets?" };

// ---------- validation ----------

test("validate: all three fields are required", () => {
  assert.deepEqual(validate(good), { ok: true, errors: {} });
  const r = validate({ name: "  ", email: "", question: "" });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ["email", "name", "question"]);
});

test("validate: email must look like an address", () => {
  for (const bad of ["dana", "dana@", "@bgu.ac.il", "dana@bgu", "da na@bgu.ac.il", "dana@@bgu.ac.il"]) {
    assert.ok(validate({ ...good, email: bad }).errors.email, bad);
  }
  assert.equal(validate({ ...good, email: "  dana@bgu.ac.il " }).ok, true, "spaces around are fine");
});

test(`validate: the question is ${QUESTION_MIN}-${QUESTION_MAX} characters (after trimming), both edges included`, () => {
  assert.equal(QUESTION_MIN, 10);
  assert.equal(QUESTION_MAX, 500);
  assert.ok(validate({ ...good, question: "x".repeat(9) }).errors.question);
  assert.equal(validate({ ...good, question: "x".repeat(10) }).ok, true);
  assert.equal(validate({ ...good, question: `  ${"x".repeat(10)}  ` }).ok, true);
  assert.equal(validate({ ...good, question: "x".repeat(500) }).ok, true);
  assert.ok(validate({ ...good, question: "x".repeat(501) }).errors.question);
});

test("clip: cuts long text with '…' and keeps short text", () => {
  assert.equal(clip("short", 10), "short");
  assert.equal(clip("abcdefghijkl", 6), "abcde…");
  assert.equal(clip("  a\n\n b  ", 10), "a b", "whitespace collapsed");
  assert.equal(clip(null, 5), "");
});

// ---------- summary ----------

const fullData = () => ({
  done: 3, total: 5, seconds: 42 * 60 + 30,
  tutor: { mode: "live", forks: [
    { id: "F1", section: "§2.2", pick: "Distributed", paper: "Distributed", properties: ["P1", "P5"], paperProperties: ["P1", "P5"] },
    { id: "F2", section: "§2.3", pick: "Host-Based", paper: "In-Network", properties: ["P2"], paperProperties: ["P2", "P4"] },
    { id: "F3", section: "§2.4", pick: null, paper: "Global, Congestion-Aware", properties: [], paperProperties: ["P3"] },
    { id: "F4", section: "§2.5", pick: "Leaf to Leaf", paper: "Leaf to Leaf", properties: [], paperProperties: ["P5", "P4"] },
  ] },
  lab: {
    fig2: [{ label: "ECMP", predicted: 95, result: 90 }, { label: "Local only", predicted: 85, result: 80 }, { label: "CONGA", predicted: null, result: 100 }],
    fig2Why: "TCP slows the lower path, so it looks idle.",
    whyNot: "Stale feedback makes leaves herd.",
  },
  questions: null,
});

test("buildSummary: progress, Path to CONGA per fork, Lab Fig 2 vs results and both answers", () => {
  const t = buildSummary(fullData());
  assert.match(t, /Sections done: 3\/5 · active time: 42 min/);
  assert.match(t, /^- F1: Distributed \(paper: Distributed\) · you: P1, P5 · paper: P1, P5$/m);
  assert.match(t, /^- F2: Host-Based \(paper: In-Network\) · you: P2 · paper: P2, P4$/m);
  assert.match(t, /^- F3: not reached$/m);
  assert.match(t, /^- F4: Leaf to Leaf \(paper: Leaf to Leaf\) · you: – · paper: P5, P4$/m, "no properties named");
  assert.match(t, /ECMP: you 95, result 90/);
  assert.match(t, /CONGA: you –, result 100/);
  assert.match(t, /Why is local only worse\? TCP slows the lower path/);
  assert.match(t, /Why not\? Stale feedback/);
  assert.doesNotMatch(t, /Questions/, "skipped while step 09 isn't built");
});

test("buildSummary: nothing done yet still gives a readable summary", () => {
  const t = buildSummary({ done: 0, total: 5, seconds: 0, tutor: null, lab: null, questions: null });
  assert.match(t, /Sections done: 0\/5 · active time: 0 min/);
  assert.match(t, /Path to CONGA: not started/);
  assert.match(t, /Lab: not started/);
});

test("buildSummary: a questions score appears once that section exists", () => {
  assert.match(buildSummary({ ...fullData(), questions: { firstTry: 6, total: 8 } }), /Questions: 6\/8 right on the first try/);
});

test(`buildSummary: never longer than ${SUMMARY_MAX} characters; long answers are cut with '…'`, () => {
  const d = fullData();
  d.lab.fig2Why = "w".repeat(1500);
  d.lab.whyNot = "n".repeat(1500);
  const t = buildSummary(d);
  assert.ok(t.length <= SUMMARY_MAX, `${t.length}`);
  assert.match(t, /w…/);
  assert.match(t, /Sections done/, "the top is kept");
});

// ---------- collect: the store -> the summary's data ----------

test("collect: reads the sections' saved states through their own modules", () => {
  let tutor = T.start(T.initialState("sid-1"), "fallback", "disabled");
  tutor = T.fallbackAnswer(tutor, "distributed", ["P1", "P5"]).state;
  let lab = L.initialState();
  for (const [k, v] of [["ecmp", 95], ["localOnly", 85], ["conga", 100]]) lab = L.predict(lab, "fig2", k, v);
  lab = L.setAnswer(L.reveal(lab, "fig2", "all"), "fig2Why", "TCP slows the lower path.");
  const saved = { "hw:done": ["read", "watch"], "hw:time": 125, [T.STORE_KEY]: tutor, [L.STORE_KEY]: lab };
  const d = collect((k, fallback = null) => saved[k] ?? fallback);
  assert.equal(d.done, 2);
  assert.equal(d.total, 5);
  assert.equal(d.seconds, 125);
  assert.deepEqual(d.tutor.forks[0], { id: "F1", section: "§2.2", pick: "Distributed", paper: "Distributed", properties: ["P1", "P5"], paperProperties: ["P1", "P5"] });
  assert.deepEqual(d.tutor.forks[3].paperProperties, ["P5", "P4"], "CONGA Fig 1 answer key, from path/model.js");
  assert.equal(d.tutor.forks[1].pick, null);
  assert.deepEqual(d.lab.fig2.map((r) => [r.label, r.predicted, r.result]), [["ECMP", 95, 90], ["Local only", 85, 80], ["CONGA", 100, 100]], "CONGA §2.4, Fig 2: 90 / 80 / 100");
  assert.equal(d.lab.fig2Why, "TCP slows the lower path.");
  assert.equal(d.questions, null);
});

test("collect: an empty store gives an empty, valid summary", () => {
  const d = collect((k, fallback = null) => fallback);
  assert.equal(d.done, 0);
  assert.equal(d.tutor, null);
  assert.equal(d.lab, null);
  assert.ok(buildSummary(d).length > 20);
});

// ---------- payload ----------

test("payload: the Web3Forms fields; Reply-To is the student's email", () => {
  const p = payload({ key: "k-123", ...good, summary: "S" });
  assert.deepEqual(p, {
    access_key: "k-123",
    subject: "CONGA homework: Dana Levi",
    from_name: "CONGA homework site",
    name: "Dana Levi",
    email: "dana@post.bgu.ac.il",
    replyto: "dana@post.bgu.ac.il",
    question: good.question,
    summary: "S",
    botcheck: false,
  });
  assert.equal(payload({ key: "k", name: " Dana ", email: " d@x.io ", question: " q?  ", summary: "" }).subject, "CONGA homework: Dana", "trimmed");
});

// ---------- send (fetch mocked) ----------

const fakeFetch = (impl) => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return impl(url, init); };
  f.calls = calls;
  return f;
};
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("send: POSTs JSON to Web3Forms and reports success", async () => {
  const f = fakeFetch(() => reply(200, { success: true, body: { message: "Email sent successfully!" } }));
  const r = await send(payload({ key: "k", ...good, summary: "S" }), f);
  assert.deepEqual(r, { ok: true, message: "Email sent successfully!" });
  assert.equal(f.calls.length, 1, "no retries");
  assert.equal(f.calls[0].url, ENDPOINT);
  assert.equal(ENDPOINT, "https://api.web3forms.com/submit");
  assert.equal(f.calls[0].init.method, "POST");
  assert.equal(f.calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(f.calls[0].init.headers.Accept, "application/json");
  assert.equal(JSON.parse(f.calls[0].init.body).email, good.email);
});

test("send: success:false shows Web3Forms' message (top level or in body)", async () => {
  let r = await send(payload({ key: "bad", ...good, summary: "" }), fakeFetch(() => reply(400, { success: false, body: { message: "Invalid access key" } })));
  assert.deepEqual(r, { ok: false, message: "Invalid access key" });
  r = await send(payload({ key: "k", ...good, summary: "" }), fakeFetch(() => reply(429, { success: false, message: "Too may requests. Please try later!" })));
  assert.equal(r.ok, false);
  assert.match(r.message, /Too may requests/);
  r = await send(payload({ key: "k", ...good, summary: "" }), fakeFetch(() => reply(500, { statusCode: 500, error: "Something went wrong on server." })));
  assert.equal(r.ok, false);
  assert.match(r.message, /Something went wrong/);
});

test("send: a network error or a non-JSON reply is a clear failure, never a throw", async () => {
  let r = await send(payload({ key: "k", ...good, summary: "" }), fakeFetch(() => { throw new TypeError("Failed to fetch"); }));
  assert.equal(r.ok, false);
  assert.match(r.message, /couldn't reach|connection/i);
  r = await send(payload({ key: "k", ...good, summary: "" }), fakeFetch(() => ({ ok: false, status: 502, json: async () => { throw new SyntaxError("bad json"); } })));
  assert.equal(r.ok, false);
  assert.match(r.message, /502/);
});

test("send: no key configured, or the honeypot filled: nothing is sent", async () => {
  const f = fakeFetch(() => reply(200, { success: true }));
  let r = await send(payload({ key: "", ...good, summary: "" }), f);
  assert.equal(r.ok, false);
  assert.match(r.message, /not set up/i);
  r = await send({ ...payload({ key: "k", ...good, summary: "" }), botcheck: true }, f);
  assert.equal(r.ok, false);
  assert.equal(f.calls.length, 0);
});

test("collect: the tutor opening by itself (no answer, no message) is 'Path to CONGA: not started'", () => {
  const opened = T.start(T.initialState("sid-2"), "live"); // what every page load does
  const d = collect((k, fallback = null) => (k === T.STORE_KEY ? opened : fallback));
  assert.equal(d.tutor, null);
  assert.match(buildSummary(d), /^Path to CONGA: not started$/m);
  const said = T.addStudent(opened, "I'd pick Distributed.");
  assert.notEqual(collect((k, fallback = null) => (k === T.STORE_KEY ? said : fallback)).tutor, null, "one message = started");
});

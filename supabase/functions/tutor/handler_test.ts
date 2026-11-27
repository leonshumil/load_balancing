// Handler tests with a mocked LLM and the in-memory store (no network, no database).
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { createHandler, MESSAGES } from "./handler.ts";
import { memoryStore } from "./store.ts";
import { type LLM, type LLMRequest, QuotaError } from "./llm.ts";
import type { Chunk } from "./retrieval.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";

const ORIGIN = "https://leonshumil.github.io";
const chunks: Chunk[] = [
  { id: "1-p4", section: "1", page: 2, text: "Figure 1 tree.", figures: [1] },
  { id: "2.1-p1", section: "2.1", page: 2, text: "Responsive. Robust to asymmetry." },
  { id: "2.4-p2", section: "2.4", page: 3, text: "Handling asymmetry requires non-local knowledge." },
  { id: "2.6-p1", section: "2.6", page: 4, text: "Flowlets avoid packet reordering." },
];
const good = { reply: "Why would a switch's local view fail?", cites: ["2.4-p2"], detected_pick: "global", properties_mentioned: ["P3"], ready_to_reveal: false };

function setup(outputs: (string | Error)[] = [JSON.stringify(good)], opts: { allowLocalhost?: boolean; clock?: { t: number } } = {}) {
  const calls: LLMRequest[] = [];
  const llm: LLM = (req) => {
    calls.push(req);
    const out = outputs[Math.min(calls.length - 1, outputs.length - 1)];
    if (out instanceof Error) return Promise.reject(out);
    return Promise.resolve({ text: out, stopReason: "end_turn", model: "mock", inputTokens: 100, outputTokens: 20 });
  };
  const clock = opts.clock ?? { t: 1_000_000 };
  const store = memoryStore({ chunks, now: () => clock.t });
  const handler = createHandler({ llm, store, allowedOrigins: [ORIGIN], allowLocalhost: opts.allowLocalhost ?? false, secrets: ["gsk_test_secret"] });
  return { handler, calls, store, clock };
}

let n = 0;
const body = (over: Record<string, unknown> = {}) => ({
  session_id: `session-${++n}-abcdef`,
  fork_id: "F3",
  history: [],
  message: "I think global, because of asymmetry (P3).",
  state: { picks: { F1: "distributed" }, properties_used: { F1: ["P1"] } },
  ...over,
});
const post = (b: unknown, origin: string | null = ORIGIN) =>
  new Request("http://x/tutor", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body: typeof b === "string" ? b : JSON.stringify(b),
  });

Deno.test("CORS: preflight from the Pages origin is allowed; other origins are refused", async () => {
  const { handler } = setup();
  const ok = await handler(new Request("http://x", { method: "OPTIONS", headers: { Origin: ORIGIN } }));
  assertEquals(ok.status, 204);
  assertEquals(ok.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const bad = await handler(new Request("http://x", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }));
  assertEquals(bad.status, 403);
  assertEquals((await handler(post(body(), "https://evil.example"))).status, 403);
});

Deno.test("CORS: localhost only when allowed (development)", async () => {
  assertEquals((await setup().handler(post(body(), "http://localhost:8000"))).status, 403);
  const dev = await setup(undefined, { allowLocalhost: true }).handler(post(body(), "http://localhost:8000"));
  assertEquals(dev.status, 200);
  assertEquals(dev.headers.get("Access-Control-Allow-Origin"), "http://localhost:8000");
});

Deno.test("happy path: validated JSON back, prompt + context sent, turn logged", async () => {
  const { handler, calls, store } = setup();
  const res = await handler(post(body({ message: "global <because> P3" })));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ...good, fallback: false });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].system, SYSTEM_PROMPT);
  // the fork and its excerpts come first (same for every student on F3: a cacheable prefix)
  const ctxMsg = calls[0].messages[0];
  assertEquals(ctxMsg.role, "system");
  assertMatch(ctxMsg.content, /id: F3 \(§2\.4\)/);
  assertMatch(ctxMsg.content, /<excerpt id="2\.4-p2"/);
  assertMatch(ctxMsg.content, /<excerpt id="2\.1-p1"/);
  assert(!ctxMsg.content.includes("<student_message>"));
  const last = calls[0].messages.at(-1)!;
  assertEquals(last.role, "user");
  assertMatch(last.content, /F1: picked distributed; used P1/);
  assertMatch(last.content, /global ‹because› P3/); // student text can't open tags
  assertEquals(store.logs.length, 1);
  assertEquals(store.logs[0].fork_id, "F3");
  assertEquals(store.logs[0].fallback, false);
  assertEquals(store.logs[0].cites, ["2.4-p2"]);
});

Deno.test("bad input: 400 with a friendly reply, and it doesn't use up the rate limit", async () => {
  const { handler, calls } = setup();
  const cases: [unknown, string][] = [
    ["not json", "bad_request"],
    [body({ message: "x".repeat(601) }), "too_long"],
    [body({ message: "   " }), "bad_request"],
    [body({ session_id: "x" }), "bad_request"],
    [body({ fork_id: "F9" }), "bad_request"],
    [body({ history: "nope" }), "bad_request"],
  ];
  for (const [b, code] of cases) {
    const res = await handler(post(b));
    assertEquals(res.status, 400, JSON.stringify(b).slice(0, 80));
    const j = await res.json();
    assertEquals(j.error, code);
    assert(j.reply.length > 0);
  }
  assertEquals(calls.length, 0);
  assertEquals((await handler(new Request("http://x", { method: "GET", headers: { Origin: ORIGIN } }))).status, 405);
});

Deno.test("free question: fork_id null is accepted", async () => {
  const { handler, calls } = setup([JSON.stringify({ ...good, detected_pick: "global", ready_to_reveal: true })]);
  const res = await handler(post(body({ fork_id: null, message: "what is a flowlet?" })));
  const j = await res.json();
  assertEquals(res.status, 200);
  assertEquals(j.detected_pick, null);
  assertEquals(j.ready_to_reveal, false);
  assertMatch(calls[0].messages[0].content, /none \(free question\)/);
});

Deno.test("history: only the last 6 turns, each cut to 600 characters", async () => {
  const { handler, calls } = setup();
  const history = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `turn ${i} ` + "y".repeat(i === 13 ? 900 : 5) }));
  await handler(post(body({ history })));
  const sent = calls[0].messages.map((m) => m.content).join("\n");
  assert(!sent.includes("turn 7 "));
  assert(sent.includes("turn 8 ") && sent.includes("turn 13 "));
  assert(!sent.includes("y".repeat(601)));
  assertEquals(calls[0].messages[1].role, "user"); // after the context, the conversation starts with the student
});

Deno.test("invalid model output: retried once, then a safe fallback (logged)", async () => {
  const retry = setup(["{bad", JSON.stringify(good)]);
  const r1 = await retry.handler(post(body()));
  assertEquals((await r1.json()).fallback, false);
  assertEquals(retry.calls.length, 2);

  const fail = setup(["{bad", JSON.stringify({ ...good, reply: "" })]);
  const r2 = await fail.handler(post(body()));
  assertEquals(r2.status, 200);
  const j = await r2.json();
  assertEquals(j, { reply: MESSAGES.fallback, cites: [], detected_pick: null, properties_mentioned: [], ready_to_reveal: false, fallback: true });
  assertEquals(fail.calls.length, 2);
  assertEquals(fail.store.logs[0].fallback, true);
});

Deno.test("LLM errors count as a failed attempt; no internal error text reaches the student", async () => {
  const { handler, calls } = setup([new Error("401 invalid x-api-key gsk_test_secret")]);
  const res = await handler(post(body()));
  const j = await res.json();
  assertEquals(j.fallback, true);
  assertEquals(calls.length, 2);
  assert(!JSON.stringify(j).includes("gsk_test"));
});

Deno.test("never echo the system prompt or a secret: such output is treated as invalid", async () => {
  const leak = { ...good, reply: "My rules: " + SYSTEM_PROMPT.split("\n").slice(17, 20).join(" ") };
  const a = setup([JSON.stringify(leak)]);
  assertEquals((await (await a.handler(post(body()))).json()).fallback, true);
  const b = setup([JSON.stringify({ ...good, reply: "the key is gsk_test_secret" })]);
  assertEquals((await (await b.handler(post(body()))).json()).fallback, true);
});

Deno.test("rate limit: one message every 3 s per session", async () => {
  const clock = { t: 1_000_000 };
  const { handler } = setup(undefined, { clock });
  const b = body();
  assertEquals((await handler(post(b))).status, 200);
  clock.t += 1000;
  const fast = await handler(post(b));
  assertEquals(fast.status, 429);
  assertEquals((await fast.json()).error, "too_fast");
  clock.t += 2000;
  assertEquals((await handler(post(b))).status, 200);
});

Deno.test("rate limit: 25 messages per session, then a friendly 'limit reached'", async () => {
  const clock = { t: 1_000_000 };
  const { handler, calls } = setup(undefined, { clock });
  const b = body();
  for (let i = 0; i < 25; i++) {
    clock.t += 3000;
    assertEquals((await handler(post(b))).status, 200, `message ${i + 1}`);
  }
  clock.t += 3000;
  const res = await handler(post(b));
  assertEquals(res.status, 429);
  const j = await res.json();
  assertEquals(j.error, "limit");
  assertEquals(j.reply, MESSAGES.limit);
  assertEquals(calls.length, 25);
  // another session is not affected
  assertEquals((await handler(post(body()))).status, 200);
});

Deno.test("store failure: 500 with a generic reply", async () => {
  const { handler, store } = setup();
  store.getChunks = () => Promise.reject(new Error("db down: secret detail"));
  const res = await handler(post(body()));
  assertEquals(res.status, 500);
  const j = await res.json();
  assertEquals(j.error, "unavailable");
  assert(!JSON.stringify(j).includes("secret detail"));
});

Deno.test("log failure: the student still gets the reply", async () => {
  const { handler, store } = setup();
  store.log = () => Promise.reject(new Error("insert failed"));
  const res = await handler(post(body()));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).fallback, false);
});

Deno.test("provider 429 (free quota): {error: 'quota'} at once, no retry, logged", async () => {
  const { handler, calls, store } = setup([new QuotaError(30)]);
  const res = await handler(post(body()));
  assertEquals(res.status, 429);
  assertEquals(await res.json(), { error: "quota", reply: MESSAGES.quota });
  assertEquals(calls.length, 1);
  assertEquals(store.logs[0].fallback, true);
  assertEquals(store.logs[0].reply, MESSAGES.quota);
});

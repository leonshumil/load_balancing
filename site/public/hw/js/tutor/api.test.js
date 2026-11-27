// Tutor API client: 20 s timeout, one retry, error kinds the page switches on (step 12).
import { test } from "node:test";
import assert from "node:assert/strict";
import { askTutor, fetchPassage, FALLBACK_KINDS } from "./api.js";

const ok = (data) => () => Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
const status = (code, body = {}) => () => Promise.resolve(new Response(JSON.stringify(body), { status: code }));
function seq(...fns) {
  let i = 0;
  const calls = [];
  const f = (url, init) => { calls.push({ url, init }); return fns[Math.min(i++, fns.length - 1)](url, init); };
  f.calls = calls;
  return f;
}
const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));

test("ok: POSTs JSON to the URL and returns the reply", async () => {
  const f = seq(ok({ reply: "hi", fallback: false }));
  const r = await askTutor("https://x/tutor", { message: "m" }, { fetchImpl: f });
  assert.deepEqual(r, { ok: true, data: { reply: "hi", fallback: false } });
  assert.equal(f.calls[0].init.method, "POST");
  assert.equal(JSON.parse(f.calls[0].init.body).message, "m");
});

test("4xx/429 map to kinds and are not retried", async () => {
  const cases = [[401, "class_code"], [429, "quota"], [429, "limit"], [429, "too_fast"], [400, "too_long"], [400, "bad_request"]];
  for (const [code, kind] of cases) {
    const f = seq(status(code, { error: kind, reply: "r" }));
    const r = await askTutor("u", {}, { fetchImpl: f });
    assert.deepEqual([r.ok, r.kind, r.reply], [false, kind, "r"], kind);
    assert.equal(f.calls.length, 1, kind);
  }
});

test("5xx or a network error: one retry, then 'unavailable' / 'network'", async () => {
  const twice5 = seq(status(500, { error: "unavailable" }), status(503));
  assert.equal((await askTutor("u", {}, { fetchImpl: twice5 })).kind, "unavailable");
  assert.equal(twice5.calls.length, 2);
  const net = seq(() => Promise.reject(new TypeError("Failed to fetch")), ok({ reply: "second time lucky" }));
  const r = await askTutor("u", {}, { fetchImpl: net });
  assert.equal(r.ok, true);
  assert.equal(net.calls.length, 2);
});

test("timeout: aborts after timeoutMs, retries once, then 'timeout'", async () => {
  const f = seq(hang, hang);
  const t0 = Date.now();
  const r = await askTutor("u", {}, { fetchImpl: f, timeoutMs: 50 });
  assert.equal(r.kind, "timeout");
  assert.equal(f.calls.length, 2);
  assert.ok(Date.now() - t0 >= 100);
});

test("the default timeout is 20 s (replies take 2-5 s)", async () => {
  const { TIMEOUT_MS } = await import("./api.js");
  assert.equal(TIMEOUT_MS, 20_000);
});

test("which failures switch the page to guided mode", () => {
  assert.deepEqual([...FALLBACK_KINDS].sort(), ["class_code", "limit", "network", "quota", "timeout", "unavailable"]);
});

test("fetchPassage: action passage with the class code", async () => {
  const f = seq(ok({ id: "2.4-p2", section: "2.4", page: 3, text: "t" }));
  const r = await fetchPassage("u", "code", "2.4-p2", { fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(r.data.text, "t");
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { action: "passage", class_code: "code", id: "2.4-p2" });
});

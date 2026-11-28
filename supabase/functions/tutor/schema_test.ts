import { assert, assertEquals } from "jsr:@std/assert@1";
import { OUTPUT_SCHEMA, parseOutput } from "./schema.ts";
import { BRANCH_IDS } from "./forks.ts";

const ctx = { forkId: "F3", citable: ["2.1-p1", "2.4-p2"] };
const good = { reply: "Which property breaks first?", cites: ["2.4-p2"], detected_pick: "global", properties_mentioned: ["P3"], ready_to_reveal: false };
const raw = (o: unknown) => JSON.stringify(o);

Deno.test("schema: the approved shape, strict, every key required", () => {
  assertEquals(OUTPUT_SCHEMA.required.sort(), ["cites", "detected_pick", "properties_mentioned", "ready_to_reveal", "reply"]);
  assertEquals(OUTPUT_SCHEMA.additionalProperties, false);
  assertEquals(OUTPUT_SCHEMA.properties.detected_pick.anyOf[0].enum, BRANCH_IDS);
});

Deno.test("parseOutput: accepts good output unchanged", () => {
  const r = parseOutput(raw(good), ctx);
  assert(r.ok);
  assertEquals(r.value, good);
});

Deno.test("parseOutput: rejects invalid JSON, missing keys, wrong types, extra keys", () => {
  const bad = [
    "not json",
    raw({ ...good, reply: undefined }),
    raw({ ...good, cites: "2.4-p2" }),
    raw({ ...good, ready_to_reveal: "yes" }),
    raw({ ...good, properties_mentioned: ["P7"] }),
    raw({ ...good, detected_pick: 3 }),
    raw({ ...good, extra: 1 }),
    raw([good]),
  ];
  for (const b of bad) assert(!parseOutput(b, ctx).ok, b);
});

Deno.test("parseOutput: rejects an empty or over-long reply (>1000 chars)", () => {
  assert(!parseOutput(raw({ ...good, reply: "  " }), ctx).ok);
  assert(!parseOutput(raw({ ...good, reply: "x".repeat(1001) }), ctx).ok);
});

Deno.test("parseOutput: cleans instead of rejecting (unknown cites, pick outside the fork, repeats)", () => {
  const r = parseOutput(raw({ ...good, cites: ["2.4-p2", "9.9-p1", "2.4-p2"], detected_pick: "per-flowlet", properties_mentioned: ["P3", "P3", "P1"] }), ctx);
  assert(r.ok);
  assertEquals(r.value.cites, ["2.4-p2"]);
  assertEquals(r.value.detected_pick, null);
  assertEquals(r.value.properties_mentioned, ["P1", "P3"]);
  assertEquals(r.dropped, { cites: ["9.9-p1"], pick: "per-flowlet" });
});

Deno.test("parseOutput: free question (no fork) never has a pick or a reveal", () => {
  const r = parseOutput(raw({ ...good, ready_to_reveal: true }), { forkId: null, citable: ["2.4-p2"] });
  assert(r.ok);
  assertEquals(r.value.detected_pick, null);
  assertEquals(r.value.ready_to_reveal, false);
});

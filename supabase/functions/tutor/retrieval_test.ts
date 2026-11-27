// deno test supabase/functions/tutor
import { assert, assertEquals } from "jsr:@std/assert@1";
import { bm25Search, buildIndex, compareChunkIds, selectContext, tokenize, type Chunk } from "./retrieval.ts";
import { FORKS } from "./forks.ts";

const words = (n: number, w = "word") => Array.from({ length: n }, () => w).join(" ");
const chunk = (id: string, text: string, extra: Partial<Chunk> = {}): Chunk => ({ id, section: id.split("-p")[0], page: 1, text, ...extra });

Deno.test("tokenize: lowercase, no stopwords, light stemming (reordering ~ reordered ~ reorder)", () => {
  assertEquals(tokenize("The Reordering of packets"), ["reorder", "packet"]);
  assertEquals(tokenize("reordered"), ["reorder"]);
  assertEquals(tokenize("Leaf-to-leaf feedback"), ["leaf", "leaf", "feedback"]);
});

Deno.test("chunk ids sort in paper order (2.6-p1 < 2.6.1-p1 < 2.10-p1, p2 < p10)", () => {
  const ids = ["2.10-p1", "2.6.1-p1", "abstract-p1", "2.6-p10", "2.6-p2", "1-p1"];
  assertEquals([...ids].sort(compareChunkIds), ["abstract-p1", "1-p1", "2.6-p2", "2.6-p10", "2.6.1-p1", "2.10-p1"]);
});

const synthetic: Chunk[] = [
  chunk("1-p1", "ECMP hashes flows to paths. " + words(50)),
  chunk("1-p4", "Figure 1 design space tree. " + words(50), { figures: [1] }),
  chunk("1-p5", "General link state routing is an N-party protocol. " + words(50)),
  chunk("2.1-p1", "Responsive. Transport independent. Robust to asymmetry. " + words(50)),
  chunk("2.2-p1", "Centralized schedulers are too slow. " + words(50)),
  chunk("2.3-p1", "MPTCP at the end host increases incast. " + words(50)),
  chunk("2.4-p1", "Local schemes fail under asymmetry. " + words(50)),
  chunk("2.5-p1", "Leaf to leaf feedback via the overlay. " + words(50)),
  chunk("2.6-p1", "Flowlets avoid packet reordering when the gap is large. " + words(50)),
  chunk("2.6.1-p1", "Flowlet sizes in production traces. " + words(50)),
  chunk("3.4-p1", "Flowlet detection table and timeout. " + words(50)),
];

Deno.test("BM25: 'reordering' ranks §2.6 first (synthetic)", () => {
  const hits = bm25Search(buildIndex(synthetic), "why does packet reordering matter?", 3);
  assertEquals(hits[0].id, "2.6-p1");
});

Deno.test("selectContext: every fork gets §2.1 and the Figure 1 chunk, then its own sections (CONGA §2.2-§2.6)", () => {
  const expected: Record<string, string[]> = {
    F1: ["2.2-p1"], F2: ["2.3-p1"], F3: ["2.4-p1"], F4: ["1-p5", "2.5-p1"], F5: ["2.6-p1", "2.6.1-p1"],
  };
  for (const [fork, own] of Object.entries(expected)) {
    const ids = selectContext(synthetic, fork, "").chunks.map((c) => c.id);
    for (const id of ["2.1-p1", "1-p4", ...own]) assert(ids.includes(id), `${fork} should include ${id}: ${ids}`);
    // sections of other forks are not pulled in without a matching message
    for (const [other, theirs] of Object.entries(expected)) {
      if (other === fork) continue;
      for (const id of theirs) if (!own.includes(id)) assert(!ids.includes(id), `${fork} should not include ${id}`);
    }
  }
});

Deno.test("selectContext: on a fork turn BM25 adds at most one new chunk, kept apart from the fork's base", () => {
  const ctx = selectContext(synthetic, "F1", "what about flowlet detection timeouts?");
  assertEquals(ctx.extra.map((c) => c.id), ["3.4-p1"]);
  assert(!ctx.base.some((c) => c.id === "3.4-p1"));
  assertEquals(ctx.chunks.map((c) => c.id), [...ctx.base, ...ctx.extra].map((c) => c.id));
  // a hit already in the base is not repeated, and doesn't use up the one slot
  const again = selectContext(synthetic, "F1", "centralized schedulers flowlet detection");
  assertEquals(again.extra.map((c) => c.id), ["3.4-p1"]);
});

Deno.test("selectContext: the base for a fork doesn't depend on the message (cacheable prefix)", () => {
  const a = selectContext(synthetic, "F5", "reordering").base.map((c) => c.id);
  const b = selectContext(synthetic, "F5", "something else entirely about MPTCP").base.map((c) => c.id);
  assertEquals(a, b);
});

Deno.test("selectContext: free question (no fork) is §2.1 + Figure 1 + up to 3 BM25 hits", () => {
  const ctx = selectContext(synthetic, null, "MPTCP incast flowlet reordering link state");
  assertEquals(ctx.base.map((c) => c.id).sort(), ["1-p4", "2.1-p1"]);
  assert(ctx.extra.length >= 1 && ctx.extra.length <= 3);
  assert(ctx.extra.some((c) => c.id === "2.3-p1"));
});

Deno.test("selectContext: never more than MAX_WORDS (1,400) of paper", () => {
  const big = Array.from({ length: 30 }, (_, i) => chunk(`2.2-p${i + 1}`, "centralized " + words(199)));
  const ctx = selectContext([...synthetic, ...big], "F1", "centralized");
  assert(ctx.words <= 1400, String(ctx.words));
  assert(ctx.chunks.some((c) => c.id === "2.1-p1"));
});

Deno.test("selectContext: unknown fork throws", () => {
  let threw = false;
  try { selectContext(synthetic, "F9", ""); } catch { threw = true; }
  assert(threw);
});

// ---- against the real paper chunks, when they have been built locally (gitignored) ----
let real: Chunk[] | null = null;
try {
  real = JSON.parse(await Deno.readTextFile(new URL("../../../tools/.out/chunks.json", import.meta.url)));
} catch { /* not built */ }

Deno.test({ name: "CONGA chunks: BM25 finds §2.6 for 'reordering'", ignore: !real, fn: () => {
  const hits = bm25Search(buildIndex(real!), "reordering", 3);
  assert(hits.some((h) => h.section.startsWith("2.6")), hits.map((h) => h.id).join(","));
} });

Deno.test({ name: "CONGA chunks: F4's extra chunk is §1's link-state paragraph", ignore: !real, fn: () => {
  const c = real!.find((x) => x.id === FORKS.F4.extraChunks[0]);
  assert(c && /link state/.test(c.text) && /leaf-to-leaf/.test(c.text), c?.text.slice(0, 80));
} });

Deno.test({ name: "CONGA chunks: each fork's context holds its sections, §2.1 and Figure 1, within 1,400 words", ignore: !real, fn: () => {
  for (const [id, f] of Object.entries(FORKS)) {
    const ctx = selectContext(real!, id, "");
    const secs = new Set(ctx.chunks.map((c) => c.section));
    assert(secs.has("2.1"), id);
    for (const s of f.sections) assert(secs.has(s), `${id} ${s}`);
    assert(ctx.chunks.some((c) => c.figures?.includes(1)), `${id} fig 1`);
    assert(ctx.words <= 1400, `${id} ${ctx.words}`);
  }
} });

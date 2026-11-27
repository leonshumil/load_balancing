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
    F1: ["2.2-p1"], F2: ["2.3-p1"], F3: ["2.4-p1"], F4: ["1-p1", "2.5-p1"], F5: ["2.6-p1", "2.6.1-p1"],
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

Deno.test("selectContext: BM25 adds chunks for the student's message after the fork's sections", () => {
  const ids = selectContext(synthetic, "F1", "what about flowlet detection timeouts?").chunks.map((c) => c.id);
  assert(ids.includes("3.4-p1"), ids.join(","));
  assert(ids.indexOf("2.2-p1") < ids.indexOf("3.4-p1"));
});

Deno.test("selectContext: free question (no fork) is §2.1 + Figure 1 + BM25", () => {
  const ids = selectContext(synthetic, null, "MPTCP incast").chunks.map((c) => c.id);
  assertEquals(ids.slice(0, 2).sort(), ["1-p4", "2.1-p1"]);
  assert(ids.includes("2.3-p1"));
});

Deno.test("selectContext: never more than ~2,500 words", () => {
  const big = Array.from({ length: 30 }, (_, i) => chunk(`2.2-p${i + 1}`, "centralized " + words(199)));
  const ctx = selectContext([...synthetic, ...big], "F1", "centralized");
  assert(ctx.words <= 2500, String(ctx.words));
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

Deno.test({ name: "CONGA chunks: each fork's context holds its sections, §2.1 and Figure 1, within 2,500 words", ignore: !real, fn: () => {
  for (const [id, f] of Object.entries(FORKS)) {
    const ctx = selectContext(real!, id, "");
    const secs = new Set(ctx.chunks.map((c) => c.section));
    assert(secs.has("2.1"), id);
    for (const s of f.sections) assert(secs.has(s), `${id} ${s}`);
    assert(ctx.chunks.some((c) => c.figures?.includes(1)), `${id} fig 1`);
    assert(ctx.words <= 2500, `${id} ${ctx.words}`);
  }
} });

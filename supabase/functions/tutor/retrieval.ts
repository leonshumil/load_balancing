// Deterministic retrieval for the tutor (step 11). No embeddings:
// 1. always §2.1 (the five properties) and the Figure 1 chunk,
// 2. the current fork's sections (F1 §2.2, F2 §2.3, F3 §2.4, F4 §1 + §2.5, F5 §2.6 incl. 2.6.x),
// 3. BM25 over all chunks for the student's message,
// in that order, up to MAX_WORDS of paper text.
import { FORKS } from "./forks.ts";

export type Chunk = { id: string; section: string; page: number; text: string; figures?: number[] };

export const MAX_WORDS = 2500;
const BM25_HITS = 4;
const K1 = 1.2;
const B = 0.75;

const STOP = new Set(
  ("a an and are as at be been but by can could do does did for from has have how i if in into is it its " +
    "of on or so than that the their them then there these they this to was we were what when where which " +
    "while who why will with would you your not no yes about also just only more most such each both other " +
    "e g ie eg vs")
    .split(" "),
);

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Paper order: abstract first, then section numbers numerically, then p1, p2, ... */
export function compareChunkIds(a: string, b: string): number {
  const key = (id: string) => {
    const [sec, p] = id.split("-p");
    const nums = sec === "abstract" ? [-1] : sec.split(".").map(Number);
    return { nums, p: Number(p) };
  };
  const ka = key(a), kb = key(b);
  for (let i = 0; i < Math.max(ka.nums.length, kb.nums.length); i++) {
    const x = ka.nums[i] ?? -Infinity, y = kb.nums[i] ?? -Infinity;
    if (x !== y) return x - y;
  }
  return ka.p - kb.p;
}

export type Index = { chunks: Chunk[]; docs: Map<string, number>[]; lengths: number[]; avg: number; df: Map<string, number> };

export function buildIndex(chunks: Chunk[]): Index {
  const docs = chunks.map((c) => {
    const tf = new Map<string, number>();
    for (const t of tokenize(c.text)) tf.set(t, (tf.get(t) ?? 0) + 1);
    return tf;
  });
  const lengths = docs.map((d) => [...d.values()].reduce((a, b) => a + b, 0));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avg = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
  return { chunks, docs, lengths, avg, df };
}

/** Top-k chunks by BM25 for `query` (score > 0 only). */
export function bm25Search(index: Index, query: string, k = BM25_HITS): Chunk[] {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const N = index.chunks.length;
  const scored = index.docs.map((tf, i) => {
    let score = 0;
    for (const t of terms) {
      const f = tf.get(t);
      if (!f) continue;
      const n = index.df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * index.lengths[i] / index.avg));
    }
    return { i, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || compareChunkIds(index.chunks[a.i].id, index.chunks[b.i].id))
    .slice(0, k)
    .map((s) => index.chunks[s.i]);
}

const inSection = (c: Chunk, s: string) => c.section === s || c.section.startsWith(s + ".");

let cached: { chunks: Chunk[]; index: Index } | null = null;
function indexFor(chunks: Chunk[]): Index {
  if (cached?.chunks !== chunks) cached = { chunks, index: buildIndex(chunks) };
  return cached.index;
}

/**
 * Pick the paper text for one tutor turn.
 * forkId null = a free question (no fork): §2.1 + Figure 1 + BM25.
 */
export function selectContext(chunks: Chunk[], forkId: string | null, message: string, maxWords = MAX_WORDS) {
  if (forkId !== null && !FORKS[forkId]) throw new Error(`unknown fork: ${forkId}`);
  const sorted = [...chunks].sort((a, b) => compareChunkIds(a.id, b.id));
  const always = sorted.filter((c) => inSection(c, "2.1") || c.figures?.includes(1));
  const own = forkId ? sorted.filter((c) => FORKS[forkId].sections.some((s) => inSection(c, s))) : [];
  const hits = bm25Search(indexFor(chunks), message, forkId ? BM25_HITS : BM25_HITS + 2);

  const picked: Chunk[] = [];
  let words = 0;
  for (const c of [...always, ...own, ...hits]) {
    if (picked.includes(c)) continue;
    const w = wordCount(c.text);
    if (words + w > maxWords) continue;
    picked.push(c);
    words += w;
  }
  return { chunks: picked, words };
}

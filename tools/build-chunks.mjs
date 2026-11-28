#!/usr/bin/env node
// Split the CONGA paper (docs/papers/conga.md, private repo) into section chunks of
// ~150-300 words for the tutor: { id: "2.4-p2", section: "2.4", page, text, figures? }.
// `figures` lists the hand-transcribed figures a chunk holds (e.g. [1] for Figure 1).
// Writes tools/.out/chunks.json (gitignored: paper text stays out of the public repo).
//
//   node tools/build-chunks.mjs [path/to/conga.md] [out.json]
//
// Also exports the pure splitter for tests (tools/build-chunks.test.mjs).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIN_WORDS = 150;
const MAX_WORDS = 300;

// Hand-transcribed figures go with the section that argues from them.
const FIGURE_SECTION = { 1: "1", 2: "2.4", 3: "2.4", 4: "2.5" };

// Front-matter and boilerplate paragraphs the tutor never needs.
const SKIP = [/^Categories and Subject Descriptors/, /^Permission to make digital/, /^SIGCOMM’14/, /^Copyright 20\d\d ACM/, /^http:\/\/dx\.doi\.org/];

const words = (s) => s.split(/\s+/).filter(Boolean).length;

/** Split one over-long paragraph at sentence ends into pieces of at most MAX_WORDS. */
function splitLong(text) {
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [text];
  const out = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && words(cur) + words(s) > MAX_WORDS) { out.push(cur.trim()); cur = ""; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Parse the paper markdown into blocks { section, page, text }, in order.
 * Skips ```text``` figure fragments, the references, and boilerplate.
 */
export function parseBlocks(md) {
  const lines = md.split("\n");
  const blocks = [];
  let section = null; // nothing before the first heading (title, authors, converter note)
  let page = 1;
  let para = [];
  let inFence = false;
  let stop = false;

  const flush = (sec = section, figure = null) => {
    const text = para.join(" ").replace(/\s+/g, " ").trim();
    para = [];
    if (!text || !sec || SKIP.some((re) => re.test(text))) return;
    blocks.push({ section: sec, page, text, ...(figure ? { figure } : {}) });
  };

  for (let i = 0; i < lines.length && !stop; i++) {
    const line = lines[i];
    if (line.startsWith("```")) { flush(); inFence = !inFence; continue; }
    if (inFence) continue;
    const pg = line.match(/^<!-- page (\d+) -->/);
    if (pg) { flush(); page = Number(pg[1]); continue; }
    const h = line.match(/^#{2,4} (?:(\d+(?:\.\d+)*) )?(.*)$/);
    if (h) {
      flush();
      if (/^References$/i.test(h[2]) || h[1] === "10") { stop = true; break; }
      section = h[1] ?? (/abstract/i.test(h[2]) ? "abstract" : section);
      continue;
    }
    if (line.startsWith("# ")) continue; // title
    // A hand transcription of a figure: one blockquote, filed under its section.
    const fig = line.match(/^> \*\*Figure (\d+)/);
    if (fig) {
      flush();
      const quote = [];
      while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
      i--;
      para = quote.filter((l) => l.trim());
      flush(FIGURE_SECTION[fig[1]] ?? section, Number(fig[1]));
      continue;
    }
    if (line.startsWith(">")) { flush(); continue; } // other blockquotes are editor notes
    if (!line.trim()) { flush(); continue; }
    para.push(line);
  }
  flush();
  return blocks;
}

/** Group blocks of the same section into chunks of ~MIN..MAX words. */
export function chunkBlocks(blocks) {
  const chunks = [];
  const counter = new Map();
  let cur = null;
  const emit = () => {
    if (!cur) return;
    const n = (counter.get(cur.section) ?? 0) + 1;
    counter.set(cur.section, n);
    const chunk = { id: `${cur.section}-p${n}`, section: cur.section, page: cur.page, text: cur.parts.join("\n\n") };
    if (cur.figures.length) chunk.figures = cur.figures;
    chunks.push(chunk);
    cur = null;
  };
  for (const b of blocks) {
    for (const piece of words(b.text) > MAX_WORDS ? splitLong(b.text) : [b.text]) {
      if (cur && (cur.section !== b.section || words(cur.parts.join(" ")) + words(piece) > MAX_WORDS)) emit();
      if (!cur) cur = { section: b.section, page: b.page, parts: [], figures: [] };
      cur.parts.push(piece);
      if (b.figure && !cur.figures.includes(b.figure)) cur.figures.push(b.figure);
      if (words(cur.parts.join(" ")) >= MIN_WORDS) emit();
    }
  }
  emit();
  // Merge a short tail into the previous chunk of the same section when it fits.
  for (let i = chunks.length - 1; i > 0; i--) {
    const a = chunks[i - 1], b = chunks[i];
    if (a.section === b.section && words(b.text) < MIN_WORDS / 2 && words(a.text) + words(b.text) <= MAX_WORDS + 60) {
      a.text += "\n\n" + b.text;
      if (b.figures) a.figures = [...new Set([...(a.figures ?? []), ...b.figures])];
      chunks.splice(i, 1);
    }
  }
  // Renumber ids after merging so they stay p1, p2, ... per section.
  const seen = new Map();
  for (const c of chunks) {
    const n = (seen.get(c.section) ?? 0) + 1;
    seen.set(c.section, n);
    c.id = `${c.section}-p${n}`;
  }
  return chunks;
}

export const buildChunks = (md) => chunkBlocks(parseBlocks(md));

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const src = process.argv[2] ?? resolve(root, "docs/papers/conga.md");
  const out = process.argv[3] ?? resolve(root, "tools/.out/chunks.json");
  const chunks = buildChunks(readFileSync(src, "utf8"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(chunks, null, 1) + "\n");
  const bySection = {};
  for (const c of chunks) bySection[c.section] = (bySection[c.section] ?? 0) + 1;
  const w = chunks.map((c) => words(c.text));
  console.log(`${chunks.length} chunks, ${Math.min(...w)}-${Math.max(...w)} words, total ${w.reduce((a, b) => a + b, 0)} -> ${out}`);
  console.log(Object.entries(bySection).map(([s, n]) => `${s}:${n}`).join(" "));
}

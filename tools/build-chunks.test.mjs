// node --test tools
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseBlocks, chunkBlocks, buildChunks } from "./build-chunks.mjs";

const para = (n, w = "word") => Array.from({ length: n }, () => w).join(" ");

test("headings set the section; text before the first heading is skipped", () => {
  const md = `# Title\n\n> converter note\n\nAuthors line\n\n## Abstract\n\nabs text\n\n## 1 Introduction\n\nintro text\n\n### 2.4 Why Global?\n\nglobal text\n`;
  assert.deepEqual(parseBlocks(md).map((b) => [b.section, b.text]), [
    ["abstract", "abs text"], ["1", "intro text"], ["2.4", "global text"],
  ]);
});

test("page markers set the page; figure fragments, editor notes and references are dropped", () => {
  const md = `## 1 Intro\n\na\n\n<!-- page 2 -->\n\n\`\`\`text\nS0\n80\n\`\`\`\n\n> **§2.1 retyped** note\n\nb\n\n## 10 References\n\n[1] ref\n`;
  assert.deepEqual(parseBlocks(md).map((b) => [b.page, b.text]), [[1, "a"], [2, "b"]]);
});

test("a figure transcription goes to the section that argues from it (Fig 2 -> §2.4) and is tagged", () => {
  const md = `### 2.3 Why In-Network?\n\nx\n\n> **Figure 2, transcribed by hand.** Leaves L0, L1.\n>\n> | a | b |\n\ny\n`;
  const blocks = parseBlocks(md);
  assert.deepEqual(blocks.map((b) => b.section), ["2.3", "2.4", "2.3"]);
  assert.equal(blocks[1].figure, 2);
  assert.match(blocks[1].text, /^\*\*Figure 2/);
});

test("chunks hold 150-300 words, never mix sections, and are numbered per section", () => {
  const blocks = [
    { section: "2.4", page: 3, text: para(100) },
    { section: "2.4", page: 3, text: para(100) },
    { section: "2.4", page: 3, text: para(120) },
    { section: "2.5", page: 3, text: para(200) },
  ];
  const chunks = chunkBlocks(blocks);
  assert.deepEqual(chunks.map((c) => [c.id, c.text.split(/\s+/).length]), [["2.4-p1", 200], ["2.4-p2", 120], ["2.5-p1", 200]]);
});

test("an over-long paragraph is split at sentence ends", () => {
  const sentence = para(49) + " end.";
  const chunks = chunkBlocks([{ section: "1", page: 1, text: Array(10).fill(sentence).join(" ") }]);
  for (const c of chunks) assert.ok(c.text.split(/\s+/).length <= 300);
  assert.equal(chunks.map((c) => c.text).join(" ").split(/\s+/).length, 500);
});

const paperPath = fileURLToPath(new URL("../docs/papers/conga.md", import.meta.url));
test("CONGA paper: chunks for every Figure 1 section; Figure 1 chunk is tagged", { skip: !existsSync(paperPath) && "docs not cloned" }, () => {
  const chunks = buildChunks(readFileSync(paperPath, "utf8"));
  for (const s of ["1", "2.1", "2.2", "2.3", "2.4", "2.5", "2.6"]) assert.ok(chunks.some((c) => c.section === s), s);
  for (const c of chunks) assert.ok(c.text.split(/\s+/).length <= 360, c.id);
  const fig1 = chunks.filter((c) => c.figures?.includes(1));
  assert.equal(fig1.length, 1);
  assert.equal(fig1[0].section, "1");
  assert.ok(!chunks.some((c) => /Converted from conga\.pdf|retyped from the PDF|Permission to make digital/.test(c.text)));
  assert.equal(new Set(chunks.map((c) => c.id)).size, chunks.length);
});

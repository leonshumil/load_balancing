// forks.ts is a copy of the fork data the function needs; model.js (step 03) is the source.
import { assertEquals } from "jsr:@std/assert@1";
import { FORKS, BRANCH_IDS } from "./forks.ts";
// @ts-ignore plain JS module from the site
import { FORKS as MODEL_FORKS, TREE } from "../../../site/public/hw/js/path/model.js";

Deno.test("forks.ts matches hw/js/path/model.js (ids, questions, options, CONGA's pick)", () => {
  // deno-lint-ignore no-explicit-any
  const fromModel = Object.fromEntries(MODEL_FORKS.map((f: any) => [f.id, {
    question: f.question, options: f.options, congaPick: f.congaPick, section: f.section,
  }]));
  const fromFunction = Object.fromEntries(Object.entries(FORKS).map(([id, f]) => [id, {
    question: f.question, options: f.options, congaPick: f.congaPick, section: f.section,
  }]));
  assertEquals(fromFunction, fromModel);
});

Deno.test("BRANCH_IDS are the Figure 1 nodes (CONGA Fig 1)", () => {
  assertEquals([...BRANCH_IDS].sort(), Object.keys(TREE).filter((id) => id !== "root").sort());
});

Deno.test("retrieval sections per fork (step 11: F1 §2.2, F2 §2.3, F3 §2.4, F4 §1 + §2.5, F5 §2.6)", () => {
  assertEquals(Object.fromEntries(Object.entries(FORKS).map(([id, f]) => [id, f.sections])), {
    F1: ["2.2"], F2: ["2.3"], F3: ["2.4"], F4: ["1", "2.5"], F5: ["2.6"],
  });
});

// The tutor's output contract (approved 2026-11-27) and its server-side validation.
// The API enforces OUTPUT_SCHEMA (structured outputs); parseOutput checks it again and
// cleans what the schema can't know per turn. It never decides whether a pick is correct.
import { BRANCH_IDS, FORKS } from "./forks.ts";

export const PROPERTY_IDS = ["P1", "P2", "P3", "P4", "P5"];
export const MAX_REPLY_CHARS = 1000; // the prompt asks for <= 120 words (~800 chars)

export const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    cites: { type: "array", items: { type: "string" } },
    detected_pick: { anyOf: [{ type: "string", enum: BRANCH_IDS }, { type: "null" }] },
    properties_mentioned: { type: "array", items: { type: "string", enum: PROPERTY_IDS } },
    ready_to_reveal: { type: "boolean" },
  },
  required: ["reply", "cites", "detected_pick", "properties_mentioned", "ready_to_reveal"],
  additionalProperties: false,
};

export type TutorOutput = {
  reply: string;
  cites: string[];
  detected_pick: string | null;
  properties_mentioned: string[];
  ready_to_reveal: boolean;
};

export type ParseResult =
  | { ok: true; value: TutorOutput; dropped: { cites: string[]; pick: string | null } }
  | { ok: false; error: string };

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Parse and validate one model output. ctx.citable = ids of the excerpts sent this turn. */
export function parseOutput(text: string, ctx: { forkId: string | null; citable: string[] }): ParseResult {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ok: false, error: "not an object" };
  const r = o as Record<string, unknown>;
  const keys = Object.keys(r).sort().join(",");
  if (keys !== [...OUTPUT_SCHEMA.required].sort().join(",")) return { ok: false, error: `keys: ${keys}` };
  if (typeof r.reply !== "string" || !r.reply.trim()) return { ok: false, error: "empty reply" };
  if (r.reply.length > MAX_REPLY_CHARS) return { ok: false, error: "reply too long" };
  if (!isStringArray(r.cites)) return { ok: false, error: "cites" };
  if (r.detected_pick !== null && (typeof r.detected_pick !== "string" || !BRANCH_IDS.includes(r.detected_pick))) {
    return { ok: false, error: "detected_pick" };
  }
  if (!isStringArray(r.properties_mentioned) || !r.properties_mentioned.every((p) => PROPERTY_IDS.includes(p))) {
    return { ok: false, error: "properties_mentioned" };
  }
  if (typeof r.ready_to_reveal !== "boolean") return { ok: false, error: "ready_to_reveal" };

  const cites = [...new Set(r.cites)];
  const options = ctx.forkId ? FORKS[ctx.forkId].options.map((x) => x.id) : [];
  const pick = r.detected_pick as string | null;
  const pickOk = pick !== null && options.includes(pick);
  return {
    ok: true,
    value: {
      reply: r.reply.trim(),
      cites: cites.filter((c) => ctx.citable.includes(c)),
      detected_pick: pickOk ? pick : null,
      properties_mentioned: [...new Set(r.properties_mentioned)].sort(),
      ready_to_reveal: ctx.forkId ? r.ready_to_reveal : false,
    },
    dropped: { cites: cites.filter((c) => !ctx.citable.includes(c)), pick: pick !== null && !pickOk ? pick : null },
  };
}

// The tutor endpoint, with its dependencies passed in (index.ts wires the real ones;
// handler_test.ts uses a mock LLM and the in-memory store).
//
// POST { session_id, fork_id: "F1".."F5" | null, history: [{role, text}] (last 10 used),
//        message (<= 600 chars), state: { picks: {F1: branchId}, properties_used: {F1: ["P1"]} } }
// -> 200 { reply, cites, detected_pick, properties_mentioned, ready_to_reveal, fallback }
// -> 4xx/5xx { error, reply }   (reply is always something the UI can show)
//    429 { error: "quota" } = the provider's free quota is used up: the client switches to
//    the scripted fallback. Our own limits are 429 "too_fast" / "limit".
//
// The function never decides correctness: the client compares detected_pick with congaPick.
import { BRANCH_IDS, FORKS } from "./forks.ts";
import { type LLM, QuotaError } from "./llm.ts";
import { buildMessages, type State, SYSTEM_PROMPT, type Turn } from "./prompt.ts";
import { selectContext } from "./retrieval.ts";
import { OUTPUT_SCHEMA, parseOutput, PROPERTY_IDS, type TutorOutput } from "./schema.ts";
import type { Store } from "./store.ts";

export const MAX_MESSAGE_CHARS = 600;
const MAX_HISTORY = 10;
const MAX_HISTORY_TEXT = 2000;
const MAX_BODY_BYTES = 32_000;

export const MESSAGES = {
  bad_request: "Sorry, that message couldn't be sent. Please reload the page and try again.",
  too_long: `Please keep your message under ${MAX_MESSAGE_CHARS} characters.`,
  too_fast: "One message every few seconds, please. Try again in a moment.",
  quota: "The tutor has reached its free usage limit for now. Carry on with the guided steps; your answers are saved.",
  limit: "You've used all 40 tutor messages for this homework. You can still finish the tree on your own; your answers are saved.",
  fallback: "Sorry, I couldn't answer that just now. Try again, or pick a branch for this fork and give a reason from P1–P5.",
  unavailable: "The tutor is unavailable right now. You can still finish the tree on your own; your answers are saved.",
  forbidden: "This tutor only works from the course homework page.",
  method: "Use POST.",
};

// Lines of the system prompt that must never appear in a reply (rule text, not property names).
const CANARIES = SYSTEM_PROMPT.split("\n").slice(7).map((l) => l.trim().replace(/\s+/g, " ")).filter((l) => l.length >= 40);

export type HandlerDeps = {
  llm: LLM;
  store: Store;
  allowedOrigins: string[];
  allowLocalhost: boolean;
  secrets?: string[]; // values that must never appear in a reply (API keys)
};

type Input = { session_id: string; fork_id: string | null; history: Turn[]; message: string; state: State };

class BadRequest extends Error {
  constructor(public code: "bad_request" | "too_long") {
    super(code);
  }
}

function parseInput(raw: unknown): Input {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequest("bad_request");
  const b = raw as Record<string, unknown>;
  if (typeof b.session_id !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(b.session_id)) throw new BadRequest("bad_request");
  const fork_id = b.fork_id ?? null;
  if (fork_id !== null && (typeof fork_id !== "string" || !FORKS[fork_id])) throw new BadRequest("bad_request");
  if (typeof b.message !== "string" || !b.message.trim()) throw new BadRequest("bad_request");
  const message = b.message.trim();
  if (message.length > MAX_MESSAGE_CHARS) throw new BadRequest("too_long");

  const h = b.history ?? [];
  if (!Array.isArray(h)) throw new BadRequest("bad_request");
  const history: Turn[] = h.slice(-MAX_HISTORY).map((t) => {
    if (!t || typeof t !== "object" || typeof t.text !== "string") throw new BadRequest("bad_request");
    const role = t.role === "user" || t.role === "student" ? "user" : t.role === "assistant" || t.role === "tutor" ? "assistant" : null;
    if (!role) throw new BadRequest("bad_request");
    return { role, text: t.text.slice(0, MAX_HISTORY_TEXT) };
  });

  // state is advisory context for the tutor; keep only well-formed entries.
  const s = (b.state && typeof b.state === "object" ? b.state : {}) as Record<string, unknown>;
  const picks: Record<string, string> = {};
  const properties_used: Record<string, string[]> = {};
  for (const id of Object.keys(FORKS)) {
    const p = (s.picks as Record<string, unknown> | undefined)?.[id];
    if (typeof p === "string" && BRANCH_IDS.includes(p)) picks[id] = p;
    const used = (s.properties_used as Record<string, unknown> | undefined)?.[id];
    if (Array.isArray(used)) properties_used[id] = [...new Set(used.filter((x) => PROPERTY_IDS.includes(x)))];
  }
  return { session_id: b.session_id, fork_id, history, message, state: { picks, properties_used } };
}

export function createHandler(deps: HandlerDeps) {
  const secrets = (deps.secrets ?? []).filter((s) => s && s.length >= 8);

  const originAllowed = (origin: string | null) => {
    if (origin === null) return true; // not a browser (curl, the smoke script); rate limits still apply
    if (deps.allowedOrigins.includes(origin)) return true;
    return deps.allowLocalhost && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  };

  const leaks = (reply: string) => {
    const flat = reply.replace(/\s+/g, " ");
    return CANARIES.some((c) => flat.includes(c)) || secrets.some((s) => reply.includes(s));
  };

  return async function handle(req: Request): Promise<Response> {
    const origin = req.headers.get("Origin");
    const cors: Record<string, string> = origin && originAllowed(origin)
      ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
      : {};
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
    const fail = (status: number, error: keyof typeof MESSAGES) => json(status, { error, reply: MESSAGES[error] });

    if (!originAllowed(origin)) return fail(403, "forbidden");
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    if (req.method !== "POST") return fail(405, "method");

    let input: Input;
    try {
      const text = await req.text();
      if (text.length > MAX_BODY_BYTES) throw new BadRequest("bad_request");
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new BadRequest("bad_request");
      }
      input = parseInput(raw);
    } catch (e) {
      return fail(400, e instanceof BadRequest ? e.code : "bad_request");
    }

    const started = Date.now();
    let chunks;
    try {
      const turn = await deps.store.takeTurn(input.session_id);
      if (turn === "limit") return fail(429, "limit");
      if (turn === "too_fast") return fail(429, "too_fast");
      chunks = await deps.store.getChunks();
    } catch (e) {
      console.error("tutor store error:", e instanceof Error ? e.message : e);
      return fail(500, "unavailable");
    }

    const ctx = selectContext(chunks, input.fork_id, input.message);
    const messages = buildMessages({ forkId: input.fork_id, history: input.history, message: input.message, state: input.state, chunks: ctx.chunks });
    const citable = ctx.chunks.map((c) => c.id);

    let out: TutorOutput | null = null;
    let model: string | null = null;
    let inTok = 0, outTok = 0;
    let quota = false;
    for (let attempt = 0; attempt < 2 && !out && !quota; attempt++) {
      try {
        const res = await deps.llm({ system: SYSTEM_PROMPT, messages, schema: OUTPUT_SCHEMA });
        model = res.model;
        inTok += res.inputTokens;
        outTok += res.outputTokens;
        const parsed = parseOutput(res.text, { forkId: input.fork_id, citable });
        if (!parsed.ok) {
          console.warn(`tutor output rejected (attempt ${attempt + 1}, stop=${res.stopReason}): ${parsed.error}`);
        } else if (leaks(parsed.value.reply)) {
          console.warn(`tutor output rejected (attempt ${attempt + 1}): echoes the prompt or a secret`);
        } else {
          out = parsed.value;
        }
      } catch (e) {
        if (e instanceof QuotaError) {
          // Free quota hit: no retry (a retry would only burn more quota).
          console.warn(`tutor quota hit (retry-after ${e.retryAfterSeconds ?? "?"} s)`);
          quota = true;
        } else {
          // Log the error class and short message only (LLMError never holds the key).
          console.error(`tutor LLM error (attempt ${attempt + 1}):`, e instanceof Error ? `${e.name} ${e.name === "LLMError" ? e.message : ""}` : typeof e);
        }
      }
    }
    const fallback = out === null;
    const result: TutorOutput = out ?? { reply: quota ? MESSAGES.quota : MESSAGES.fallback, cites: [], detected_pick: null, properties_mentioned: [], ready_to_reveal: false };

    try {
      await deps.store.log({
        session_id: input.session_id,
        fork_id: input.fork_id,
        message: input.message,
        reply: result.reply,
        cites: result.cites,
        detected_pick: result.detected_pick,
        properties: result.properties_mentioned,
        ready_to_reveal: result.ready_to_reveal,
        fallback,
        model,
        input_tokens: model ? inTok : null,
        output_tokens: model ? outTok : null,
        latency_ms: Date.now() - started,
      });
    } catch (e) {
      console.error("tutor log error:", e instanceof Error ? e.message : e); // the student still gets the reply
    }

    if (quota) return fail(429, "quota");
    return json(200, { ...result, fallback });
  };
}

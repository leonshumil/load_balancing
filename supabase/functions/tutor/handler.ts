// The tutor endpoint, with its dependencies passed in (index.ts wires the real ones;
// handler_test.ts uses a mock LLM and the in-memory store).
//
// POST { session_id, fork_id: "F1".."F5" | null, history: [{role, text}] (last 6 used),
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
import { LIMITS, type Store } from "./store.ts";

export const MAX_MESSAGE_CHARS = 600;
const MAX_HISTORY = 6; // turns sent to the model (saves tokens on the free tier)
const MAX_HISTORY_TEXT = 600; // characters per earlier turn
const MAX_BODY_BYTES = 32_000;

export const MESSAGES = {
  bad_request: "Sorry, that message couldn't be sent. Please reload the page and try again.",
  too_long: `Please keep your message under ${MAX_MESSAGE_CHARS} characters.`,
  too_fast: "One message every few seconds, please. Try again in a moment.",
  quota: "The tutor has reached its free usage limit for now. Carry on with the guided steps; your answers are saved.",
  limit: `You've used all ${LIMITS.maxMessages} tutor messages for this homework. You can still finish the tree on your own; your answers are saved.`,
  fallback: "Sorry, I couldn't answer that just now. Try again, or pick a branch for this fork and give a reason from P1–P5.",
  unavailable: "The tutor is unavailable right now. You can still finish the tree on your own; your answers are saved.",
  forbidden: "This tutor only works from the course homework page.",
  method: "Use POST.",
};

// Lines of the system prompt that must never appear in a reply (rule text, not property names).
const CANARIES = SYSTEM_PROMPT.split("\n").slice(7).map((l) => l.trim().replace(/\s+/g, " ")).filter((l) => l.length >= 40);

export type HandlerDeps = {
  llm: LLM; // primary model
  overflow?: LLM; // tried once when the primary says 429 (its own free quota)
  store: Store;
  allowedOrigins: string[];
  allowLocalhost: boolean;
  secrets?: string[]; // values that must never appear in a reply (API keys)
  debug?: boolean; // local runs: add an X-Tutor-Calls header with per-call model and tokens
  now?: () => number;
};

// Per-call record (debug header, console). No message text, no keys.
type Call = { model: string; status: "ok" | "invalid" | "quota" | "error"; prompt?: number; cached?: number; completion?: number; ms: number; limits?: unknown };

const MAX_COOLDOWN_S = 60;
const DEFAULT_COOLDOWN_S = 20;

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
  const now = deps.now ?? Date.now;
  // After a 429 from the primary, send turns straight to the overflow model until
  // retry-after has passed (per isolate; saves a wasted call per turn).
  let primaryCoolUntil = 0;

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
    const messages = buildMessages({ forkId: input.fork_id, history: input.history, message: input.message, state: input.state, base: ctx.base, extra: ctx.extra });
    const citable = ctx.chunks.map((c) => c.id);

    // Model chain: primary, then (only on a 429) the overflow model once. Invalid output or a
    // provider error gets one retry on the same model; a 429 is never retried on the same model.
    const chain = deps.overflow ? [deps.llm, deps.overflow] : [deps.llm];
    let step = deps.overflow && now() < primaryCoolUntil ? 1 : 0;
    let out: TutorOutput | null = null;
    let model: string | null = null;
    let inTok = 0, outTok = 0;
    let quota = false;
    let failures = 0;
    const calls: Call[] = [];
    while (!out && !quota && failures < 2) {
      const t0 = now();
      const label = step === 0 ? "primary" : "overflow";
      try {
        const res = await chain[step]({ system: SYSTEM_PROMPT, messages, schema: OUTPUT_SCHEMA });
        model = res.model;
        inTok += res.inputTokens;
        outTok += res.outputTokens;
        const parsed = parseOutput(res.text, { forkId: input.fork_id, citable });
        const ok = parsed.ok && !leaks(parsed.value.reply);
        calls.push({ model: res.model, status: ok ? "ok" : "invalid", prompt: res.inputTokens, cached: res.cachedTokens ?? 0, completion: res.outputTokens, ms: now() - t0, limits: res.limits ?? undefined });
        if (ok) out = (parsed as { value: TutorOutput }).value;
        else {
          failures++;
          console.warn(`tutor output rejected (${label}, stop=${res.stopReason}): ${parsed.ok ? "echoes the prompt or a secret" : parsed.error}`);
        }
      } catch (e) {
        if (e instanceof QuotaError) {
          calls.push({ model: e.model, status: "quota", ms: now() - t0 });
          console.warn(`tutor quota hit on ${label} ${e.model} (retry-after ${e.retryAfterSeconds ?? "?"} s)`);
          if (step === 0) primaryCoolUntil = now() + Math.min(e.retryAfterSeconds ?? DEFAULT_COOLDOWN_S, MAX_COOLDOWN_S) * 1000;
          if (step + 1 < chain.length) step++;
          else quota = true;
        } else {
          failures++;
          calls.push({ model: label, status: "error", ms: now() - t0 });
          // Log the error class and short message only (LLMError never holds the key).
          console.error(`tutor LLM error (${label}):`, e instanceof Error ? `${e.name} ${e.name === "LLMError" ? e.message : ""}` : typeof e);
        }
      }
    }
    for (const c of calls) {
      console.log(`tutor call ${c.model} ${c.status}` + (c.prompt !== undefined ? ` prompt=${c.prompt} cached=${c.cached} completion=${c.completion}` : "") + ` ${c.ms}ms`);
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
        cached_tokens: model ? calls.reduce((a, c) => a + (c.cached ?? 0), 0) : null,
        output_tokens: model ? outTok : null,
        latency_ms: Date.now() - started,
      });
    } catch (e) {
      console.error("tutor log error:", e instanceof Error ? e.message : e); // the student still gets the reply
    }

    const debugHeaders: Record<string, string> = deps.debug ? { "X-Tutor-Calls": JSON.stringify(calls) } : {};
    if (quota) {
      return new Response(JSON.stringify({ error: "quota", reply: MESSAGES.quota }), { status: 429, headers: { ...cors, ...debugHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ...result, fallback }), { status: 200, headers: { ...cors, ...debugHeaders, "Content-Type": "application/json" } });
  };
}

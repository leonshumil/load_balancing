// Storage for the tutor: paper chunks, rate limits, log.
// restStore talks to Supabase over PostgREST with the service key (no SDK).
// memoryStore is for local runs without a database and for tests; it follows the same rules
// as tutor_take_turn() in supabase/migrations/20261127190100_tutor.sql.
import type { Chunk } from "./retrieval.ts";

export type TurnResult = "ok" | "too_fast" | "limit";

export type LogRow = {
  session_id: string;
  fork_id: string | null;
  message: string;
  reply: string;
  cites: string[];
  detected_pick: string | null;
  properties: string[];
  ready_to_reveal: boolean;
  fallback: boolean;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
};

export interface Store {
  getChunks(): Promise<Chunk[]>;
  takeTurn(sessionId: string): Promise<TurnResult>;
  log(row: LogRow): Promise<void>;
}

export const LIMITS = { maxMessages: 40, gapMs: 3000 };
const CHUNK_TTL_MS = 10 * 60 * 1000;

export function restStore(opts: { url: string; key: string; fetch?: typeof fetch }): Store {
  const f = opts.fetch ?? fetch;
  const base = `${opts.url.replace(/\/$/, "")}/rest/v1`;
  // New secret keys (sb_secret_...) go in `apikey` only; legacy JWT keys also as Bearer.
  const headers: Record<string, string> = { apikey: opts.key, "Content-Type": "application/json" };
  if (!opts.key.startsWith("sb_")) headers.Authorization = `Bearer ${opts.key}`;
  let chunks: { at: number; value: Chunk[] } | null = null;

  const check = async (res: Response, what: string) => {
    if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
    return res;
  };

  return {
    async getChunks() {
      if (chunks && Date.now() - chunks.at < CHUNK_TTL_MS) return chunks.value;
      const res = await check(await f(`${base}/paper_chunks?select=id,section,page,text,figures`, { headers }), "paper_chunks");
      chunks = { at: Date.now(), value: await res.json() };
      return chunks.value;
    },
    async takeTurn(sessionId) {
      const res = await check(
        await f(`${base}/rpc/tutor_take_turn`, {
          method: "POST",
          headers,
          body: JSON.stringify({ p_session: sessionId, p_max: LIMITS.maxMessages, p_gap_ms: LIMITS.gapMs }),
        }),
        "tutor_take_turn",
      );
      return (await res.json()) as TurnResult;
    },
    async log(row) {
      await check(
        await f(`${base}/tutor_log`, { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(row) }),
        "tutor_log",
      );
    },
  };
}

export function memoryStore(opts: { chunks: Chunk[]; now?: () => number }): Store & { logs: LogRow[] } {
  const now = opts.now ?? Date.now;
  const usage = new Map<string, { count: number; last: number | null }>();
  const logs: LogRow[] = [];
  return {
    logs,
    getChunks: () => Promise.resolve(opts.chunks),
    takeTurn(sessionId) {
      const u = usage.get(sessionId) ?? { count: 0, last: null };
      usage.set(sessionId, u);
      if (u.count >= LIMITS.maxMessages) return Promise.resolve("limit");
      if (u.last !== null && now() - u.last < LIMITS.gapMs) return Promise.resolve("too_fast");
      u.count++;
      u.last = now();
      return Promise.resolve("ok");
    },
    log(row) {
      logs.push(row);
      return Promise.resolve();
    },
  };
}

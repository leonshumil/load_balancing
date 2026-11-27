// Supabase Edge Function entry point: wires the real LLM and store into the handler.
// Deploy with --no-verify-jwt: the page calls it without a user login; the handler checks
// the origin, the input and the per-session rate limits itself.
//
// Environment:
//   GROQ_API_KEY        secret (supabase secrets set ...); or TUTOR_LLM_KEY for another provider
//   TUTOR_MODEL         required: primary model id, e.g. openai/gpt-oss-120b
//   TUTOR_LLM_BASE_URL  optional, default https://api.groq.com/openai/v1 (any OpenAI-compatible API)
//   TUTOR_JSON_MODE     optional, json_schema (default, strict) or json_object
//   TUTOR_MAX_TOKENS    optional, default 400
//   TUTOR_REASONING_EFFORT  optional, for reasoning models (e.g. low)
//   TUTOR_MODEL_FALLBACK    optional overflow model, tried once when the primary says 429,
//                           e.g. qwen/qwen3.8-27b (its own free quota)
//   TUTOR_FALLBACK_BASE_URL / _JSON_MODE (default json_object) / _REASONING_EFFORT (default none)
//   TUTOR_ORIGINS       optional, comma list, default https://leonshumil.github.io
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   injected by Supabase in deployed functions
//   TUTOR_DB_KEY        optional: a secret key (sb_secret_...) to use instead of the service role key
// Local runs only (tools/tutor-dev.sh):
//   TUTOR_DEV=1         also allow http://localhost origins, and add the X-Tutor-Calls debug header
//   TUTOR_CHUNKS_FILE   use tools/.out/chunks.json and an in-memory store instead of the database
//   TUTOR_PORT          port for Deno.serve
import { createHandler } from "./handler.ts";
import { GROQ_BASE_URL, openAICompatibleLLM } from "./llm.ts";
import { memoryStore, restStore, type Store } from "./store.ts";

const env = (k: string) => Deno.env.get(k) ?? "";

async function makeStore(): Promise<Store> {
  const file = env("TUTOR_CHUNKS_FILE");
  if (file) {
    console.log(`tutor: in-memory store, chunks from ${file}`);
    return memoryStore({ chunks: JSON.parse(await Deno.readTextFile(file)) });
  }
  const url = env("SUPABASE_URL");
  const key = env("TUTOR_DB_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("tutor: set SUPABASE_URL and a service key, or TUTOR_CHUNKS_FILE for a local run");
  return restStore({ url, key });
}

const llmKey = env("TUTOR_LLM_KEY") || env("GROQ_API_KEY");
const model = env("TUTOR_MODEL");
if (!llmKey) throw new Error("tutor: GROQ_API_KEY is not set");
if (!model) throw new Error("tutor: TUTOR_MODEL is not set");
const jsonMode = env("TUTOR_JSON_MODE") === "json_object" ? "json_object" : "json_schema";
const maxTokens = Number(env("TUTOR_MAX_TOKENS")) || 400;
const baseUrl = env("TUTOR_LLM_BASE_URL") || GROQ_BASE_URL;
const fallbackModel = env("TUTOR_MODEL_FALLBACK");
const fallbackJson = env("TUTOR_FALLBACK_JSON_MODE") === "json_schema" ? "json_schema" : "json_object";

const handler = createHandler({
  llm: openAICompatibleLLM({ baseUrl, key: llmKey, model, jsonMode, maxTokens, reasoningEffort: env("TUTOR_REASONING_EFFORT") || undefined }),
  overflow: fallbackModel
    ? openAICompatibleLLM({
      baseUrl: env("TUTOR_FALLBACK_BASE_URL") || baseUrl,
      key: llmKey,
      model: fallbackModel,
      jsonMode: fallbackJson,
      maxTokens,
      reasoningEffort: env("TUTOR_FALLBACK_REASONING_EFFORT") || "none",
    })
    : undefined,
  store: await makeStore(),
  allowedOrigins: (env("TUTOR_ORIGINS") || "https://leonshumil.github.io").split(",").map((s) => s.trim()).filter(Boolean),
  allowLocalhost: env("TUTOR_DEV") === "1",
  secrets: [llmKey, env("TUTOR_DB_KEY"), env("SUPABASE_SERVICE_ROLE_KEY")],
  debug: env("TUTOR_DEV") === "1",
});

console.log(`tutor: model ${model} (${jsonMode})` + (fallbackModel ? `, overflow ${fallbackModel} (${fallbackJson})` : ""));
const port = env("TUTOR_PORT");
if (port) Deno.serve({ port: Number(port) }, handler);
else Deno.serve(handler);

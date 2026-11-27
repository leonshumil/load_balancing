// Supabase Edge Function entry point: wires the real LLM and store into the handler.
// Deploy with --no-verify-jwt: the page calls it without a user login; the handler checks
// the origin, the input and the per-session rate limits itself.
//
// Environment:
//   ANTHROPIC_API_KEY   secret (supabase secrets set ...)
//   TUTOR_MODEL         optional, default claude-haiku-5-5
//   TUTOR_ORIGINS       optional, comma list, default https://leonshumil.github.io
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   injected by Supabase in deployed functions
//   TUTOR_DB_KEY        optional: a secret key (sb_secret_...) to use instead of the service role key
// Local runs only (tools/tutor-dev.sh):
//   TUTOR_DEV=1         also allow http://localhost origins
//   TUTOR_CHUNKS_FILE   use tools/.out/chunks.json and an in-memory store instead of the database
//   TUTOR_PORT          port for Deno.serve
import { createHandler } from "./handler.ts";
import { anthropicLLM } from "./llm.ts";
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

const handler = createHandler({
  llm: anthropicLLM(),
  store: await makeStore(),
  allowedOrigins: (env("TUTOR_ORIGINS") || "https://leonshumil.github.io").split(",").map((s) => s.trim()).filter(Boolean),
  allowLocalhost: env("TUTOR_DEV") === "1",
  secrets: [env("ANTHROPIC_API_KEY"), env("TUTOR_DB_KEY"), env("SUPABASE_SERVICE_ROLE_KEY")],
});

const port = env("TUTOR_PORT");
if (port) Deno.serve({ port: Number(port) }, handler);
else Deno.serve(handler);

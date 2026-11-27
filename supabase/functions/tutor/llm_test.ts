// The OpenAI-compatible client, against a fake fetch (no network).
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { LLMError, openAICompatibleLLM, QuotaError } from "./llm.ts";
import { OUTPUT_SCHEMA } from "./schema.ts";

type Seen = { url: string; init: RequestInit };
function fakeFetch(res: () => Response) {
  const seen: Seen[] = [];
  const f = ((url: string, init: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve(res());
  }) as unknown as typeof fetch;
  return { f, seen };
}
const ok = (content: string) =>
  new Response(JSON.stringify({ model: "m-1", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 9 } }));
const req = { system: "SYS", messages: [{ role: "user" as const, content: "hi" }], schema: OUTPUT_SCHEMA };
const cfg = { baseUrl: "https://api.example/v1/", key: "gsk_secret_key_123", model: "m", jsonMode: "json_schema" as const, maxTokens: 400 };

Deno.test("request: chat/completions, bearer key, system first, strict json_schema, max_completion_tokens", async () => {
  const { f, seen } = fakeFetch(() => ok('{"a":1}'));
  const r = await openAICompatibleLLM({ ...cfg, fetch: f, reasoningEffort: "low" })(req);
  assertEquals(seen[0].url, "https://api.example/v1/chat/completions");
  assertEquals((seen[0].init.headers as Record<string, string>).Authorization, "Bearer gsk_secret_key_123");
  const body = JSON.parse(seen[0].init.body as string);
  assertEquals(body.model, "m");
  assertEquals(body.messages, [{ role: "system", content: "SYS" }, { role: "user", content: "hi" }]);
  assertEquals(body.max_completion_tokens, 400);
  assertEquals(body.response_format.type, "json_schema");
  assertEquals(body.response_format.json_schema.strict, true);
  assertEquals(body.response_format.json_schema.schema, OUTPUT_SCHEMA);
  assertEquals(body.reasoning_effort, "low");
  assertEquals(r, { text: '{"a":1}', stopReason: "stop", model: "m-1", inputTokens: 50, outputTokens: 9 });
});

Deno.test("request: json_object mode; no reasoning_effort unless configured", async () => {
  const { f, seen } = fakeFetch(() => ok("{}"));
  await openAICompatibleLLM({ ...cfg, jsonMode: "json_object", fetch: f })(req);
  const body = JSON.parse(seen[0].init.body as string);
  assertEquals(body.response_format, { type: "json_object" });
  assert(!("reasoning_effort" in body));
});

Deno.test("429 -> QuotaError with retry-after, fetched once", async () => {
  const { f, seen } = fakeFetch(() => new Response("{}", { status: 429, headers: { "retry-after": "7" } }));
  const e = await assertRejects(() => openAICompatibleLLM({ ...cfg, fetch: f })(req), QuotaError);
  assertEquals(e.retryAfterSeconds, 7);
  assertEquals(seen.length, 1);
});

Deno.test("other errors -> LLMError with status and provider code only, never the key", async () => {
  const { f } = fakeFetch(() => new Response(JSON.stringify({ error: { code: "json_validate_failed", message: "echo gsk_secret_key_123" } }), { status: 400 }));
  const e = await assertRejects(() => openAICompatibleLLM({ ...cfg, fetch: f })(req), LLMError);
  assertEquals(e.message, "HTTP 400 json_validate_failed");
  const net = ((() => Promise.reject(new TypeError("boom gsk_secret_key_123"))) as unknown) as typeof fetch;
  const e2 = await assertRejects(() => openAICompatibleLLM({ ...cfg, fetch: net })(req), LLMError);
  assert(!e2.message.includes("gsk_"));
});

Deno.test("missing content -> empty text (the handler then retries / falls back)", async () => {
  const { f } = fakeFetch(() => new Response(JSON.stringify({ choices: [{ message: {}, finish_reason: "length" }] })));
  const r = await openAICompatibleLLM({ ...cfg, fetch: f })(req);
  assertEquals(r.text, "");
  assertEquals(r.stopReason, "length");
});

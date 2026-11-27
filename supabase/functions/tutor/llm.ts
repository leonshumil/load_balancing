// The one place that talks to the model provider (swap this file to change providers).
// Anthropic Messages API, structured JSON output. Model from TUTOR_MODEL (default
// claude-haiku-5-5), key from the ANTHROPIC_API_KEY secret.
import Anthropic from "npm:@anthropic-ai/sdk@1.14.0";

export type LLMRequest = {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  schema: Record<string, unknown>;
};

export type LLMResponse = {
  text: string; // the JSON text (empty if the model returned none)
  stopReason: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type LLM = (req: LLMRequest) => Promise<LLMResponse>;

// Haiku 5.5 thinks by default and thinking counts toward max_tokens, so leave room above
// the ~200 tokens a reply needs; effort "low" keeps thinking short (approved 2026-11-27).
const MAX_TOKENS = 1024;

export function anthropicLLM(opts: { apiKey?: string; model?: string } = {}): LLM {
  const client = new Anthropic({ apiKey: opts.apiKey ?? Deno.env.get("ANTHROPIC_API_KEY"), maxRetries: 1, timeout: 30_000 });
  const model = opts.model ?? Deno.env.get("TUTOR_MODEL") ?? "claude-haiku-5-5";
  return async ({ system, messages, schema }) => {
    const res = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      output_config: { effort: "low", format: { type: "json_schema", schema } },
    });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return {
      text,
      stopReason: res.stop_reason ?? null,
      model: res.model,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  };
}

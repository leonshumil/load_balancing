// The one place that talks to the model provider. An OpenAI-compatible chat-completions
// client (plain fetch, no SDK): switching provider is a config change (base URL, key, model).
// Default provider: the Groq free tier.

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

/** The provider said 429 (free quota or rate limit hit). Not retried. */
export class QuotaError extends Error {
  constructor(public retryAfterSeconds: number | null) {
    super("quota");
    this.name = "QuotaError";
  }
}

/** Any other provider failure. The message never includes the key or the request body. */
export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMError";
  }
}

export type LLMConfig = {
  baseUrl: string; // e.g. https://api.groq.com/openai/v1
  key: string;
  model: string;
  jsonMode: "json_schema" | "json_object"; // json_schema = strict structured output
  maxTokens: number;
  reasoningEffort?: string; // only for reasoning models that accept it
  fetch?: typeof fetch;
};

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export function openAICompatibleLLM(cfg: LLMConfig): LLM {
  const f = cfg.fetch ?? fetch;
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  return async ({ system, messages, schema }) => {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: [{ role: "system", content: system }, ...messages],
      max_completion_tokens: cfg.maxTokens,
      response_format: cfg.jsonMode === "json_schema"
        ? { type: "json_schema", json_schema: { name: "tutor_reply", strict: true, schema } }
        : { type: "json_object" },
    };
    if (cfg.reasoningEffort) body.reasoning_effort = cfg.reasoningEffort;

    let res: Response;
    try {
      res = await f(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new LLMError(`network: ${e instanceof Error ? e.name : "error"}`);
    }
    if (res.status === 429) {
      await res.body?.cancel();
      const ra = Number(res.headers.get("retry-after"));
      throw new QuotaError(Number.isFinite(ra) && ra > 0 ? ra : null);
    }
    if (!res.ok) {
      // Keep only the provider's error code (e.g. json_validate_failed), not its message.
      let code = "";
      try {
        code = (await res.json())?.error?.code ?? "";
      } catch { /* not JSON */ }
      throw new LLMError(`HTTP ${res.status}${code ? ` ${code}` : ""}`);
    }
    const data = await res.json();
    const choice = data?.choices?.[0];
    return {
      text: typeof choice?.message?.content === "string" ? choice.message.content : "",
      stopReason: choice?.finish_reason ?? null,
      model: data?.model ?? cfg.model,
      inputTokens: data?.usage?.prompt_tokens ?? 0,
      outputTokens: data?.usage?.completion_tokens ?? 0,
    };
  };
}

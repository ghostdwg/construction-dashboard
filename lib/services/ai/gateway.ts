import Anthropic from "@anthropic-ai/sdk";

/**
 * Single AI gateway (P1B) — a TRANSPARENT, behavior-preserving relay for
 * Anthropic Messages calls.
 *
 * It intentionally does NOT: normalize model ids, validate routing, sanitize/
 * redact/classify content, change retries or timeouts, log usage or cost, or
 * alter API keys. Callers keep all prompt assembly, response parsing, fallback
 * behavior, usage/cost logging, stubs, and HTTP semantics exactly as before.
 * Provider errors (types + status codes) propagate to the caller unchanged.
 *
 * This is the ONE sanctioned site that constructs a provider client; the P0
 * guardrail allow-lists this file and forbids direct provider construction
 * anywhere else.
 */
export interface CreateMessageRequest {
  /** Exact model string — forwarded verbatim (no normalization / allow-list). */
  model: string;
  /** Maps 1:1 to Anthropic `max_tokens`. */
  maxTokens: number;
  /** Exact messages array (native Anthropic content blocks). */
  messages: Anthropic.MessageParam[];
  /** Optional system prompt — omitted from the request when `undefined`. */
  system?: string;
  /** Optional temperature — omitted when `undefined`. */
  temperature?: number;
  /** API key, resolved by the caller (env or app settings) exactly as before. */
  apiKey: string;
  /** Test seam: inject a client instead of constructing a real one. */
  client?: Pick<Anthropic, "messages">;
}

export interface CreateMessageResult {
  /** Concatenated text blocks (convenience). Callers may also read `raw`. */
  text: string;
  /** Provider usage counts, preserved verbatim. */
  usage: { inputTokens: number; outputTokens: number };
  /** Model id echoed by the provider response. */
  model: string;
  stopReason: string | null;
  /** The unmodified provider response object. */
  raw: Anthropic.Message;
}

export async function createMessage(
  req: CreateMessageRequest
): Promise<CreateMessageResult> {
  const client = req.client ?? new Anthropic({ apiKey: req.apiKey });

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: req.model,
    max_tokens: req.maxTokens,
    messages: req.messages,
  };
  if (req.system !== undefined) params.system = req.system;
  if (req.temperature !== undefined) params.temperature = req.temperature;

  // Provider errors propagate unchanged (type + status code preserved).
  const raw = (await client.messages.create(params)) as Anthropic.Message;

  const text = raw.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    text,
    usage: {
      inputTokens: raw.usage.input_tokens,
      outputTokens: raw.usage.output_tokens,
    },
    model: raw.model,
    stopReason: raw.stop_reason ?? null,
    raw,
  };
}

import Anthropic from "@anthropic-ai/sdk";
import { scanPrompt } from "./promptScan";
import { emitAuditEventNoAwait } from "@/lib/observability/audit";
import { recordPromptScanOutcome } from "@/lib/observability/metrics";

/**
 * Single AI gateway (P1B) — a TRANSPARENT, behavior-preserving relay for
 * Anthropic Messages calls.
 *
 * It intentionally does NOT: normalize model ids, validate routing, sanitize/
 * redact/classify content, change retries or timeouts, alter API keys, or
 * change routing/return behavior in any way. Callers keep all prompt
 * assembly, response parsing, fallback behavior, usage/cost logging, stubs,
 * and HTTP semantics exactly as before. Provider errors (types + status
 * codes) propagate to the caller unchanged.
 *
 * P2-A0 addition: this gateway also emits a non-blocking, best-effort
 * heuristic prompt-scan AUDIT SIGNAL (see promptScan.ts) — a shadow-mode
 * observation only. It does NOT modify, block, route, redact, sanitize, or
 * approve any request; a scanner or audit failure can never affect the
 * provider call, its response, or the caller's return value.
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
  /**
   * Optional caller-provided metadata for the P2-A0 shadow prompt-scan audit
   * signal only. Purely observational — has no effect on the provider
   * request. Existing callers that omit this remain fully valid; `feature`
   * defaults to `"unknown"` when absent.
   */
  audit?: {
    feature: string;
    bidId?: string;
    correlationId?: string;
  };
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

/** Extracts text-only content from a message's `content` field. Skips
 *  non-text blocks (images, tool_use, tool_result, etc.) entirely — they
 *  are never inspected. */
function extractTextBlocks(content: Anthropic.MessageParam["content"]): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && "type" in block && block.type === "text") {
      out.push((block as Anthropic.TextBlockParam).text);
    }
  }
  return out;
}

/**
 * P2-A0 shadow prompt-scan: concatenates system text + text-only message
 * blocks, runs the pure detect-only scanner, and emits ONE fire-and-forget
 * audit event. Deliberately synchronous and fully self-contained in a
 * try/catch — a scanner or audit-emission failure must never throw into,
 * delay, or otherwise affect the caller. Non-text content blocks (images,
 * files, tool blocks) are skipped, never inspected.
 */
function runShadowPromptScan(req: CreateMessageRequest): void {
  const feature = req.audit?.feature ?? "unknown";
  try {
    const parts: string[] = [];
    if (req.system) parts.push(req.system);
    for (const msg of req.messages) parts.push(...extractTextBlocks(msg.content));
    const text = parts.join("\n");

    const scan = scanPrompt(text);
    const decision: "flagged" | "clean" = scan.findings.length > 0 ? "flagged" : "clean";

    // Content-free counter, additional to (never a replacement for) the
    // audit event below. Does not change the severity/log level of the
    // clean-scan audit event emitted next.
    recordPromptScanOutcome(decision, feature);

    emitAuditEventNoAwait({
      category: "ai_prompt_scan",
      action: "prompt_scan",
      severity: decision === "flagged" ? "WARN" : "DEBUG",
      decision,
      actor: { kind: "system" },
      correlationId: req.audit?.correlationId,
      subject: req.audit?.bidId ? { kind: "BID", id: req.audit.bidId } : null,
      payload: {
        scannerVersion: scan.scannerVersion,
        mode: scan.mode,
        feature,
        model: req.model,
        findings: scan.findings,
        scannedChars: scan.scannedChars,
        truncated: scan.truncated,
      },
    });
  } catch {
    // The scanner is documented as pure/no-I/O and emitAuditEventNoAwait
    // already swallows its own async errors — this catch exists only as an
    // absolute last resort so a shadow-audit defect can never propagate
    // into the provider call path. Report scan_error, metadata only.
    try {
      recordPromptScanOutcome("error", feature);
    } catch {
      // Metrics must never throw into the shadow-scan path either.
    }
    try {
      emitAuditEventNoAwait({
        category: "ai_prompt_scan",
        action: "prompt_scan",
        severity: "ERROR",
        decision: "scan_error",
        actor: { kind: "system" },
        correlationId: req.audit?.correlationId,
        payload: { feature, model: req.model },
      });
    } catch {
      // Never throw from the shadow scan path, under any circumstance.
    }
  }
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

  // Non-blocking, best-effort shadow prompt-scan audit signal (P2-A0). Fully
  // synchronous and self-contained — never awaited, never affects the
  // request below. See runShadowPromptScan's own doc comment.
  runShadowPromptScan(req);

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

// Module SET1 — AI Usage Log service
//
// Records every Anthropic API call into the AiUsageLog table. The cost is
// computed at log time using the model's pricing in MODEL_PRICING and stored
// alongside the row, so we don't need to recompute historical pricing if the
// rates change.
//
// Usage is non-blocking: a failure to log should never break the actual AI
// call. Log via try/catch with console.error on failure.
//
// Work Package "provider-invocation-evidence" — real vs. stub / success vs.
// failure evidence contract:
//
// AiUsageLog.status (an existing, previously two-valued "ok" | "error"
// string column — no schema change) now carries THREE values:
//   "ok"    — a real provider call was attempted and succeeded (unchanged
//             meaning/behavior from before this work package; existing cost
//             aggregation queries that filter on status:"ok" are unaffected).
//   "error" — a real provider call was attempted and failed. Previously
//             declared but never actually written by any caller.
//   "stub"  — no provider call was attempted at all; a stub/mock code path
//             ran instead. Brand new value — never written before this work
//             package, so it cannot collide with any existing status:"ok"
//             filter (stub rows are correctly excluded from cost/usage
//             totals, since they carry no real cost or tokens).
//
// AiUsageLog.errorMessage (an existing, previously write-only-as-null
// column — grep confirms no caller in this codebase has ever populated it
// with a real value) is repurposed to carry a SAFE, CLOSED failure-class
// enum (see AiFailureClass below) ONLY when status is "error". It is never
// used to store a raw provider error message, stack trace, or any other
// free-text/unbounded content — see classifyAiFailure().
//
// "Real" vs. "stub" is determined structurally, not by a new correlation
// mechanism: every call site that invokes logAiUsage()/logSidecarUsage()
// after actually calling createMessage() (TS gateway) or receiving a
// sidecar-reported success is real by construction (this codebase's stub
// code paths — BRIEF_STUB_MODE / GAP_STUB_MODE / ADDENDUM_STUB_MODE — skip
// createMessage() entirely and, before this work package, logged nothing at
// all). Stub code paths now explicitly log one status:"stub" row so their
// activity is visible as evidence instead of silently indistinguishable from
// "no evidence yet".

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { MODEL_PRICING, type ModelId, type CallKey, AI_CALL_DEFINITIONS } from "./aiTokenConfig";

// ── Failure classification (evidence-safe, closed vocabulary) ──────────────
//
// A small, bounded enum — NEVER the raw provider error message, stack trace,
// or any request/response detail. Safe to persist durably in
// AiUsageLog.errorMessage because it can never carry unbounded or sensitive
// content by construction (the return type is a closed string union).

export type AiFailureClass =
  | "rate_limited"
  | "auth_error"
  | "provider_error"
  | "network_error"
  | "unknown";

/**
 * Classify a thrown error into a safe, closed failure class for evidence
 * recording. Recognizes genuine Anthropic SDK error types when present
 * (preferred path — used by every TS call site that invokes createMessage()
 * directly). Falls back to reading a plain numeric `status` property (useful
 * for call sites fronted by an HTTP hop, e.g. the sidecar-routed meeting
 * analysis call, which throws a plain Error rather than an Anthropic SDK
 * error) or a network-failure error shape. Never inspects/returns
 * `err.message` or any other free-text field.
 */
export function classifyAiFailure(err: unknown): AiFailureClass {
  if (err instanceof Anthropic.RateLimitError) return "rate_limited";
  if (err instanceof Anthropic.AuthenticationError) return "auth_error";
  if (err instanceof Anthropic.PermissionDeniedError) return "auth_error";
  if (err instanceof Anthropic.APIConnectionError) return "network_error"; // covers APIConnectionTimeoutError
  if (err instanceof Anthropic.APIError) return "provider_error"; // any other status-bearing APIError subtype

  // Fallback for non-SDK error shapes (e.g. a plain Error thrown by a
  // fetch-fronted call site) that carry a bare numeric HTTP status.
  const status = (err as { status?: unknown } | null | undefined)?.status;
  if (typeof status === "number") {
    if (status === 429) return "rate_limited";
    if (status === 401 || status === 403) return "auth_error";
    if (status >= 400) return "provider_error";
  }

  // A bare network-level failure (e.g. `fetch` connection refused) throws a
  // plain TypeError with no status at all.
  if (err instanceof TypeError) return "network_error";

  return "unknown";
}

// ── Cost calculation ────────────────────────────────────────────────────────

export function computeCallCost(
  model: ModelId | string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = (MODEL_PRICING as Record<string, { inputPer1M: number; outputPer1M: number }>)[
    model
  ];
  if (!pricing) return 0;
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  return inputCost + outputCost;
}

// ── Logging ────────────────────────────────────────────────────────────────

export type LogUsageInput = {
  callKey: CallKey;
  /** The real model id, or the literal `"stub"` sentinel for a stub-mode
   *  evidence row (see module doc above) — never a real model name for a
   *  call that didn't actually happen, so evidence can't be misread as a
   *  real completion. */
  model: ModelId | "stub";
  inputTokens: number;
  outputTokens: number;
  bidId?: number | null;
  /** "ok" = real success, "error" = real failure, "stub" = no provider call
   *  was attempted. Defaults to "ok" for backward compatibility with every
   *  existing caller that omits this. */
  status?: "ok" | "error" | "stub";
  /** ONLY ever a bounded AiFailureClass value (see classifyAiFailure) when
   *  status is "error" — never a raw provider error message or stack. */
  errorMessage?: AiFailureClass | null;
};

/**
 * Log a single AI call. Never throws — failures are logged to console only
 * so the calling code path stays unaffected.
 */
export async function logAiUsage(input: LogUsageInput): Promise<void> {
  try {
    const cost = computeCallCost(input.model, input.inputTokens, input.outputTokens);
    await prisma.aiUsageLog.create({
      data: {
        callKey: input.callKey,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costUsd: cost,
        bidId: input.bidId ?? null,
        status: input.status ?? "ok",
        errorMessage: input.errorMessage ?? null,
      },
    });
  } catch (err) {
    console.error("[logAiUsage] failed to record usage:", err);
  }
}

// ── Sidecar usage evidence (Work Package N5) ────────────────────────────────
//
// The Python sidecar (sidecar/services/spec_intelligence.py) makes its own
// Anthropic calls directly through the sanctioned Python gateway
// (sidecar/services/ai_gateway.py) — it never routes through this Node
// process's gateway.ts, so those calls can't be captured by logAiUsage()
// above. Instead, the sidecar reports an aggregate usage summary (model ids,
// token counts, cost) in the webhook payload it POSTs back to
// /api/bids/[id]/specbook/analyze/complete when an analyze_split job
// finishes. This function persists THAT evidence.
//
// callKey is intentionally a plain string outside the CallKey union (the
// AiTokenConfig / AI_CALL_DEFINITIONS registry only governs max_tokens for
// calls made through the TS gateway) — loadUsageSummaries()/loadUsageForBid()
// already tolerate callKeys absent from that map by falling back to the raw
// key as the label.
//
// Only non-sensitive, already-reported fields are accepted here: model id(s),
// token counts, cost, and bidId (job correlation). No prompt text, document
// text, or credentials ever pass through this path — see the input type below.

export type SidecarUsageInput = {
  /** Identifies the sidecar call site, e.g. "spec_analysis_sidecar". */
  callKey: string;
  /**
   * Exact model id(s) reported by the sidecar for this job. When more than
   * one model was used (tiered routing mixes Sonnet + Haiku across
   * sections), pass all of them — they are joined into a single stored
   * value since AiUsageLog.model is a single column.
   */
  models: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  bidId?: number | null;
  status?: "ok" | "error";
  errorMessage?: string | null;
};

/**
 * Log sidecar-reported AI usage (Spec Book intelligence path). Never
 * throws — mirrors logAiUsage()'s non-blocking contract so a logging
 * failure can never affect the webhook it's called from.
 */
export async function logSidecarUsage(input: SidecarUsageInput): Promise<void> {
  try {
    const model = input.models.length > 0 ? input.models.join(", ") : "unknown";
    await prisma.aiUsageLog.create({
      data: {
        callKey: input.callKey,
        model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costUsd: input.costUsd,
        bidId: input.bidId ?? null,
        status: input.status ?? "ok",
        errorMessage: input.errorMessage ?? null,
      },
    });
  } catch (err) {
    console.error("[logSidecarUsage] failed to record usage:", err);
  }
}

// ── Read / aggregate ────────────────────────────────────────────────────────

export type UsageSummary = {
  range: { from: string; to: string; label: string };
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  byCallKey: Array<{
    callKey: string;
    label: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
};

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysAgo(n: number): Date {
  const d = startOfTodayUtc();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function summarizeRange(
  from: Date,
  label: string
): Promise<UsageSummary> {
  const rows = await prisma.aiUsageLog.findMany({
    where: { createdAt: { gte: from }, status: "ok" },
    select: {
      callKey: true,
      inputTokens: true,
      outputTokens: true,
      costUsd: true,
    },
  });

  type Bucket = {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  const byKey = new Map<string, Bucket>();

  let totalCalls = 0;
  let totalIn = 0;
  let totalOut = 0;
  let totalCost = 0;

  for (const row of rows) {
    totalCalls += 1;
    totalIn += row.inputTokens;
    totalOut += row.outputTokens;
    totalCost += row.costUsd;

    let bucket = byKey.get(row.callKey);
    if (!bucket) {
      bucket = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      byKey.set(row.callKey, bucket);
    }
    bucket.calls += 1;
    bucket.inputTokens += row.inputTokens;
    bucket.outputTokens += row.outputTokens;
    bucket.costUsd += row.costUsd;
  }

  const byCallKey = Array.from(byKey.entries())
    .map(([callKey, b]) => ({
      callKey,
      label:
        (AI_CALL_DEFINITIONS as Record<string, { label: string }>)[callKey]?.label ??
        callKey,
      calls: b.calls,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      costUsd: b.costUsd,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return {
    range: {
      from: from.toISOString(),
      to: new Date().toISOString(),
      label,
    },
    totalCalls,
    totalInputTokens: totalIn,
    totalOutputTokens: totalOut,
    totalCostUsd: totalCost,
    byCallKey,
  };
}

export async function loadUsageSummaries(): Promise<{
  today: UsageSummary;
  last7Days: UsageSummary;
  last30Days: UsageSummary;
}> {
  const [today, last7Days, last30Days] = await Promise.all([
    summarizeRange(startOfTodayUtc(), "Today"),
    summarizeRange(daysAgo(7), "Last 7 days"),
    summarizeRange(daysAgo(30), "Last 30 days"),
  ]);
  return { today, last7Days, last30Days };
}

// ── Per-bid ledger ───────────────────────────────────────────────────────────

export type BidUsageLedger = {
  totalCalls: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byCallKey: Array<{
    callKey: string;
    label: string;
    calls: number;
    costUsd: number;
  }>;
};

export async function loadUsageForBid(bidId: number): Promise<BidUsageLedger> {
  const rows = await prisma.aiUsageLog.findMany({
    where: { bidId, status: "ok" },
    select: { callKey: true, inputTokens: true, outputTokens: true, costUsd: true },
  });

  type Bucket = { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  const byKey = new Map<string, Bucket>();
  let totalCalls = 0, totalIn = 0, totalOut = 0, totalCost = 0;

  for (const row of rows) {
    totalCalls++;
    totalIn  += row.inputTokens;
    totalOut += row.outputTokens;
    totalCost += row.costUsd;
    let b = byKey.get(row.callKey);
    if (!b) { b = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }; byKey.set(row.callKey, b); }
    b.calls++; b.inputTokens += row.inputTokens; b.outputTokens += row.outputTokens; b.costUsd += row.costUsd;
  }

  const byCallKey = Array.from(byKey.entries())
    .map(([callKey, b]) => ({
      callKey,
      label: (AI_CALL_DEFINITIONS as Record<string, { label: string }>)[callKey]?.label ?? callKey,
      calls: b.calls,
      costUsd: b.costUsd,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return { totalCalls, totalCostUsd: totalCost, totalInputTokens: totalIn, totalOutputTokens: totalOut, byCallKey };
}

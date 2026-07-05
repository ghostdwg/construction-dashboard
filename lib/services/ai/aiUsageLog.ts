// Module SET1 — AI Usage Log service
//
// Records every Anthropic API call into the AiUsageLog table. The cost is
// computed at log time using the model's pricing in MODEL_PRICING and stored
// alongside the row, so we don't need to recompute historical pricing if the
// rates change.
//
// Usage is non-blocking: a failure to log should never break the actual AI
// call. Log via try/catch with console.error on failure.

import { prisma } from "@/lib/prisma";
import { MODEL_PRICING, type ModelId, type CallKey, AI_CALL_DEFINITIONS } from "./aiTokenConfig";

// ── Cost calculation ────────────────────────────────────────────────────────

export function computeCallCost(
  model: ModelId,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  return inputCost + outputCost;
}

// ── Logging ────────────────────────────────────────────────────────────────

export type LogUsageInput = {
  callKey: CallKey;
  model: ModelId;
  inputTokens: number;
  outputTokens: number;
  bidId?: number | null;
  status?: "ok" | "error";
  errorMessage?: string | null;
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

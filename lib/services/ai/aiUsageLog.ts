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

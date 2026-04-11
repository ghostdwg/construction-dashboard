// Module SET1 — Token estimator + cost forecaster
//
// Approximates token counts for arbitrary text and forecasts the cost of a
// specific AI call before it runs. Used by the cost-preview component on AI
// action buttons (Generate Brief, Run Gap Analysis, etc.).
//
// **Estimation method:** characters / 4. Anthropic's tokenizer maps roughly
// 4 chars per token for English text (slightly tighter for code, looser for
// numbers). For sub-2% accuracy you'd need a real tokenizer; for cost
// previews this is good enough — the user is looking at orders of magnitude.
//
// **Calibration data:** when AiUsageLog has rows for the call type, we use
// the median actual output-token ratio (output / max_tokens) over the last
// 30 days instead of the hardcoded 50% guess. This refines over time.

import { prisma } from "@/lib/prisma";
import {
  AI_CALL_DEFINITIONS,
  MODEL_PRICING,
  type CallKey,
} from "./aiTokenConfig";

// ── Token estimation ────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4;

/**
 * Approximate token count for a UTF-8 string. Underestimates for dense
 * non-English text; overestimates for highly compressible content. Good
 * enough for cost previews.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ── Output token ratio (with calibration) ──────────────────────────────────

const FALLBACK_OUTPUT_RATIO = 0.5;

/**
 * Returns the average output-token ratio for a call type over the last 30
 * days, falling back to 0.5 (50% of max_tokens) if no log rows exist.
 */
export async function getCalibratedOutputRatio(
  callKey: CallKey,
  currentMaxTokens: number
): Promise<number> {
  if (currentMaxTokens <= 0) return FALLBACK_OUTPUT_RATIO;
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const rows = await prisma.aiUsageLog.findMany({
    where: { callKey, status: "ok", createdAt: { gte: since } },
    select: { outputTokens: true },
    take: 50,
  });
  if (rows.length === 0) return FALLBACK_OUTPUT_RATIO;

  // Average output as a fraction of the *current* max_tokens setting.
  // (Imperfect when max_tokens has changed, but a useful signal.)
  const avgOutput =
    rows.reduce((s, r) => s + r.outputTokens, 0) / rows.length;
  const ratio = avgOutput / currentMaxTokens;
  // Clamp to a sane range
  return Math.min(1.0, Math.max(0.05, ratio));
}

// ── Cost forecasting ───────────────────────────────────────────────────────

export type CostForecast = {
  callKey: CallKey;
  callLabel: string;
  model: string;
  // Input
  inputTokens: number;
  inputTokenSource: "estimated" | "typical";
  inputCostUsd: number;
  // Output (forecast)
  maxOutputTokens: number;
  forecastOutputTokens: number;
  forecastOutputCostUsd: number;
  outputRatio: number;
  outputRatioSource: "calibrated" | "default";
  // Totals
  realisticCostUsd: number; // input + forecast output
  worstCaseCostUsd: number; // input + max output
  // Suggestions
  warnings: string[];
};

export type ForecastInput = {
  callKey: CallKey;
  // Optional — if provided, we tokenize it. Otherwise we use typicalInputTokens.
  inputText?: string;
  // Override the call's current max_tokens (e.g. user preview)
  overrideMaxTokens?: number;
};

export async function forecastCallCost(
  input: ForecastInput
): Promise<CostForecast> {
  const def = AI_CALL_DEFINITIONS[input.callKey];
  if (!def) throw new Error(`Unknown callKey: ${input.callKey}`);

  // Resolve max_tokens (override > current DB setting > default)
  let maxTokens: number;
  if (input.overrideMaxTokens != null) {
    maxTokens = input.overrideMaxTokens;
  } else {
    const row = await prisma.aiTokenConfig.findUnique({
      where: { callKey: input.callKey },
    });
    maxTokens = row?.maxTokens ?? def.defaultMaxTokens;
  }

  // Resolve input tokens
  let inputTokens: number;
  let inputTokenSource: "estimated" | "typical";
  if (input.inputText) {
    inputTokens = estimateTokens(input.inputText);
    inputTokenSource = "estimated";
  } else {
    inputTokens = def.typicalInputTokens;
    inputTokenSource = "typical";
  }

  // Resolve output ratio
  const calibratedRatio = await getCalibratedOutputRatio(
    input.callKey,
    maxTokens
  );
  const outputRatio = calibratedRatio;
  const outputRatioSource: "calibrated" | "default" =
    calibratedRatio === FALLBACK_OUTPUT_RATIO ? "default" : "calibrated";

  const forecastOutputTokens = Math.round(maxTokens * outputRatio);

  const pricing = MODEL_PRICING[def.model];
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const forecastOutputCost =
    (forecastOutputTokens / 1_000_000) * pricing.outputPer1M;
  const worstOutputCost = (maxTokens / 1_000_000) * pricing.outputPer1M;

  // Suggestions / warnings
  const warnings: string[] = [];
  if (inputTokens > def.typicalInputTokens * 2) {
    warnings.push(
      `Input is ~${Math.round((inputTokens / def.typicalInputTokens) * 100)}% larger than typical for this call. Consider splitting the document or running a summarization pass first.`
    );
  }
  if (inputTokens > 150_000) {
    warnings.push(
      `Input exceeds 150K tokens. The model may struggle to use all the context effectively. Consider trimming or chunking.`
    );
  }
  if (inputTokens > maxTokens * 5 && maxTokens < def.maxAllowedTokens) {
    warnings.push(
      `Input is much larger than the output budget. If the model needs to summarize a lot, consider raising max_tokens to ${Math.min(def.maxAllowedTokens, maxTokens * 2)}.`
    );
  }

  return {
    callKey: input.callKey,
    callLabel: def.label,
    model: def.model,
    inputTokens,
    inputTokenSource,
    inputCostUsd: inputCost,
    maxOutputTokens: maxTokens,
    forecastOutputTokens,
    forecastOutputCostUsd: forecastOutputCost,
    outputRatio,
    outputRatioSource,
    realisticCostUsd: inputCost + forecastOutputCost,
    worstCaseCostUsd: inputCost + worstOutputCost,
    warnings,
  };
}

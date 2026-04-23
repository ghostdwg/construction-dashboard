// Single source of truth for AI call definitions, max_tokens presets, and pricing.
//
// To change the max_tokens used by an AI call at runtime, update the AiTokenConfig
// row for its callKey via /api/settings/ai-tokens (or the /settings/ai-tokens UI).
// If no row exists, the `defaultMaxTokens` value below is used.
//
// To add a NEW AI call:
//   1. Add an entry to AI_CALL_DEFINITIONS below
//   2. Replace the hardcoded `max_tokens` in the call site with `await getMaxTokens('yourKey')`

import { prisma } from "@/lib/prisma";

// ── Pricing (USD per 1M tokens) ────────────────────────────────────────────
// Update if Anthropic changes pricing. See https://www.anthropic.com/pricing
export const MODEL_PRICING = {
  "claude-sonnet-4-6": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-opus-4-6": { inputPer1M: 15.0, outputPer1M: 75.0 },
  "claude-haiku-4-5": { inputPer1M: 0.8, outputPer1M: 4.0 },
} as const;

export type ModelId = keyof typeof MODEL_PRICING;

// ── Call definitions ───────────────────────────────────────────────────────

export type CallDefinition = {
  label: string;
  description: string;
  model: ModelId;
  // Realistic average input tokens for this call (used in cost estimation)
  typicalInputTokens: number;
  // Hardcoded fallback if no DB override exists
  defaultMaxTokens: number;
  // Hard floor — UI won't allow setting below this
  minTokens: number;
  // Hard ceiling — UI won't allow setting above this (model output limit)
  maxAllowedTokens: number;
  // Discrete preset tiers shown in the selector
  presets: {
    minimal: number;
    standard: number;
    extended: number;
    maximum: number;
  };
  // Recommended preset (highlighted in UI)
  recommended: "minimal" | "standard" | "extended" | "maximum";
};

export const AI_CALL_DEFINITIONS = {
  brief: {
    label: "Bid Intelligence Brief",
    description:
      "Generates the five-section project brief on the Overview tab. Reads the spec book + drawings index, produces structured JSON (whatIsThisJob, riskFlags, assumptions, etc.).",
    model: "claude-sonnet-4-6",
    typicalInputTokens: 30000,
    defaultMaxTokens: 8192,
    minTokens: 2048,
    maxAllowedTokens: 16000,
    presets: {
      minimal: 4096,
      standard: 8192,
      extended: 12000,
      maximum: 16000,
    },
    recommended: "standard",
  },
  "gap-analysis": {
    label: "Per-Trade Gap Analysis",
    description:
      "Identifies scope gaps for each trade. Runs once per trade (~25 calls per bid). Tighter caps truncate findings on complex trades like Concrete and Mechanical.",
    model: "claude-sonnet-4-6",
    typicalInputTokens: 8000,
    defaultMaxTokens: 8000,
    minTokens: 1024,
    maxAllowedTokens: 16000,
    presets: {
      minimal: 2048,
      standard: 4096,
      extended: 8000,
      maximum: 16000,
    },
    recommended: "extended",
  },
  "addendum-delta": {
    label: "Addendum Delta Processing",
    description:
      "Compares an addendum against the prior project state and emits a delta list (added/changed/removed scope, new RFI responses, drawing reissues).",
    model: "claude-sonnet-4-6",
    typicalInputTokens: 15000,
    defaultMaxTokens: 8000,
    minTokens: 2048,
    maxAllowedTokens: 16000,
    presets: {
      minimal: 4096,
      standard: 6000,
      extended: 8000,
      maximum: 16000,
    },
    recommended: "extended",
  },
  intelligence: {
    label: "Intelligence (legacy route)",
    description:
      "Older intelligence generation route. Same shape as the brief but called from older entry points. Match its ceiling to the brief.",
    model: "claude-sonnet-4-6",
    typicalInputTokens: 30000,
    defaultMaxTokens: 8000,
    minTokens: 2048,
    maxAllowedTokens: 16000,
    presets: {
      minimal: 4096,
      standard: 8000,
      extended: 12000,
      maximum: 16000,
    },
    recommended: "standard",
  },
  "leveling-question": {
    label: "Leveling Question",
    description:
      "Generates a single focused clarification question for one leveling row. Intentionally tight — one Q per row, no list output.",
    model: "claude-sonnet-4-6",
    typicalInputTokens: 1000,
    defaultMaxTokens: 200,
    minTokens: 100,
    maxAllowedTokens: 500,
    presets: {
      minimal: 100,
      standard: 200,
      extended: 300,
      maximum: 500,
    },
    recommended: "standard",
  },
  "meeting-analysis": {
    label: "Meeting Intelligence Analysis",
    description:
      "Extracts 8-section structured analysis from a meeting transcript: participants, overview, decisions, action items, open issues, red flags, and GC-only action items. Transcript size drives input token usage — longer meetings need extended output.",
    model: "claude-sonnet-4-6",
    typicalInputTokens: 25000,
    defaultMaxTokens: 8192,
    minTokens: 4096,
    maxAllowedTokens: 16000,
    presets: {
      minimal: 4096,
      standard: 8192,
      extended: 12000,
      maximum: 16000,
    },
    recommended: "standard",
  },
} as const satisfies Record<string, CallDefinition>;

export type CallKey = keyof typeof AI_CALL_DEFINITIONS;

// ── Cost calculation ───────────────────────────────────────────────────────

export type CostEstimate = {
  // Cost when output fully uses max_tokens (worst case)
  maxCostUsd: number;
  // Cost when output uses ~50% of max (realistic average)
  realisticCostUsd: number;
  inputTokens: number;
  maxOutputTokens: number;
  realisticOutputTokens: number;
};

export function estimateCallCost(
  callKey: CallKey,
  maxTokens: number
): CostEstimate {
  const def = AI_CALL_DEFINITIONS[callKey];
  const pricing = MODEL_PRICING[def.model];
  const realisticOutputTokens = Math.round(maxTokens * 0.5);

  const inputCost = (def.typicalInputTokens / 1_000_000) * pricing.inputPer1M;
  const maxOutputCost = (maxTokens / 1_000_000) * pricing.outputPer1M;
  const realisticOutputCost =
    (realisticOutputTokens / 1_000_000) * pricing.outputPer1M;

  return {
    maxCostUsd: inputCost + maxOutputCost,
    realisticCostUsd: inputCost + realisticOutputCost,
    inputTokens: def.typicalInputTokens,
    maxOutputTokens: maxTokens,
    realisticOutputTokens,
  };
}

// ── Runtime fetch ──────────────────────────────────────────────────────────

// Process-level cache. Cleared via clearTokenConfigCache() after PATCH.
let cache: Map<string, number> | null = null;

async function loadCache(): Promise<Map<string, number>> {
  if (cache) return cache;
  const rows = await prisma.aiTokenConfig.findMany();
  cache = new Map(rows.map((r) => [r.callKey, r.maxTokens]));
  return cache;
}

export function clearTokenConfigCache(): void {
  cache = null;
}

/**
 * Get the effective max_tokens for an AI call.
 * Reads from the AiTokenConfig table (cached); falls back to the hardcoded default.
 */
export async function getMaxTokens(callKey: CallKey): Promise<number> {
  const map = await loadCache();
  return map.get(callKey) ?? AI_CALL_DEFINITIONS[callKey].defaultMaxTokens;
}

/**
 * Get all call configurations with their current effective values.
 * Used by the settings page and API.
 */
export async function getAllCallConfigs(): Promise<
  Array<{
    key: CallKey;
    definition: CallDefinition;
    currentMaxTokens: number;
    isOverridden: boolean;
  }>
> {
  const map = await loadCache();
  return (Object.keys(AI_CALL_DEFINITIONS) as CallKey[]).map((key) => {
    const def = AI_CALL_DEFINITIONS[key];
    const overridden = map.has(key);
    return {
      key,
      definition: def,
      currentMaxTokens: map.get(key) ?? def.defaultMaxTokens,
      isOverridden: overridden,
    };
  });
}

/**
 * Set the max_tokens override for a call. Pass null to clear back to default.
 */
export async function setMaxTokensOverride(
  callKey: CallKey,
  maxTokens: number | null
): Promise<void> {
  const def = AI_CALL_DEFINITIONS[callKey];
  if (maxTokens !== null) {
    if (maxTokens < def.minTokens || maxTokens > def.maxAllowedTokens) {
      throw new Error(
        `${callKey}: maxTokens must be between ${def.minTokens} and ${def.maxAllowedTokens}`
      );
    }
    await prisma.aiTokenConfig.upsert({
      where: { callKey },
      create: { callKey, maxTokens },
      update: { maxTokens },
    });
  } else {
    await prisma.aiTokenConfig
      .delete({ where: { callKey } })
      .catch(() => {}); // tolerate not-found
  }
  clearTokenConfigCache();
}

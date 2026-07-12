// Deterministic composite lead score (0–100). No ML, no external calls.
// Weight table is frozen — bump LEAD_SCORE_VERSION to invalidate stale cached scores.

export const LEAD_SCORE_VERSION = "v1";

type SignalInput = {
  aiRelevanceScore?: number | null;
  heuristicsClassification?: string | null;
};

export type LeadScoreInput = {
  aiScore?: number | null;
  signals: SignalInput[];
  estimatedValue?: number | null;
  detectedAt: Date;
  now: Date;
};

export type LeadScoreFactors = {
  modelRelevance: number;
  heuristicEmergence: number;
  estimatedValue: number;
  corroboration: number;
  recency: number;
};

export type LeadScoreResult = {
  score: number;
  version: string;
  factors: LeadScoreFactors;
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function computeLeadScore(input: LeadScoreInput): LeadScoreResult {
  // Model relevance: max 40. 0.40 × max(lead.aiScore, best signal aiRelevanceScore).
  const maxSignalScore = input.signals.reduce(
    (best, s) => Math.max(best, s.aiRelevanceScore ?? 0),
    0
  );
  const modelRelevance = Math.round(0.4 * Math.max(input.aiScore ?? 0, maxSignalScore));

  // Heuristic emergence: max 25. Best classification across attached signals.
  // Null-only (pre-heuristics or skipHeuristics rows) → 10 neutral points.
  const classifications = input.signals.map((s) => s.heuristicsClassification ?? null);
  let heuristicEmergence: number;
  if (classifications.length === 0 || classifications.every((c) => c === null)) {
    heuristicEmergence = 10;
  } else {
    heuristicEmergence = classifications.reduce<number>((best, c) => {
      if (c === "HIGH_EMERGENCE") return 25;
      if (c === "MEDIUM_EMERGENCE") return Math.max(best, 15);
      if (c === "LOW_EMERGENCE") return Math.max(best, 5);
      return best;
    }, 0);
  }

  // Estimated value: max 15. null = 6 (unknown ≠ worthless).
  const v = input.estimatedValue;
  let estimatedValue: number;
  if (v == null)              estimatedValue = 6;
  else if (v >= 10_000_000)   estimatedValue = 15;
  else if (v >= 1_000_000)    estimatedValue = 12;
  else if (v >= 250_000)      estimatedValue = 8;
  else if (v > 0)             estimatedValue = 4;
  else                        estimatedValue = 0;

  // Corroboration: max 10. Count of attached signals.
  const n = input.signals.length;
  const corroboration = n >= 3 ? 10 : n === 2 ? 7 : n === 1 ? 4 : 0;

  // Recency: max 10. Days since detectedAt.
  const daysDiff = Math.floor(
    (input.now.getTime() - input.detectedAt.getTime()) / 86_400_000
  );
  const recency = daysDiff <= 7 ? 10 : daysDiff <= 30 ? 7 : daysDiff <= 90 ? 4 : 1;

  const score = Math.round(clamp(
    modelRelevance + heuristicEmergence + estimatedValue + corroboration + recency,
    0,
    100,
  ));

  return {
    score,
    version: LEAD_SCORE_VERSION,
    factors: { modelRelevance, heuristicEmergence, estimatedValue, corroboration, recency },
  };
}

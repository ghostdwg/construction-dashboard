// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectAggregation/similarity.ts
//  Phase MI-6 — Composite project-signal similarity scoring.
//
//  Combines per-factor scores (heuristics.ts) into a single composite via
//  weighted average. Returns the composite + factor breakdown + a
//  human-readable reasonLog so the UI can render "Why does the system
//  believe these belong together?".
// ──────────────────────────────────────────────────────────────────────────────

import {
  scoreParcelMatch,
  scoreDeveloperMatch,
  scoreEngineerMatch,
  scoreBrokerMatch,
  scoreJurisdictionMatch,
  scoreZoningContinuity,
  scoreUtilityExtension,
  scoreTemporalProximity,
  scoreTitleSimilarity,
  scoreAgendaContinuity,
  scoreContinuanceCount,
  scoreShellBuildingPattern,
} from "./heuristics";
import {
  type SignalInput,
  type ProjectContext,
  type SimilarityFactors,
  type SimilarityResult,
  FACTOR_WEIGHTS,
} from "./types";

/**
 * Score a single signal against a single candidate project. Pure function.
 *
 * Returns score in [0, 1]: weighted sum of factor scores divided by sum of
 * applicable (non-zero-weight) factor weights, so unused factors don't
 * deflate the composite.
 */
export function scoreProjectSimilarity(
  signal: SignalInput,
  project: ProjectContext
): SimilarityResult {
  const factors: SimilarityFactors = {
    parcelMatch: scoreParcelMatch(signal, project),
    developerMatch: scoreDeveloperMatch(signal, project),
    jurisdictionMatch: scoreJurisdictionMatch(signal, project),
    recurringEngineer: scoreEngineerMatch(signal, project),
    recurringBroker: scoreBrokerMatch(signal, project),
    zoningContinuity: scoreZoningContinuity(signal, project),
    utilityExtension: scoreUtilityExtension(signal, project),
    temporalProximity: scoreTemporalProximity(signal, project),
    titleSimilarity: scoreTitleSimilarity(signal, project),
    agendaContinuity: scoreAgendaContinuity(signal, project),
    continuanceCount: scoreContinuanceCount(signal, project),
    shellBuildingPattern: scoreShellBuildingPattern(signal, project),
  };

  let weightedSum = 0;
  let weightTotal = 0;
  const reasonLog: string[] = [];

  (Object.keys(factors) as Array<keyof SimilarityFactors>).forEach((k) => {
    const weight = FACTOR_WEIGHTS[k];
    const score = factors[k];
    weightedSum += weight * score;
    weightTotal += weight;
    if (score > 0) {
      reasonLog.push(`${k} = ${score.toFixed(2)} (weight ${weight})`);
    }
  });

  const score = weightTotal > 0 ? weightedSum / weightTotal : 0;

  return {
    candidateProjectId: project.id,
    score,
    factors,
    reasonLog,
  };
}

/**
 * Rank a signal against many candidate projects and apply threshold-based
 * decision logic. Used by detectProjectContinuation().
 */
export function scoreAgainstCandidates(
  signal: SignalInput,
  candidates: ProjectContext[]
): SimilarityResult[] {
  return candidates
    .map((c) => scoreProjectSimilarity(signal, c))
    .sort((a, b) => b.score - a.score);
}

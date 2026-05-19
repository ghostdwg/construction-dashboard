// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/emergenceProbability/forecast.ts
//  Phase MI-8 — The composite forecast scorer.
//
//  Pure orchestration of the per-factor heuristics. Given a ForecastSubjectContext,
//  returns an EmergenceScoreResult with full per-factor breakdown,
//  reasonLog, and structured contributions array. The orchestrator
//  (writer.ts) handles persistence; this file stays I/O-free.
// ──────────────────────────────────────────────────────────────────────────────

import {
  type EmergenceFactors,
  type EmergenceScoreResult,
  type ForecastContribution,
  type ForecastSubjectContext,
  FACTOR_WEIGHTS,
  FORECAST_VERSION,
} from "./types";
import { computeAllFactors, computeRecencyMultiplier } from "./heuristics";

const FACTOR_KIND_BY_NAME: Record<
  Exclude<keyof EmergenceFactors, "recencyMultiplier">,
  ForecastContribution["factorKind"]
> = {
  baselineProbability: "SIGNAL_CONTRIBUTION",
  signalVolume: "SIGNAL_CONTRIBUTION",
  signalDiversity: "SIGNAL_CONTRIBUTION",
  developerRecurrence: "ENTITY_INFLUENCE",
  brokerRecurrence: "ENTITY_INFLUENCE",
  continuancePressure: "JURISDICTION_PATTERN",
  utilityExpansion: "PARCEL_INFLUENCE",
  parcelPressure: "PARCEL_INFLUENCE",
  pressuredNeighborCount: "PARCEL_INFLUENCE",
  shellPatternBoost: "TRAJECTORY_SHIFT",
  corridorBoost: "CORRIDOR_HEAT",
  infrastructureBoost: "PARCEL_INFLUENCE",
};

/** Compute the composite emergence score for a subject. Pure function. */
export function computeEmergenceScore(ctx: ForecastSubjectContext): EmergenceScoreResult {
  const factors = computeAllFactors(ctx);

  let weightedSum = 0;
  let weightTotal = 0;
  const contributions: ForecastContribution[] = [];
  const reasonLog: string[] = [];

  for (const [factorName, weight] of Object.entries(FACTOR_WEIGHTS) as Array<
    [keyof typeof FACTOR_WEIGHTS, number]
  >) {
    const score = (factors as unknown as Record<string, number>)[factorName];
    const contribution = score * weight * factors.recencyMultiplier;
    weightedSum += score * weight;
    weightTotal += weight;
    if (score > 0) {
      reasonLog.push(`${factorName}=${score.toFixed(2)} (w=${weight})`);
      contributions.push({
        factorKind: FACTOR_KIND_BY_NAME[factorName],
        factorName: factorName as ForecastContribution["factorName"],
        factorScore: score,
        factorWeight: weight,
        contribution,
        rationale: rationaleFor(factorName, ctx, score),
      });
    }
  }

  const base = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const emergenceScore = clamp(base * factors.recencyMultiplier, 0, 1);

  if (factors.recencyMultiplier < 1) {
    reasonLog.push(`recencyMultiplier=${factors.recencyMultiplier.toFixed(3)}`);
    contributions.push({
      factorKind: "TEMPORAL_DECAY",
      factorName: "recencyMultiplier" as ForecastContribution["factorName"],
      factorScore: factors.recencyMultiplier,
      factorWeight: 1,
      contribution: factors.recencyMultiplier,
      rationale: `daysSinceLastSignal=${ctx.daysSinceLastSignal}, half-life=60d`,
    });
  }

  return {
    subjectKind: ctx.subjectKind,
    subjectId: ctx.subjectId,
    emergenceScore,
    factors,
    reasonLog,
    contributions,
    forecastVersion: FORECAST_VERSION,
  };
}

/** Cheap accessor for the recency multiplier — exposed so callers can show
 *  it independently in the UI without recomputing the full score. */
export function getRecencyMultiplier(daysSinceLastSignal: number): number {
  return computeRecencyMultiplier(daysSinceLastSignal);
}

function rationaleFor(
  factorName: keyof typeof FACTOR_WEIGHTS,
  ctx: ForecastSubjectContext,
  score: number
): string {
  switch (factorName) {
    case "baselineProbability":
      return `MI-6 latestProjectProbability=${ctx.latestProjectProbability?.toFixed(2) ?? "null"}`;
    case "signalVolume":
      return `signalCountLast90d=${ctx.signalCountLast90d} → score ${score.toFixed(2)}`;
    case "signalDiversity":
      return `signalCountLast30d=${ctx.signalCountLast30d} → diversity ${score.toFixed(2)}`;
    case "developerRecurrence":
      return `${ctx.developerEntityIds.length} distinct developer entities attached`;
    case "brokerRecurrence":
      return `${ctx.brokerEntityIds.length} distinct broker entities attached`;
    case "continuancePressure":
      return `continuanceCount=${ctx.continuanceCount}`;
    case "utilityExpansion":
      return `activeUtilityExpansions=${ctx.activeUtilityExpansions}`;
    case "parcelPressure":
      return `MI-7 latestParcelPressureMean=${ctx.latestParcelPressureMean?.toFixed(2) ?? "null"}`;
    case "pressuredNeighborCount":
      return `pressuredNeighborCount=${ctx.pressuredNeighborCount}`;
    case "shellPatternBoost":
      return `shellBuildingPattern=${ctx.hasShellBuildingPattern}`;
    case "corridorBoost":
      return `onCorridor=${ctx.onCorridor}`;
    case "infrastructureBoost":
      return `hasInfrastructureInvestment=${ctx.hasInfrastructureInvestment}`;
    default:
      return `${factorName} score=${score.toFixed(2)}`;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/emergenceProbability/heuristics.ts
//  Phase MI-8 — Pure per-factor scoring functions for the forecast engine.
//
//  Each scorer takes minimal input and returns a number in [0, 1]. No DB
//  calls, no LLMs, no random state. The composite scorer (forecast.ts)
//  combines these via weighted average with a recency-decay multiplier.
//
//  Stability contract: every heuristic returns the same score for the same
//  inputs. Changes to weights or curves MUST bump FORECAST_VERSION in
//  types.ts so historical forecasts know which engine produced them.
// ──────────────────────────────────────────────────────────────────────────────

import {
  type EmergenceFactors,
  type ForecastSubjectContext,
  RECENCY_HALF_LIFE_DAYS,
} from "./types";

// ── Saturation curves ────────────────────────────────────────────────────────
//
// Saturating curves are deliberate: adding the 10th signal moves the needle
// less than adding the 2nd. The platform should reward presence and
// diversity, not raw volume.

export function linearSaturate(x: number, k: number): number {
  if (x <= 0) return 0;
  return Math.min(1, x / k);
}

export function expSaturate(x: number, k: number): number {
  if (x <= 0) return 0;
  return 1 - Math.exp(-x / k);
}

// ── Recency decay ────────────────────────────────────────────────────────────

/** Half-life decay multiplier. Aligns with MI-6 and MI-7. */
export function computeRecencyMultiplier(daysSinceLastSignal: number): number {
  if (daysSinceLastSignal <= 0) return 1;
  return Math.pow(0.5, daysSinceLastSignal / RECENCY_HALF_LIFE_DAYS);
}

// ── Individual factor scorers ────────────────────────────────────────────────

/** Anchor from the most recent MI-6 ProjectProbabilitySnapshot. When the
 *  subject isn't a Project (e.g., PARCEL with no attached projects), this
 *  falls back to 0 — the parcel pressure factor carries the load instead. */
export function scoreBaselineProbability(ctx: ForecastSubjectContext): number {
  if (ctx.latestProjectProbability == null) return 0;
  return Math.max(0, Math.min(1, ctx.latestProjectProbability));
}

export function scoreSignalVolume(ctx: ForecastSubjectContext): number {
  return expSaturate(ctx.signalCountLast90d, 5);
}

/** Diversity here is deliberately a saturating function of distinct counts —
 *  diversity-of-source is a strong signal beyond raw volume. We use the
 *  short-30d window for diversity because diverse sources within a tight
 *  window indicates real activity, not historical drift. */
export function scoreSignalDiversity(ctx: ForecastSubjectContext): number {
  // Approximation: signalCountLast30d / 4 saturates at "4 distinct sources".
  // The orchestrator can refine this by tracking source-type sets when
  // collecting context, but the heuristic stays portable.
  return linearSaturate(ctx.signalCountLast30d, 4);
}

export function scoreDeveloperRecurrence(ctx: ForecastSubjectContext): number {
  return linearSaturate(ctx.developerEntityIds.length, 2);
}

export function scoreBrokerRecurrence(ctx: ForecastSubjectContext): number {
  return linearSaturate(ctx.brokerEntityIds.length, 2);
}

export function scoreContinuancePressure(ctx: ForecastSubjectContext): number {
  if (ctx.continuanceCount <= 0) return 0;
  if (ctx.continuanceCount === 1) return 0.3;
  if (ctx.continuanceCount === 2) return 0.6;
  return 1;
}

export function scoreUtilityExpansion(ctx: ForecastSubjectContext): number {
  return linearSaturate(ctx.activeUtilityExpansions, 2);
}

export function scoreParcelPressure(ctx: ForecastSubjectContext): number {
  if (ctx.latestParcelPressureMean == null) return 0;
  return Math.max(0, Math.min(1, ctx.latestParcelPressureMean));
}

export function scorePressuredNeighborCount(ctx: ForecastSubjectContext): number {
  return expSaturate(ctx.pressuredNeighborCount, 2);
}

export function scoreShellPatternBoost(ctx: ForecastSubjectContext): number {
  return ctx.hasShellBuildingPattern ? 1 : 0;
}

export function scoreCorridorBoost(ctx: ForecastSubjectContext): number {
  return ctx.onCorridor ? 1 : 0;
}

export function scoreInfrastructureBoost(ctx: ForecastSubjectContext): number {
  return ctx.hasInfrastructureInvestment ? 1 : 0;
}

// ── Aggregate factor extraction ──────────────────────────────────────────────

/** Compute every factor from context. Pure; no I/O. */
export function computeAllFactors(ctx: ForecastSubjectContext): EmergenceFactors {
  return {
    baselineProbability: scoreBaselineProbability(ctx),
    signalVolume: scoreSignalVolume(ctx),
    signalDiversity: scoreSignalDiversity(ctx),
    developerRecurrence: scoreDeveloperRecurrence(ctx),
    brokerRecurrence: scoreBrokerRecurrence(ctx),
    continuancePressure: scoreContinuancePressure(ctx),
    utilityExpansion: scoreUtilityExpansion(ctx),
    parcelPressure: scoreParcelPressure(ctx),
    pressuredNeighborCount: scorePressuredNeighborCount(ctx),
    shellPatternBoost: scoreShellPatternBoost(ctx),
    corridorBoost: scoreCorridorBoost(ctx),
    infrastructureBoost: scoreInfrastructureBoost(ctx),
    recencyMultiplier: computeRecencyMultiplier(ctx.daysSinceLastSignal),
  };
}

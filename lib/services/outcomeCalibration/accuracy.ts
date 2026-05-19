// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/outcomeCalibration/accuracy.ts
//  Phase MI-9 — Pure accuracy scoring.
//
//  Given a ForecastAssertion (what the engine said at prediction time) and
//  an ObservedOutcome (what actually happened), this module produces:
//
//    evaluateForecastAccuracy     — composite blend across all accuracy kinds
//    computeProbabilityAccuracy   — Brier-style 0..1 score on predictedScore
//    computeTimelineAccuracy      — per-milestone variance + band check
//    computeTrajectoryAccuracy    — predicted-vs-actual trajectory alignment
//    computeOutcomeKindAccuracy   — predicted outcome class vs observed
//
//  Pure — no DB. Writer.ts persists the produced rows.
//
//  Score conventions:
//    accuracyScore ∈ [0..1] where 1.0 = perfect, 0.0 = totally wrong.
//    Brier ∈ [0..1] where 0.0 = perfect, 1.0 = worst.
// ──────────────────────────────────────────────────────────────────────────────

import {
  type AccuracyComputation,
  type AccuracyKind,
  type ForecastAssertion,
  type ObservedOutcome,
  type ForecastEvaluation,
  type ResolutionState,
  type PredictionPosture,
  type TimelineAccuracyResult,
  type TrajectoryAccuracyResult,
  type TrajectoryAlignment,
  CALIBRATION_VERSION,
  COMPOSITE_ACCURACY_WEIGHTS,
  PARTIAL_BANDS,
  classifyPosture,
} from "./types";

// ── Outcome → "did it happen" boolean for probability scoring ────────────────
//
// Most outcome kinds signify "the predicted thing happened". A few invert
// it (PROJECT_ABANDONED / PROJECT_STALLED / ZONING_FAILED). When the outcome
// disconfirms a positive prediction, the indicator is 0.

const DISCONFIRMING_KINDS = new Set([
  "PROJECT_ABANDONED",
  "PROJECT_STALLED",
  "ZONING_FAILED",
]);

function outcomeIndicator(outcome: ObservedOutcome): 0 | 1 {
  return DISCONFIRMING_KINDS.has(outcome.outcomeKind) ? 0 : 1;
}

// ── Probability accuracy (Brier-based) ───────────────────────────────────────

export function computeProbabilityAccuracy(
  forecast: ForecastAssertion,
  outcome: ObservedOutcome
): AccuracyComputation {
  const indicator = outcomeIndicator(outcome);
  const p = clamp01(forecast.predictedScore);

  // Brier score: lower is better. (p - indicator)²
  const brier = (p - indicator) ** 2;
  // Map to accuracy in [0..1] — 1 - sqrt(brier) is intuitive and bounded.
  const accuracyScore = clamp01(1 - Math.sqrt(brier));

  const rationale = `predictedScore=${p.toFixed(3)}, indicator=${indicator}, brier=${brier.toFixed(3)}`;
  return {
    accuracyKind: "PROBABILITY",
    accuracyScore,
    brierScore: brier,
    timelineErrorDays: null,
    withinExpectedBand: null,
    rationale,
  };
}

// ── Timeline accuracy ────────────────────────────────────────────────────────

export interface TimelineComparison {
  milestoneKind: string;
  earliestAt: Date | null;
  expectedAt: Date | null;
  latestAt: Date | null;
  actualAt: Date;
  /** Optional jurisdiction-typical lag (days) read from ForecastCalibration. */
  jurisdictionLagDays?: number | null;
}

export function computeTimelineAccuracy(c: TimelineComparison): TimelineAccuracyResult {
  const expectedAt = c.expectedAt;
  const actualAt = c.actualAt;
  const errorDays = expectedAt ? daysBetween(expectedAt, actualAt) : 0;
  const absoluteErrorDays = Math.abs(errorDays);
  const withinBand =
    c.earliestAt != null &&
    c.latestAt != null &&
    actualAt.getTime() >= c.earliestAt.getTime() &&
    actualAt.getTime() <= c.latestAt.getTime();

  const lag = c.jurisdictionLagDays ?? null;
  const jurisdictionAdjustedErrorDays =
    lag != null && expectedAt ? errorDays - lag : null;

  // Accuracy score: 1.0 when within band, decays as we move outside.
  let accuracyScore: number;
  if (withinBand) {
    accuracyScore = 1;
  } else if (expectedAt) {
    // Exponential decay around expected: half-score at PARTIAL_DAYS,
    // approaching 0 at 4× partial days.
    accuracyScore = clamp01(
      Math.pow(0.5, absoluteErrorDays / PARTIAL_BANDS.TIMELINE_PARTIAL_DAYS)
    );
  } else {
    accuracyScore = 0;
  }

  const rationale = `expected=${expectedAt?.toISOString() ?? "null"}, actual=${actualAt.toISOString()}, errorDays=${errorDays.toFixed(0)}, withinBand=${withinBand}`;

  return {
    milestoneKind: c.milestoneKind,
    expectedAt,
    earliestAt: c.earliestAt,
    latestAt: c.latestAt,
    actualAt,
    errorDays,
    absoluteErrorDays,
    withinBand,
    jurisdictionAdjustedErrorDays,
    accuracyScore,
    rationale,
  };
}

/** Convenience: build a flat AccuracyComputation row from a TimelineAccuracyResult. */
export function timelineAccuracyToComputation(t: TimelineAccuracyResult): AccuracyComputation {
  return {
    accuracyKind: "TIMELINE",
    accuracyScore: t.accuracyScore,
    brierScore: null,
    timelineErrorDays: t.errorDays,
    withinExpectedBand: t.withinBand,
    rationale: t.rationale,
  };
}

// ── Trajectory accuracy ──────────────────────────────────────────────────────

export interface TrajectoryComparison {
  predictedState: string;
  actualState: string | null;
  /** Whether the engine flagged a momentum shift at prediction time. */
  engineFlaggedShift: boolean;
  /** Whether the outcome retrospectively indicates a shift was real. */
  outcomeImpliesShift: boolean;
}

const POSITIVE_STATES = new Set(["EMERGING", "IGNITING", "ACCELERATING", "STEADY"]);
const NEGATIVE_STATES = new Set(["DECELERATING", "STALLED", "DECAYING", "DORMANT"]);

export function computeTrajectoryAccuracy(c: TrajectoryComparison): TrajectoryAccuracyResult {
  let alignment: TrajectoryAlignment = "INCONCLUSIVE";
  let accuracyScore = 0.5;
  let shiftCorrect: boolean | null = null;
  let shiftMissed: boolean | null = null;
  let rationale = "";

  if (c.actualState == null) {
    rationale = "no_actual_state";
  } else if (c.predictedState === c.actualState) {
    alignment = "ALIGNED";
    accuracyScore = 1;
    rationale = `predicted=${c.predictedState} matched`;
  } else {
    // Positive-vs-negative regime alignment partial credit.
    const predPositive = POSITIVE_STATES.has(c.predictedState);
    const actPositive = POSITIVE_STATES.has(c.actualState);
    if (predPositive === actPositive) {
      alignment = "DIVERGED";
      accuracyScore = 0.5;
      rationale = `predicted=${c.predictedState} actual=${c.actualState} same_regime`;
    } else {
      alignment = "DIVERGED";
      accuracyScore = 0;
      rationale = `predicted=${c.predictedState} actual=${c.actualState} opposite_regime`;
    }
  }

  if (c.engineFlaggedShift && c.outcomeImpliesShift) {
    alignment = "EARLY_SHIFT";
    accuracyScore = Math.max(accuracyScore, 0.8);
    shiftCorrect = true;
    rationale = `${rationale} | engine_flagged_correct_shift`;
  } else if (!c.engineFlaggedShift && c.outcomeImpliesShift) {
    alignment = "MISSED_SHIFT";
    accuracyScore = Math.min(accuracyScore, 0.3);
    shiftMissed = true;
    rationale = `${rationale} | missed_shift`;
  }

  return {
    predictedState: c.predictedState,
    actualState: c.actualState,
    alignment,
    shiftCorrect,
    shiftMissed,
    accuracyScore,
    rationale,
  };
}

export function trajectoryAccuracyToComputation(t: TrajectoryAccuracyResult): AccuracyComputation {
  return {
    accuracyKind: "TRAJECTORY",
    accuracyScore: t.accuracyScore,
    brierScore: null,
    timelineErrorDays: null,
    withinExpectedBand: null,
    rationale: t.rationale,
  };
}

// ── Outcome-kind accuracy ────────────────────────────────────────────────────
//
// Some outcomes are "the predicted positive thing happened" (CONSTRUCTION_STARTED,
// PERMIT_ISSUED, BID_ISSUED, etc.). Others are "the prediction was wrong and
// the project died" (PROJECT_ABANDONED, ZONING_FAILED). This accuracy kind
// rewards 1.0 when prediction direction matches outcome direction.

export function computeOutcomeKindAccuracy(
  forecast: ForecastAssertion,
  outcome: ObservedOutcome
): AccuracyComputation {
  const indicator = outcomeIndicator(outcome);
  const p = clamp01(forecast.predictedScore);
  const predictsPositive = p >= 0.5;
  const outcomePositive = indicator === 1;

  const accuracyScore = predictsPositive === outcomePositive ? 1 : 0;
  const rationale = `outcomeKind=${outcome.outcomeKind} indicator=${indicator} predictsPositive=${predictsPositive} match=${accuracyScore === 1}`;
  return {
    accuracyKind: "OUTCOME_KIND",
    accuracyScore,
    brierScore: null,
    timelineErrorDays: null,
    withinExpectedBand: null,
    rationale,
  };
}

// ── Top-level: evaluateForecastAccuracy ──────────────────────────────────────

export interface EvaluateForecastAccuracyInput {
  forecast: ForecastAssertion;
  outcome: ObservedOutcome;
  /** Pre-computed trajectory comparison from the caller; omit when the
   *  caller doesn't have actual-state data yet. */
  trajectory?: TrajectoryComparison;
  /** Optional jurisdictionLagDays for any timeline comparisons. */
  jurisdictionLagDays?: number | null;
}

export function evaluateForecastAccuracy(input: EvaluateForecastAccuracyInput): ForecastEvaluation {
  const { forecast, outcome } = input;
  const posture = classifyPosture(forecast.predictedScore);
  const leadTimeDays = daysBetween(forecast.predictedAt, outcome.occurredAt);

  const accuracies: AccuracyComputation[] = [];

  const probAccuracy = computeProbabilityAccuracy(forecast, outcome);
  accuracies.push(probAccuracy);

  const outcomeKindAcc = computeOutcomeKindAccuracy(forecast, outcome);
  accuracies.push(outcomeKindAcc);

  if (input.trajectory) {
    const trajResult = computeTrajectoryAccuracy(input.trajectory);
    accuracies.push(trajectoryAccuracyToComputation(trajResult));
  }

  if (forecast.expectedTimeline && outcome.observedMilestones) {
    for (const [milestoneKind, observedAt] of Object.entries(outcome.observedMilestones)) {
      const slot = forecast.expectedTimeline[milestoneKind];
      if (!slot) continue;
      const tl = computeTimelineAccuracy({
        milestoneKind,
        earliestAt: slot.earliest,
        expectedAt: slot.expected,
        latestAt: slot.latest,
        actualAt: observedAt,
        jurisdictionLagDays: input.jurisdictionLagDays ?? null,
      });
      accuracies.push(timelineAccuracyToComputation(tl));
    }
  }

  const compositeAccuracy = computeCompositeAccuracy(accuracies);
  const resolutionState = resolutionStateFor(
    probAccuracy.accuracyScore,
    accuracies.find((a) => a.accuracyKind === "TIMELINE")?.accuracyScore ?? null
  );

  const compositeComp: AccuracyComputation = {
    accuracyKind: "COMPOSITE",
    accuracyScore: compositeAccuracy,
    brierScore: null,
    timelineErrorDays: null,
    withinExpectedBand: null,
    rationale: `weighted_blend across ${accuracies.length} kinds`,
  };
  accuracies.push(compositeComp);

  return {
    resolutionState,
    predictionPosture: posture,
    leadTimeDays,
    accuracies,
    compositeAccuracy,
    rationale: `posture=${posture} composite=${compositeAccuracy.toFixed(3)} resolution=${resolutionState}`,
    evaluationVersion: CALIBRATION_VERSION,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeCompositeAccuracy(accuracies: AccuracyComputation[]): number {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const a of accuracies) {
    if (a.accuracyKind === "COMPOSITE") continue;
    const w = COMPOSITE_ACCURACY_WEIGHTS[a.accuracyKind] ?? 0;
    weightedSum += a.accuracyScore * w;
    weightTotal += w;
  }
  return weightTotal > 0 ? clamp01(weightedSum / weightTotal) : 0;
}

function resolutionStateFor(
  probabilityAccuracy: number,
  timelineAccuracy: number | null
): ResolutionState {
  // Direct-match rules:
  //   probability ≥ 0.80 → CONFIRMED unless timeline is far off.
  //   probability ≤ 0.20 → DISCONFIRMED.
  //   anything between with timeline within partial band → PARTIAL.
  if (probabilityAccuracy >= 0.80) {
    if (timelineAccuracy == null || timelineAccuracy >= 0.4) return "CONFIRMED";
    return "PARTIAL";
  }
  if (probabilityAccuracy <= 0.20) {
    return "DISCONFIRMED";
  }
  return "PARTIAL";
}

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// Re-export for convenience.
export type {
  PredictionPosture,
  ResolutionState,
  AccuracyComputation,
  ForecastEvaluation,
  AccuracyKind,
};

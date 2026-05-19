// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/outcomeCalibration/detectors.ts
//  Phase MI-9 — False-positive + false-negative detection.
//
//  Pure functions that classify forecast / outcome combinations as
//  false positives or false negatives and assign a structured reasonClass
//  for downstream calibration tuning.
//
//  False positive: an engine forecast at HIGH_CONF or MEDIUM_CONF that did
//  NOT materialize within the latest expected milestone window. The
//  detection runs on a SCHEDULE — the orchestrator passes in the relevant
//  forecast plus the expected-by-date and asks "did anything confirm this?"
//
//  False negative: an outcome with no preceding HIGH_CONF forecast in the
//  observable lead-time window. Triggered when an Outcome is captured.
//
//  No DB calls here — the orchestrator queries forecast / outcome / signal
//  state and passes it in.
// ──────────────────────────────────────────────────────────────────────────────

import {
  type ForecastAssertion,
  type ObservedOutcome,
  type FalsePositiveReason,
  type FalseNegativeReason,
} from "./types";

// ── False positive ───────────────────────────────────────────────────────────

export interface FalsePositiveDetectionInput {
  forecast: ForecastAssertion;
  /** Latest expected-by date the forecast committed to (e.g.
   *  ExpectedTimeline.latestEstimate for the CONSTRUCTION_START milestone). */
  expectedByLatest: Date;
  /** Reference date — usually now(). */
  referenceDate?: Date;
  /** All outcomes recorded for the subject after predictedAt. The detector
   *  classifies as false positive when this list is empty OR the only
   *  outcomes are disconfirming-kind. */
  outcomesSincePrediction: Array<{
    outcomeId: string;
    outcomeKind: string;
    occurredAt: Date;
  }>;
  /** Subject-state hints to drive reasonClass selection — operator-tunable
   *  thresholds in the calling code. */
  hints?: {
    overweightDeveloper?: boolean;
    overweightContinuance?: boolean;
    overweightUtility?: boolean;
    staleSignalCarryover?: boolean;
    jurisdictionLagUnderestimated?: boolean;
    shellClusterMisread?: boolean;
  };
}

export interface FalsePositiveDetection {
  isFalsePositive: boolean;
  reasonClass: FalsePositiveReason;
  rationale: string;
  disconfirmingOutcomeId: string | null;
}

const DISCONFIRMING_KINDS = new Set([
  "PROJECT_ABANDONED",
  "PROJECT_STALLED",
  "ZONING_FAILED",
]);

const CONFIRMING_KINDS = new Set([
  "CONSTRUCTION_STARTED",
  "PERMIT_ISSUED",
  "BID_ISSUED",
  "SHELL_REALIZED",
  "FRANCHISE_ROLLOUT_CONFIRMED",
  "UTILITY_EXPANSION_COMPLETED",
  "CORRIDOR_ACCELERATION_CONFIRMED",
]);

export function detectFalsePositive(input: FalsePositiveDetectionInput): FalsePositiveDetection {
  const ref = input.referenceDate ?? new Date();
  const passedDeadline = ref.getTime() >= input.expectedByLatest.getTime();
  const score = input.forecast.predictedScore;

  // Only consider HIGH / MEDIUM conf predictions as candidates.
  if (score < 0.35) {
    return {
      isFalsePositive: false,
      reasonClass: "OTHER",
      rationale: `predictedScore ${score.toFixed(2)} below MEDIUM_CONF threshold; not a candidate`,
      disconfirmingOutcomeId: null,
    };
  }

  const confirming = input.outcomesSincePrediction.find((o) =>
    CONFIRMING_KINDS.has(o.outcomeKind)
  );
  const disconfirming = input.outcomesSincePrediction.find((o) =>
    DISCONFIRMING_KINDS.has(o.outcomeKind)
  );

  if (confirming) {
    return {
      isFalsePositive: false,
      reasonClass: "OTHER",
      rationale: `confirming outcome ${confirming.outcomeKind} on ${confirming.occurredAt.toISOString()}`,
      disconfirmingOutcomeId: null,
    };
  }

  // No confirming outcome. False-positive only if deadline passed OR
  // explicit disconfirming outcome was observed.
  if (!passedDeadline && !disconfirming) {
    return {
      isFalsePositive: false,
      reasonClass: "OTHER",
      rationale: `deadline not yet reached (${input.expectedByLatest.toISOString()})`,
      disconfirmingOutcomeId: null,
    };
  }

  const reasonClass = pickFalsePositiveReason(input.hints);
  const rationale = disconfirming
    ? `disconfirmed by ${disconfirming.outcomeKind} on ${disconfirming.occurredAt.toISOString()}`
    : `deadline ${input.expectedByLatest.toISOString()} passed with no confirming outcome; predicted score ${score.toFixed(2)}`;

  return {
    isFalsePositive: true,
    reasonClass,
    rationale,
    disconfirmingOutcomeId: disconfirming?.outcomeId ?? null,
  };
}

function pickFalsePositiveReason(
  hints: FalsePositiveDetectionInput["hints"]
): FalsePositiveReason {
  if (!hints) return "OTHER";
  if (hints.shellClusterMisread) return "SHELL_CLUSTER_MISREAD";
  if (hints.jurisdictionLagUnderestimated) return "JURISDICTION_LAG_UNDERESTIMATED";
  if (hints.staleSignalCarryover) return "STALE_SIGNAL_CARRYOVER";
  if (hints.overweightDeveloper) return "OVERWEIGHTED_DEVELOPER";
  if (hints.overweightContinuance) return "OVERWEIGHTED_CONTINUANCE";
  if (hints.overweightUtility) return "OVERWEIGHTED_UTILITY";
  return "OTHER";
}

// ── False negative ───────────────────────────────────────────────────────────

export interface FalseNegativeDetectionInput {
  outcome: ObservedOutcome;
  /** Most-recent forecast for the same subject preceding the outcome (if
   *  any). When null, the outcome was a complete miss. */
  precedingForecast: ForecastAssertion | null;
  /** Hints from the orchestrator about why this might have been missed.
   *  Same pattern as the false-positive hints. */
  hints?: {
    underweightParcel?: boolean;
    underweightInfrastructure?: boolean;
    missedCorridorIgnition?: boolean;
    missedFranchisePattern?: boolean;
    newSignalType?: boolean;
  };
}

export interface FalseNegativeDetection {
  isFalseNegative: boolean;
  reasonClass: FalseNegativeReason;
  rationale: string;
  missedByDays: number | null;
}

const POSITIVE_OUTCOMES = new Set([
  "CONSTRUCTION_STARTED",
  "PERMIT_ISSUED",
  "BID_ISSUED",
  "SHELL_REALIZED",
  "FRANCHISE_ROLLOUT_CONFIRMED",
  "UTILITY_EXPANSION_COMPLETED",
  "CORRIDOR_ACCELERATION_CONFIRMED",
]);

export function detectFalseNegative(input: FalseNegativeDetectionInput): FalseNegativeDetection {
  // Only "positive" outcomes are candidates for false-negative detection —
  // a project abandonment doesn't mean we missed a forecast.
  if (!POSITIVE_OUTCOMES.has(input.outcome.outcomeKind)) {
    return {
      isFalseNegative: false,
      reasonClass: "OTHER",
      rationale: `outcomeKind ${input.outcome.outcomeKind} not positive; not a candidate`,
      missedByDays: null,
    };
  }

  // If we had a HIGH_CONF forecast preceding, that's not a false negative.
  if (input.precedingForecast && input.precedingForecast.predictedScore >= 0.60) {
    return {
      isFalseNegative: false,
      reasonClass: "OTHER",
      rationale: `preceding forecast scored ${input.precedingForecast.predictedScore.toFixed(2)} (HIGH)`,
      missedByDays: null,
    };
  }

  const missedByDays = input.precedingForecast
    ? (input.outcome.occurredAt.getTime() - input.precedingForecast.predictedAt.getTime()) / (24 * 60 * 60 * 1000)
    : null;

  const reasonClass = pickFalseNegativeReason(input.hints);
  const rationale = input.precedingForecast
    ? `preceding forecast scored ${input.precedingForecast.predictedScore.toFixed(2)} (LOW); outcome on ${input.outcome.occurredAt.toISOString()}`
    : `no preceding forecast; outcome on ${input.outcome.occurredAt.toISOString()}`;

  return {
    isFalseNegative: true,
    reasonClass,
    rationale,
    missedByDays,
  };
}

function pickFalseNegativeReason(
  hints: FalseNegativeDetectionInput["hints"]
): FalseNegativeReason {
  if (!hints) return "OTHER";
  if (hints.newSignalType) return "NEW_SIGNAL_TYPE";
  if (hints.missedCorridorIgnition) return "MISSED_CORRIDOR_IGNITION";
  if (hints.missedFranchisePattern) return "MISSED_FRANCHISE_PATTERN";
  if (hints.underweightParcel) return "UNDERWEIGHTED_PARCEL";
  if (hints.underweightInfrastructure) return "UNDERWEIGHTED_INFRASTRUCTURE";
  return "OTHER";
}

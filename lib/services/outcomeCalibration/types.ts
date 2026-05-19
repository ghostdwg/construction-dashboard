// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/outcomeCalibration/types.ts
//  Phase MI-9 — Outcome Tracking + Forecast Calibration types and pseudo-enums.
// ──────────────────────────────────────────────────────────────────────────────

export const OUTCOME_KINDS = [
  "CONSTRUCTION_STARTED",
  "PERMIT_ISSUED",
  "BID_ISSUED",
  "PROJECT_ABANDONED",
  "PROJECT_STALLED",
  "TIMELINE_SLIPPED",
  "SHELL_REALIZED",
  "FRANCHISE_ROLLOUT_CONFIRMED",
  "ZONING_FAILED",
  "UTILITY_EXPANSION_COMPLETED",
  "CORRIDOR_ACCELERATION_CONFIRMED",
  "OTHER",
] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

export const DETECTION_METHODS = [
  "AUTOMATIC",        // engine detected from signal stream
  "OPERATOR_REPORTED",// operator manually filed
  "EXTERNAL_FEED",    // permit feed, press release ingestion
  "INFERRED",         // inferred from downstream evidence
] as const;
export type DetectionMethod = (typeof DETECTION_METHODS)[number];

export const EVIDENCE_KINDS = [
  "MARKET_SIGNAL",
  "DOCUMENT",
  "PRESS_RELEASE",
  "OPERATOR_NOTE",
  "EXTERNAL_FEED",
  "PHOTO",
  "OTHER",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const RESOLUTION_STATES = [
  "PENDING",       // outcome captured but not yet scored against a forecast
  "CONFIRMED",     // forecast correctly anticipated this outcome
  "PARTIAL",       // forecast roughly right (close on probability OR timeline)
  "DISCONFIRMED",  // forecast was wrong
  "DISPUTED",      // operator dispute; pending re-resolution
  "WITHDRAWN",     // outcome retracted (replaced via supersededByOutcomeId)
] as const;
export type ResolutionState = (typeof RESOLUTION_STATES)[number];

export const PREDICTION_POSTURES = [
  "HIGH_CONF_PREDICTED",
  "MEDIUM_CONF_PREDICTED",
  "LOW_CONF_PREDICTED",
  "UNPREDICTED",
] as const;
export type PredictionPosture = (typeof PREDICTION_POSTURES)[number];

export const ACCURACY_KINDS = [
  "PROBABILITY",
  "TIMELINE",
  "TRAJECTORY",
  "OUTCOME_KIND",
  "CORRIDOR",
  "COMPOSITE",
] as const;
export type AccuracyKind = (typeof ACCURACY_KINDS)[number];

export const TRAJECTORY_ALIGNMENTS = [
  "ALIGNED",       // predicted trajectory state matched actual progression
  "DIVERGED",      // predicted state ≠ actual; mid-confidence error
  "EARLY_SHIFT",   // engine fired shiftDetected and it was correct
  "MISSED_SHIFT",  // engine missed a shift that the outcome reveals
  "INCONCLUSIVE",  // not enough data
] as const;
export type TrajectoryAlignment = (typeof TRAJECTORY_ALIGNMENTS)[number];

export const FALSE_POSITIVE_REASONS = [
  "OVERWEIGHTED_DEVELOPER",
  "OVERWEIGHTED_CONTINUANCE",
  "OVERWEIGHTED_UTILITY",
  "STALE_SIGNAL_CARRYOVER",
  "JURISDICTION_LAG_UNDERESTIMATED",
  "SHELL_CLUSTER_MISREAD",
  "OTHER",
] as const;
export type FalsePositiveReason = (typeof FALSE_POSITIVE_REASONS)[number];

export const FALSE_NEGATIVE_REASONS = [
  "UNDERWEIGHTED_PARCEL",
  "UNDERWEIGHTED_INFRASTRUCTURE",
  "MISSED_CORRIDOR_IGNITION",
  "MISSED_FRANCHISE_PATTERN",
  "NEW_SIGNAL_TYPE",
  "OTHER",
] as const;
export type FalseNegativeReason = (typeof FALSE_NEGATIVE_REASONS)[number];

export const CALIBRATION_SCOPES = [
  "GLOBAL",
  "JURISDICTION",
  "CORRIDOR",
  "SUBJECT_KIND",
  "FACTOR",
] as const;
export type CalibrationScope = (typeof CALIBRATION_SCOPES)[number];

export const ADJUSTMENT_KINDS = [
  "WEIGHT_MULTIPLIER",
  "DECAY_OVERRIDE",
  "LAG_DAYS",
  "THRESHOLD_OVERRIDE",
] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

// Bumps when calibration policy / accuracy algorithms change. Recorded on
// every accuracy / calibration row so future re-runs know which generation
// produced them and can re-evaluate selectively.
export const CALIBRATION_VERSION = "v1" as const;

// ─── Wire shapes ─────────────────────────────────────────────────────────────

/** What "the forecast" said at prediction time — captured here as a flat
 *  bag so accuracy services don't need a Prisma join just to score. */
export interface ForecastAssertion {
  forecastSnapshotId: string;
  predictedScore: number;          // [0..1]
  predictedTrajectory: string;
  predictedAt: Date;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  /** Map of milestoneKind → { earliest, expected, latest } at prediction time. */
  expectedTimeline?: Record<string, {
    earliest: Date | null;
    expected: Date | null;
    latest: Date | null;
  }>;
}

/** What actually happened. */
export interface ObservedOutcome {
  outcomeId: string;
  outcomeKind: OutcomeKind;
  occurredAt: Date;
  /** Optional structured map of milestones that actually completed and
   *  their actual completion date. Used by computeTimelineAccuracy. */
  observedMilestones?: Record<string, Date>;
}

/** Posture classification by predicted score. Operator-tunable thresholds. */
export const POSTURE_THRESHOLDS = {
  HIGH: 0.60,
  MEDIUM: 0.35,
  LOW: 0.15,
} as const;

export function classifyPosture(predictedScore: number): PredictionPosture {
  if (predictedScore >= POSTURE_THRESHOLDS.HIGH) return "HIGH_CONF_PREDICTED";
  if (predictedScore >= POSTURE_THRESHOLDS.MEDIUM) return "MEDIUM_CONF_PREDICTED";
  if (predictedScore >= POSTURE_THRESHOLDS.LOW) return "LOW_CONF_PREDICTED";
  return "UNPREDICTED";
}

/** Per-accuracy-kind result. */
export interface AccuracyComputation {
  accuracyKind: AccuracyKind;
  accuracyScore: number;         // [0..1]
  brierScore: number | null;     // for PROBABILITY kind
  timelineErrorDays: number | null;
  withinExpectedBand: boolean | null;
  rationale: string;
}

/** Aggregate result for a single (forecast, outcome) evaluation. */
export interface ForecastEvaluation {
  resolutionState: ResolutionState;
  predictionPosture: PredictionPosture;
  leadTimeDays: number;
  accuracies: AccuracyComputation[];
  compositeAccuracy: number;     // weighted blend of accuracies
  rationale: string;
  evaluationVersion: typeof CALIBRATION_VERSION;
}

/** Acceptable "near miss" bands per accuracy kind. Tunable. */
export const PARTIAL_BANDS = {
  /** PARTIAL when |predicted - outcomeIndicator| ≤ this on probability scale. */
  PROBABILITY_PARTIAL_BAND: 0.20,
  /** PARTIAL when |timeline error| ≤ this many days. */
  TIMELINE_PARTIAL_DAYS: 60,
} as const;

export interface TimelineAccuracyResult {
  milestoneKind: string;
  expectedAt: Date | null;
  earliestAt: Date | null;
  latestAt: Date | null;
  actualAt: Date;
  errorDays: number;             // positive = late
  absoluteErrorDays: number;
  withinBand: boolean;
  jurisdictionAdjustedErrorDays: number | null;
  accuracyScore: number;         // [0..1]
  rationale: string;
}

export interface TrajectoryAccuracyResult {
  predictedState: string;
  actualState: string | null;
  alignment: TrajectoryAlignment;
  shiftCorrect: boolean | null;
  shiftMissed: boolean | null;
  accuracyScore: number;         // [0..1]
  rationale: string;
}

export interface JurisdictionCalibrationResult {
  jurisdictionKey: string;
  resolutionCount: number;
  confirmedCount: number;
  disconfirmedCount: number;
  partialCount: number;
  meanProbabilityAccuracy: number | null;
  meanBrierScore: number | null;
  meanTimelineErrorDays: number | null;
  typicalLagDays: number | null;
  trajectoryAlignmentRate: number | null;
  falsePositiveCount: number;
  falseNegativeCount: number;
  recommendedAdjustments: Array<{
    factorName: string;
    adjustmentKind: AdjustmentKind;
    value: number;
    rationale: string;
  }>;
  reasonLog: string[];
}

export interface CorridorCalibrationResult {
  corridorKey: string;
  resolutionCount: number;
  confirmedCount: number;
  disconfirmedCount: number;
  meanProbabilityAccuracy: number | null;
  shellRealizationRate: number | null;     // outcomes/predictions for SHELL_REALIZED
  falsePositiveRate: number | null;
  recommendedAdjustments: Array<{
    factorName: string;
    adjustmentKind: AdjustmentKind;
    value: number;
    rationale: string;
  }>;
  reasonLog: string[];
}

/** Operator-facing actor context. */
export interface OutcomeActorContext {
  userId: string | null;
  email: string | null;
}

/** Default seed rows for the ResolutionState policy table. Loaded by the
 *  MI-9 PR-2 backfill runner. Encoded as data, not migration text, so
 *  re-seeding is operator-controlled. */
export const RESOLUTION_STATE_SEEDS: Array<{
  state: ResolutionState;
  label: string;
  description: string;
  allowedTransitions: ResolutionState[];
  contributesToAccuracy: boolean;
}> = [
  { state: "PENDING", label: "Pending",
    description: "Outcome captured; not yet evaluated against any forecast.",
    allowedTransitions: ["CONFIRMED", "PARTIAL", "DISCONFIRMED", "WITHDRAWN"],
    contributesToAccuracy: false },
  { state: "CONFIRMED", label: "Confirmed",
    description: "Forecast correctly anticipated this outcome.",
    allowedTransitions: ["DISPUTED", "WITHDRAWN"],
    contributesToAccuracy: true },
  { state: "PARTIAL", label: "Partial",
    description: "Forecast was roughly right (one dimension correct, another off).",
    allowedTransitions: ["CONFIRMED", "DISCONFIRMED", "DISPUTED", "WITHDRAWN"],
    contributesToAccuracy: true },
  { state: "DISCONFIRMED", label: "Disconfirmed",
    description: "Forecast was wrong.",
    allowedTransitions: ["PARTIAL", "DISPUTED", "WITHDRAWN"],
    contributesToAccuracy: true },
  { state: "DISPUTED", label: "Disputed",
    description: "Operator dispute; pending re-resolution.",
    allowedTransitions: ["CONFIRMED", "PARTIAL", "DISCONFIRMED", "WITHDRAWN"],
    contributesToAccuracy: false },
  { state: "WITHDRAWN", label: "Withdrawn",
    description: "Outcome retracted; superseded by a new outcome.",
    allowedTransitions: [],
    contributesToAccuracy: false },
];

/** Composite weighting across accuracy kinds. Sum need not equal 1. */
export const COMPOSITE_ACCURACY_WEIGHTS: Record<AccuracyKind, number> = {
  PROBABILITY: 3,
  TIMELINE: 2,
  TRAJECTORY: 2,
  OUTCOME_KIND: 2,
  CORRIDOR: 1,
  COMPOSITE: 0, // composite is computed, not measured
};

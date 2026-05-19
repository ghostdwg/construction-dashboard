// Phase MI-9 — public API for outcome tracking + forecast calibration.

export {
  OUTCOME_KINDS,
  DETECTION_METHODS,
  EVIDENCE_KINDS,
  RESOLUTION_STATES,
  PREDICTION_POSTURES,
  ACCURACY_KINDS,
  TRAJECTORY_ALIGNMENTS,
  FALSE_POSITIVE_REASONS,
  FALSE_NEGATIVE_REASONS,
  CALIBRATION_SCOPES,
  ADJUSTMENT_KINDS,
  CALIBRATION_VERSION,
  POSTURE_THRESHOLDS,
  PARTIAL_BANDS,
  RESOLUTION_STATE_SEEDS,
  COMPOSITE_ACCURACY_WEIGHTS,
  classifyPosture,
  type OutcomeKind,
  type DetectionMethod,
  type EvidenceKind,
  type ResolutionState,
  type PredictionPosture,
  type AccuracyKind,
  type TrajectoryAlignment,
  type FalsePositiveReason,
  type FalseNegativeReason,
  type CalibrationScope,
  type AdjustmentKind,
  type ForecastAssertion,
  type ObservedOutcome,
  type AccuracyComputation,
  type ForecastEvaluation,
  type TimelineAccuracyResult,
  type TrajectoryAccuracyResult,
  type JurisdictionCalibrationResult,
  type CorridorCalibrationResult,
  type OutcomeActorContext,
} from "./types";

export {
  evaluateForecastAccuracy,
  computeProbabilityAccuracy,
  computeTimelineAccuracy,
  computeTrajectoryAccuracy,
  computeOutcomeKindAccuracy,
  timelineAccuracyToComputation,
  trajectoryAccuracyToComputation,
  type EvaluateForecastAccuracyInput,
  type TimelineComparison,
  type TrajectoryComparison,
} from "./accuracy";

export {
  detectFalsePositive,
  detectFalseNegative,
  type FalsePositiveDetectionInput,
  type FalsePositiveDetection,
  type FalseNegativeDetectionInput,
  type FalseNegativeDetection,
} from "./detectors";

export {
  computeJurisdictionCalibration,
  computeCorridorCalibration,
  calibrateForecastWeights,
  type JurisdictionCalibrationInput,
  type CorridorCalibrationInput,
  type CalibrateForecastWeightsInput,
  type CalibrateForecastWeightsResult,
  type CalibrationRecommendation,
  type ResolutionAggregateRow,
} from "./calibration";

export {
  recordOutcome,
  recordResolution,
  recordFalsePositive,
  recordFalseNegative,
  upsertCalibrationAdjustment,
  recordCalibrationSnapshot,
  type RecordOutcomeInput,
  type RecordOutcomeResult,
  type RecordResolutionInput,
  type RecordResolutionResult,
  type RecordFalsePositiveInput,
  type RecordFalseNegativeInput,
  type UpsertCalibrationAdjustmentInput,
  type RecordCalibrationSnapshotInput,
} from "./writer";

export { emitCalibrationAudit } from "./audit";

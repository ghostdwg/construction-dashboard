// Phase MI-8 — public API for the Emergence Probability Engine.

export {
  SUBJECT_KINDS,
  TRAJECTORY_STATES,
  TREND_DIRECTIONS,
  MILESTONE_KINDS,
  CADENCE_CLASSES,
  CORRIDOR_HEAT_CLASSIFICATIONS,
  DEVELOPER_MOMENTUM_CLASSIFICATIONS,
  SIGNAL_DECAY_CURVES,
  FORECAST_REVIEW_STATES,
  FORECAST_FACTOR_KINDS,
  FORECAST_CONFIDENCES,
  FORECAST_VERSION,
  FACTOR_WEIGHTS,
  RECENCY_HALF_LIFE_DAYS,
  TRAJECTORY_THRESHOLDS,
  DEFAULT_SIGNAL_DECAY_PROFILES,
  type SubjectKind,
  type TrajectoryState,
  type TrendDirection,
  type MilestoneKind,
  type CadenceClass,
  type CorridorHeatClassification,
  type DeveloperMomentumClassification,
  type SignalDecayCurve,
  type ForecastReviewState,
  type ForecastFactorKind,
  type ForecastConfidence,
  type ForecastSubjectContext,
  type EmergenceFactors,
  type EmergenceScoreResult,
  type ForecastContribution,
  type AccelerationResult,
  type TrajectoryDecision,
  type CorridorHeatResult,
  type JurisdictionVelocityResult,
  type DevelopmentMomentumResult,
  type ExpectedTimelinePoint,
  type ForecastActorContext,
} from "./types";

export {
  computeAllFactors,
  computeRecencyMultiplier,
  expSaturate,
  linearSaturate,
  scoreBaselineProbability,
  scoreSignalVolume,
  scoreSignalDiversity,
  scoreDeveloperRecurrence,
  scoreBrokerRecurrence,
  scoreContinuancePressure,
  scoreUtilityExpansion,
  scoreParcelPressure,
  scorePressuredNeighborCount,
  scoreShellPatternBoost,
  scoreCorridorBoost,
  scoreInfrastructureBoost,
} from "./heuristics";

export {
  computeAcceleration,
  classifyTrajectory,
  detectEmergenceDecay,
  detectMomentumShift,
  type ScoreObservation,
} from "./trajectory";

export {
  computeCorridorHeat,
  classifyCorridorHeat,
  type CorridorMember,
  type CorridorHeatInput,
} from "./corridorHeat";

export {
  computeJurisdictionVelocity,
  classifyCadence,
  type JurisdictionVelocityInput,
} from "./jurisdictionVelocity";

export {
  computeDevelopmentMomentum,
  classifyDeveloperMomentum,
  type DevelopmentMomentumInput,
} from "./developmentMomentum";

export {
  computeExpectedTimeline,
  type ExpectedTimelineInput,
} from "./timeline";

export {
  computeEmergenceScore,
  getRecencyMultiplier,
} from "./forecast";

export {
  persistForecast,
  overrideForecast,
  type PersistForecastInput,
  type PersistForecastResult,
} from "./writer";

export { emitForecastAudit } from "./audit";

// O2.2 PR7 — context-assembly + subject-selection helpers for the
// forecast-daily runner.
export {
  buildForecastSubjectContext,
  selectActiveForecastSubjects,
  type BuildContextOptions,
  type ActiveForecastSubject,
  type SelectActiveForecastSubjectsOptions,
} from "./buildContext";

export {
  checkForecastGates,
  FORECAST_GATES_VERSION,
  MIN_MARKET_SIGNALS,
  MIN_PROJECTS,
  MIN_SOURCES_WITH_CADENCE,
  RECENT_RUNNER_ERROR_WINDOW_HOURS,
  GATING_RUNNER_NAMES,
  type GateName,
  type GateResult,
  type ForecastGatesReport,
} from "./forecastGates";

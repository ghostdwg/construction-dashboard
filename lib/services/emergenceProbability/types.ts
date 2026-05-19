// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/emergenceProbability/types.ts
//  Phase MI-8 — Emergence Probability Engine types and pseudo-enums.
//
//  Pseudo-enums are exported as `as const` arrays + derived union types so:
//   - Prisma schema columns can stay TEXT (no migration needed to add values)
//   - app code gets compile-time exhaustiveness
//   - JSON/AI payloads can validate against the array at runtime
// ──────────────────────────────────────────────────────────────────────────────

export const SUBJECT_KINDS = [
  "PROJECT",
  "PARCEL",
  "CORRIDOR",
  "JURISDICTION",
  "DEVELOPER",
] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export const TRAJECTORY_STATES = [
  "EMERGING",       // first signals; score low but rising
  "IGNITING",       // recent positive acceleration from a cold start
  "ACCELERATING",   // sustained positive acceleration
  "STEADY",         // small derivative, high score
  "DECELERATING",   // negative acceleration, score still > 0
  "STALLED",        // low derivative + low new-signal volume
  "DECAYING",       // sustained negative acceleration; score falling
  "DORMANT",        // long period without signals; archived state
] as const;
export type TrajectoryState = (typeof TRAJECTORY_STATES)[number];

export const TREND_DIRECTIONS = ["UP", "DOWN", "FLAT"] as const;
export type TrendDirection = (typeof TREND_DIRECTIONS)[number];

export const MILESTONE_KINDS = [
  "ENTITLEMENT_START",
  "ENTITLEMENT_DECISION",
  "PERMIT_ISSUED",
  "SITE_PREP_START",
  "CONSTRUCTION_START",
  "COMPLETION",
] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

export const CADENCE_CLASSES = ["HOT", "WARM", "STEADY", "COOLING", "COLD"] as const;
export type CadenceClass = (typeof CADENCE_CLASSES)[number];

export const CORRIDOR_HEAT_CLASSIFICATIONS = [
  "IGNITING",
  "HOT",
  "WARM",
  "STEADY",
  "COOLING",
] as const;
export type CorridorHeatClassification = (typeof CORRIDOR_HEAT_CLASSIFICATIONS)[number];

export const DEVELOPER_MOMENTUM_CLASSIFICATIONS = [
  "ACCELERATING",
  "SUSTAINED",
  "FADING",
  "DORMANT",
] as const;
export type DeveloperMomentumClassification =
  (typeof DEVELOPER_MOMENTUM_CLASSIFICATIONS)[number];

export const SIGNAL_DECAY_CURVES = [
  "EXPONENTIAL",
  "LINEAR",
  "STEP",
  "SUSTAINED",
] as const;
export type SignalDecayCurve = (typeof SIGNAL_DECAY_CURVES)[number];

export const FORECAST_REVIEW_STATES = [
  "AUTO",
  "PENDING_REVIEW",
  "VERIFIED",
  "OVERRIDDEN",
  "SUPPRESSED",
] as const;
export type ForecastReviewState = (typeof FORECAST_REVIEW_STATES)[number];

export const FORECAST_FACTOR_KINDS = [
  "SIGNAL_CONTRIBUTION",
  "ENTITY_INFLUENCE",
  "PARCEL_INFLUENCE",
  "JURISDICTION_PATTERN",
  "TEMPORAL_DECAY",
  "TRAJECTORY_SHIFT",
  "CORRIDOR_HEAT",
  "OTHER",
] as const;
export type ForecastFactorKind = (typeof FORECAST_FACTOR_KINDS)[number];

export const FORECAST_CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;
export type ForecastConfidence = (typeof FORECAST_CONFIDENCES)[number];

// Bumps when forecasting logic / weights change. Future re-runs check this
// to decide whether to re-evaluate historical forecasts.
export const FORECAST_VERSION = "v1" as const;

// ─── Wire shapes ─────────────────────────────────────────────────────────────

/** A normalized projection of a subject's accumulated state used as the
 *  scoring input. Pre-built once per forecast run so the per-factor scorers
 *  can stay pure. */
export interface ForecastSubjectContext {
  subjectKind: SubjectKind;
  subjectId: string;
  /** When the subject is a Project or Parcel, the corresponding row id. */
  projectId: string | null;
  parcelId: string | null;
  jurisdictionKey: string | null;

  /** Most recent MI-6 ProjectProbabilitySnapshot value (when subject is
   *  PROJECT or transitively known via attached parcels). */
  latestProjectProbability: number | null;
  /** Most recent MI-7 ParcelPressureSnapshot mean for attached parcels (or
   *  the parcel itself when subject is PARCEL). */
  latestParcelPressureMean: number | null;
  /** Mean MI-6 probability over the last 30d / 90d / 365d. */
  probabilityMean30d: number | null;
  probabilityMean90d: number | null;
  probabilityMean365d: number | null;
  /** Count of distinct new-signal observations attached in the recent
   *  windows. The engine relies on volume + diversity. */
  signalCountLast30d: number;
  signalCountLast90d: number;
  signalCountLast365d: number;
  /** Distinct developer-role entity ids touching this subject. */
  developerEntityIds: string[];
  /** Distinct broker-role entity ids touching this subject. */
  brokerEntityIds: string[];
  /** Continuance count across attached agenda-bearing signals. */
  continuanceCount: number;
  /** Active utility-expansion rows (PROPOSED / UNDER_CONSTRUCTION). */
  activeUtilityExpansions: number;
  /** Pressured-neighbor count (parcels with pressureScore ≥ 0.5). */
  pressuredNeighborCount: number;
  /** Whether the subject sits on a known corridor. */
  onCorridor: boolean;
  /** Whether infrastructure-investment markers are present. */
  hasInfrastructureInvestment: boolean;
  /** Days since the latest signal observation. */
  daysSinceLastSignal: number;
  /** True when MI-6 detected a shell-building pattern. */
  hasShellBuildingPattern: boolean;
}

/** Per-factor breakdown produced by computeEmergenceScore. */
export interface EmergenceFactors {
  baselineProbability: number;       // anchor from MI-6 latest probability
  signalVolume: number;              // saturating function of last-30d signals
  signalDiversity: number;           // distinct signal source types
  developerRecurrence: number;
  brokerRecurrence: number;
  continuancePressure: number;
  utilityExpansion: number;
  parcelPressure: number;            // from MI-7
  pressuredNeighborCount: number;    // MI-7 derived
  shellPatternBoost: number;         // MI-6 shell-building heuristic
  corridorBoost: number;
  infrastructureBoost: number;
  recencyMultiplier: number;         // 60-day half-life decay, [0..1]
}

/** Default factor weights — operator-tunable; sum doesn't need to equal 1.
 *  recencyMultiplier is applied multiplicatively AFTER the weighted sum, not
 *  as a weighted factor. */
export const FACTOR_WEIGHTS: Record<
  Exclude<keyof EmergenceFactors, "recencyMultiplier">,
  number
> = {
  baselineProbability: 4,
  signalVolume: 3,
  signalDiversity: 2,
  developerRecurrence: 3,
  brokerRecurrence: 1.5,
  continuancePressure: 2,
  utilityExpansion: 2.5,
  parcelPressure: 3,
  pressuredNeighborCount: 2,
  shellPatternBoost: 2.5,
  corridorBoost: 2,
  infrastructureBoost: 2,
};

/** 60-day half-life — aligns with MI-6 temporalProximity + MI-7 pressure
 *  recency multiplier so all three layers decay at the same cadence. */
export const RECENCY_HALF_LIFE_DAYS = 60;

/** Trajectory classification thresholds. Operator-tunable but documented
 *  in one place. */
export const TRAJECTORY_THRESHOLDS = {
  /** abs(acceleration) below this → STEADY / STALLED. */
  FLAT_BAND: 0.05,
  /** acceleration above this with low previous score → IGNITING. */
  IGNITE_BAND: 0.10,
  /** acceleration above this with already-high score → ACCELERATING. */
  ACCELERATE_BAND: 0.05,
  /** acceleration below -DECAY_BAND → DECAYING. */
  DECAY_BAND: 0.10,
  /** score below this with FLAT_BAND acceleration → STALLED or DORMANT. */
  STALLED_SCORE: 0.15,
  /** Days since last signal beyond which a STALLED subject becomes DORMANT. */
  DORMANT_DAYS: 365,
} as const;

/** Final composite-scoring decision returned by computeEmergenceScore. */
export interface EmergenceScoreResult {
  subjectKind: SubjectKind;
  subjectId: string;
  emergenceScore: number;       // [0..1] composite
  factors: EmergenceFactors;
  reasonLog: string[];
  contributions: ForecastContribution[];
  forecastVersion: typeof FORECAST_VERSION;
}

/** Per-contributing-factor record. The orchestrator persists one
 *  ForecastExplanation row per entry. */
export interface ForecastContribution {
  factorKind: ForecastFactorKind;
  factorName: keyof EmergenceFactors;
  factorScore: number;
  factorWeight: number;
  contribution: number;          // factorScore * factorWeight, after decay
  rationale: string;
  sourceRefKind?: string;
  sourceRefId?: string;
}

/** Acceleration computation. positiveDelta and negativeDelta are weighted
 *  sums of recent up/down moves; momentum and decay are their normalized
 *  forms in [0, 1]. */
export interface AccelerationResult {
  subjectKind: SubjectKind;
  subjectId: string;
  accelerationIndex: number;     // d(score)/dt normalized to [-1, 1]
  momentumScore: number;         // [0..1]
  decayScore: number;            // [0..1]
  shortTermDelta: number;        // 30-day delta in [-1, 1]
  longTermDelta: number;         // 180-day delta in [-1, 1]
  /** A change in second derivative from negative to positive (or vice
   *  versa) larger than this threshold flags a momentumShift. */
  shiftDetected: boolean;
  shiftReason: string | null;
  windowDays: number;
}

export interface TrajectoryDecision {
  state: TrajectoryState;
  previousState: TrajectoryState | null;
  streakLength: number;
  shiftDetected: boolean;
  shiftReason: string | null;
}

export interface CorridorHeatResult {
  corridorKey: string;
  corridorLabel: string;
  heatScore: number;             // [0..1]
  meanPressure: number;          // [0..1]
  acceleration: number;          // [-1..1]
  activeMembers: number;
  memberParcelIds: string[];
  memberSetTruncated: boolean;
  classification: CorridorHeatClassification;
  reasonLog: string[];
}

export interface JurisdictionVelocityResult {
  jurisdictionKey: string;
  jurisdictionLabel: string;
  newProjectsLast30d: number;
  newProjectsLast90d: number;
  newProjectsLast365d: number;
  newSignalsLast30d: number;
  newSignalsLast90d: number;
  velocityScore: number;         // [0..1]
  acceleration: number;          // [-1..1]
  cadenceClass: CadenceClass;
  reasonLog: string[];
}

export interface DevelopmentMomentumResult {
  developerEntityId: string;
  developerNameCache: string | null;
  newProjectsLast30d: number;
  newProjectsLast90d: number;
  newProjectsLast365d: number;
  newParcelsLast90d: number;
  momentumScore: number;         // [0..1]
  acceleration: number;          // [-1..1]
  classification: DeveloperMomentumClassification;
  reasonLog: string[];
}

export interface ExpectedTimelinePoint {
  milestoneKind: MilestoneKind;
  earliestEstimate: Date | null;
  expectedEstimate: Date | null;
  latestEstimate: Date | null;
  confidence: ForecastConfidence;
  rationale: string;
}

export interface ForecastActorContext {
  userId: string | null;
  email: string | null;
}

/** Default decay profiles seeded at backfill time. Each row in the
 *  SignalDecayProfile table can override these per signal type. */
export const DEFAULT_SIGNAL_DECAY_PROFILES: Array<{
  signalType: string;
  curveShape: SignalDecayCurve;
  halfLifeDays: number;
  floorWeight: number;
  baseWeight: number;
}> = [
  { signalType: "PERMIT",          curveShape: "EXPONENTIAL", halfLifeDays: 120, floorWeight: 0.10, baseWeight: 1.5 },
  { signalType: "MEETING_MINUTE",  curveShape: "EXPONENTIAL", halfLifeDays:  60, floorWeight: 0.00, baseWeight: 1.0 },
  { signalType: "PLAN_ROOM_JOB",   curveShape: "EXPONENTIAL", halfLifeDays: 180, floorWeight: 0.05, baseWeight: 1.2 },
  { signalType: "PLAN_ROOM_VIEW",  curveShape: "EXPONENTIAL", halfLifeDays:  30, floorWeight: 0.00, baseWeight: 0.6 },
  { signalType: "LAND_ACQUISITION",curveShape: "SUSTAINED",   halfLifeDays: 999, floorWeight: 0.50, baseWeight: 1.5 },
  { signalType: "BROKER_LISTING",  curveShape: "EXPONENTIAL", halfLifeDays:  45, floorWeight: 0.00, baseWeight: 0.8 },
  { signalType: "ARCHITECT_PROJECT", curveShape: "EXPONENTIAL", halfLifeDays: 90, floorWeight: 0.05, baseWeight: 1.0 },
  { signalType: "MANUAL",          curveShape: "EXPONENTIAL", halfLifeDays:  90, floorWeight: 0.00, baseWeight: 1.0 },
];

// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/operatorWorkspace/types.ts
//  Phase MI-10 — Operator Workspace types and pseudo-enums.
// ──────────────────────────────────────────────────────────────────────────────

export const WATCHLIST_SUBJECT_KINDS = [
  "DEVELOPER",
  "PARCEL",
  "CORRIDOR",
  "JURISDICTION",
  "BROKER",
  "FRANCHISE",
  "UTILITY",
  "PROJECT_TYPE",
  "MIXED",
] as const;
export type WatchlistSubjectKind = (typeof WATCHLIST_SUBJECT_KINDS)[number];

export const WATCHLIST_VISIBILITIES = ["PRIVATE", "TEAM", "ORG"] as const;
export type WatchlistVisibility = (typeof WATCHLIST_VISIBILITIES)[number];

export const WATCHLIST_ATTACH_REASONS = ["MANUAL", "RULE_DERIVED", "IMPORTED", "MIGRATED"] as const;
export type WatchlistAttachReason = (typeof WATCHLIST_ATTACH_REASONS)[number];

export const ALERT_TRIGGER_KINDS = [
  "PROBABILITY_SPIKE",
  "TRAJECTORY_SHIFT",
  "CORRIDOR_IGNITION",
  "TIMELINE_PULL_IN",
  "HIGH_CONFIDENCE_EMERGENCE",
  "RECURRING_ENTITY",
  "UTILITY_ACCELERATION",
  "SHELL_PATTERN_DETECTED",
  "WATCHLIST_HIT",
  "CUSTOM",
] as const;
export type AlertTriggerKind = (typeof ALERT_TRIGGER_KINDS)[number];

export const ALERT_SEVERITIES = ["INFO", "WATCH", "ATTENTION", "URGENT"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_REVIEW_STATES = [
  "UNREAD",
  "ACKNOWLEDGED",
  "DISMISSED",
  "ESCALATED",
  "SUPPRESSED",
] as const;
export type AlertReviewState = (typeof ALERT_REVIEW_STATES)[number];

export const ALERT_DELIVERY_CHANNELS = ["IN_APP", "EMAIL", "WEBHOOK"] as const;
export type AlertDeliveryChannel = (typeof ALERT_DELIVERY_CHANNELS)[number];

export const BRIEFING_KINDS = [
  "CORRIDOR_SUMMARY",
  "WEEKLY_EMERGENCE",
  "JURISDICTION_HEAT",
  "DEVELOPER_MOVEMENT",
  "FORECAST_CHANGE",
  "CUSTOM",
] as const;
export type BriefingKind = (typeof BRIEFING_KINDS)[number];

export const BRIEFING_STATUSES = [
  "DRAFT",
  "GENERATED",
  "OPERATOR_REVIEWED",
  "PUBLISHED",
  "ARCHIVED",
] as const;
export type BriefingStatus = (typeof BRIEFING_STATUSES)[number];

export const BRIEFING_SECTION_KINDS = [
  "HEADLINE",
  "KEY_FINDINGS",
  "CORRIDOR_BLOCK",
  "DEVELOPER_BLOCK",
  "JURISDICTION_BLOCK",
  "FORECAST_BLOCK",
  "EVIDENCE_BLOCK",
  "NOTE_BLOCK",
] as const;
export type BriefingSectionKind = (typeof BRIEFING_SECTION_KINDS)[number];

export const TARGETING_PATTERN_KINDS = [
  "DEVELOPER_ENTERS_CORRIDOR",
  "BROKER_PRECEDES_INDUSTRIAL",
  "RECURRING_GC_DEVELOPER",
  "ENTITY_CLUSTER_PRE_PROJECT",
  "FRANCHISE_ROLLOUT",
  "UTILITY_CHAIN",
  "ZONING_CADENCE",
  "CUSTOM",
] as const;
export type TargetingPatternKind = (typeof TARGETING_PATTERN_KINDS)[number];

export const ALERT_EXPLANATION_KINDS = [
  "EVIDENCE",
  "FORECAST_DELTA",
  "CALIBRATION_CONTEXT",
  "UNCERTAINTY",
  "RECOMMENDATION",
  "OTHER",
] as const;
export type AlertExplanationKind = (typeof ALERT_EXPLANATION_KINDS)[number];

export const WORKSPACE_LAYOUTS = ["DASHBOARD", "LIST", "KANBAN"] as const;
export type WorkspaceLayout = (typeof WORKSPACE_LAYOUTS)[number];

export const ALERT_SUBJECT_KINDS = [
  "PROJECT",
  "PARCEL",
  "CORRIDOR",
  "JURISDICTION",
  "DEVELOPER",
  "ENTITY",
] as const;
export type AlertSubjectKind = (typeof ALERT_SUBJECT_KINDS)[number];

// Bumps when alert-evaluation logic or briefing-generator behavior changes.
export const WORKSPACE_VERSION = "v1" as const;

// ─── Severity → score thresholds (operator-tunable defaults) ─────────────────

export const SEVERITY_FLOORS = {
  INFO: 0,
  WATCH: 1,
  ATTENTION: 2,
  URGENT: 3,
} as const;

export function severityRank(sev: AlertSeverity): number {
  return SEVERITY_FLOORS[sev];
}

// ─── Wire shapes ─────────────────────────────────────────────────────────────

export interface WatchlistActorContext {
  userId: string | null;
  email: string | null;
}

/** Criteria payloads accepted by AlertRule.criteriaJson. Each triggerKind
 *  has its own shape; the runner validates against this taxonomy. */
export interface AlertRuleCriteriaProbabilitySpike {
  triggerKind: "PROBABILITY_SPIKE";
  minDelta: number;        // e.g. +0.20 score delta
  windowDays: number;      // comparison window
}

export interface AlertRuleCriteriaTrajectoryShift {
  triggerKind: "TRAJECTORY_SHIFT";
  states: string[];        // e.g. ["IGNITING", "ACCELERATING"]
}

export interface AlertRuleCriteriaCorridorIgnition {
  triggerKind: "CORRIDOR_IGNITION";
  minHeatScore: number;
  minAcceleration: number;
}

export interface AlertRuleCriteriaTimelinePullIn {
  triggerKind: "TIMELINE_PULL_IN";
  milestoneKind: string;
  minDaysPulledIn: number;
}

export interface AlertRuleCriteriaHighConfidenceEmergence {
  triggerKind: "HIGH_CONFIDENCE_EMERGENCE";
  minScore: number;
  requiredConfidence: "HIGH" | "MEDIUM";
}

export interface AlertRuleCriteriaRecurringEntity {
  triggerKind: "RECURRING_ENTITY";
  entityRole: string;
  minProjects: number;
  windowDays: number;
}

export interface AlertRuleCriteriaUtilityAcceleration {
  triggerKind: "UTILITY_ACCELERATION";
  jurisdictionKey?: string;
  minNewExpansions: number;
  windowDays: number;
}

export interface AlertRuleCriteriaShellPatternDetected {
  triggerKind: "SHELL_PATTERN_DETECTED";
  parcelId?: string;
  jurisdictionKey?: string;
}

export interface AlertRuleCriteriaWatchlistHit {
  triggerKind: "WATCHLIST_HIT";
  watchlistId: string;
  fireOn: "any_change" | "new_signal" | "score_change" | "new_outcome";
}

export interface AlertRuleCriteriaCustom {
  triggerKind: "CUSTOM";
  description: string;
  // free-form payload — runner is a no-op for CUSTOM rules. PR-2 work.
  payload?: Record<string, unknown>;
}

export type AlertRuleCriteria =
  | AlertRuleCriteriaProbabilitySpike
  | AlertRuleCriteriaTrajectoryShift
  | AlertRuleCriteriaCorridorIgnition
  | AlertRuleCriteriaTimelinePullIn
  | AlertRuleCriteriaHighConfidenceEmergence
  | AlertRuleCriteriaRecurringEntity
  | AlertRuleCriteriaUtilityAcceleration
  | AlertRuleCriteriaShellPatternDetected
  | AlertRuleCriteriaWatchlistHit
  | AlertRuleCriteriaCustom;

/** Intelligence surface — read-only feed records. The service layer
 *  composes these from existing intelligence tables (EmergenceScore,
 *  CorridorHeat, JurisdictionVelocity, etc.) — no new storage. */
export interface IntelligenceSurfaceItem {
  surfaceKind: string;        // e.g. "EMERGING_NOW"
  subjectKind: string;        // "PROJECT" | "PARCEL" | "CORRIDOR" | ...
  subjectId: string;
  displayLabel: string;
  displayContext: string;
  score: number | null;
  scoreLabel: string | null;  // human-readable, e.g. "0.82 — HIGH"
  trajectoryState: string | null;
  rationale: string;
  evidenceCount: number;
  capturedAt: Date;
  href: string | null;        // optional UI deep-link
}

export interface IntelligenceSurfaceResult {
  surfaceKind: string;
  items: IntelligenceSurfaceItem[];
  generatedAt: Date;
  windowDays: number;
  reasonLog: string[];
}

export interface BriefingGeneratorInput {
  briefingKind: BriefingKind;
  title?: string;
  windowStart: Date;
  windowEnd: Date;
  jurisdictionKey?: string;
  corridorKey?: string;
  watchlistId?: string;
  actor?: WatchlistActorContext;
}

export interface BriefingGeneratorSection {
  position: number;
  sectionKind: BriefingSectionKind;
  title: string | null;
  body: string;
  payload?: Record<string, unknown>;
}

export interface BriefingGeneratorResult {
  briefingKind: BriefingKind;
  title: string;
  summary: string;
  sections: BriefingGeneratorSection[];
  reasonLog: string[];
  workspaceVersion: typeof WORKSPACE_VERSION;
}

/** Alert evaluation input — pure side; the runner reads upstream state and
 *  passes a flat ForecastAssertion-like context. */
export interface AlertEvaluationContext {
  rule: {
    id: string;
    triggerKind: AlertTriggerKind;
    severityFloor: AlertSeverity;
    criteria: AlertRuleCriteria;
    cooldownMinutes: number;
    lastFiredAt: Date | null;
  };
  subject: {
    subjectKind: AlertSubjectKind;
    subjectId: string;
    projectId: string | null;
    parcelId: string | null;
  };
  /** Snapshot history for trajectory + probability rules. */
  recentScores: Array<{ score: number; at: Date; trajectoryState: string }>;
  /** Most-recent forecast snapshot id for linkage. */
  latestSnapshotId: string | null;
  /** Optional corridor heat info. */
  corridorHeat?: { heatScore: number; acceleration: number };
  /** Operator-supplied evaluation timestamp (tests pass fixed Date). */
  evaluationDate?: Date;
}

export interface AlertEvaluationResult {
  shouldFire: boolean;
  severity: AlertSeverity;
  headline: string;
  detail: string;
  rationale: string;
  capturedScore: number | null;
  capturedTrajectory: string | null;
  factors: Array<{
    factorKind: AlertExplanationKind;
    factorName: string;
    factorScore: number | null;
    rationale: string;
  }>;
  reasonLog: string[];
}

/** Default severity-floor when none specified. */
export const DEFAULT_SEVERITY_FLOOR: AlertSeverity = "WATCH";

/** Default alert cooldown — 24h. Operator-tunable. */
export const DEFAULT_ALERT_COOLDOWN_MINUTES = 1440;

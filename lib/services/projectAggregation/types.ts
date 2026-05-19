// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectAggregation/types.ts
//  Phase MI-6 — Project Aggregate Engine types and pseudo-enums.
// ──────────────────────────────────────────────────────────────────────────────

export const LIFECYCLE_STATES = [
  "EMERGING",
  "EARLY_SIGNAL",
  "PRE_ENTITLEMENT",
  "ENTITLEMENT",
  "SITE_PREP",
  "PRE_CONSTRUCTION",
  "ACTIVE_CONSTRUCTION",
  "STALLED",
  "ABANDONED",
  "COMPLETED",
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const PROJECT_REVIEW_STATES = [
  "AUTO_AGGREGATED",
  "PENDING_REVIEW",
  "VERIFIED",
  "REJECTED",
  "MERGED",
] as const;
export type ProjectReviewState = (typeof PROJECT_REVIEW_STATES)[number];

export const SIGNAL_KINDS = [
  "MARKET_SIGNAL",
  "RELATIONSHIP_EDGE",
  "MARKET_LEAD",
  "SOURCE_DOC",
  "MANUAL",
  "EXTERNAL",
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const PROJECT_ENTITY_ROLES = [
  "DEVELOPER",
  "OWNER",
  "GC",
  "ARCHITECT",
  "ENGINEER",
  "BROKER",
  "TENANT",
  "LENDER",
  "MUNICIPALITY",
  "AGENCY",
  "OTHER",
] as const;
export type ProjectEntityRole = (typeof PROJECT_ENTITY_ROLES)[number];

export const TIMELINE_EVENT_TYPES = [
  "SIGNAL_ATTACHED",
  "SIGNAL_DETACHED",
  "ENTITY_ATTACHED",
  "ENTITY_REMOVED",
  "PARCEL_ATTACHED",
  "STATE_TRANSITION",
  "PROBABILITY_UPDATE",
  "MANUAL_NOTE",
  "MERGE_INTO",
  "MERGE_RECEIVED",
  "REVIEW_ACTION",
] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

// Bumps when heuristic weights or factor definitions change. Future probability
// snapshots record this so re-evaluation is selective.
export const AGGREGATOR_VERSION = "v1" as const;

// ─── Wire shapes ─────────────────────────────────────────────────────────────

/** Generic projection of a signal we're trying to attach. The aggregator
 *  works against this normalized shape so the same heuristics can score
 *  MarketSignal, RelationshipEdge, MarketLead, and operator-provided
 *  manual signals. */
export interface SignalInput {
  kind: SignalKind;
  /** Pointer to the source row (MarketSignal.id / RelationshipEdge.id / etc.) */
  sourceId: string | null;
  /** Optional free-text title/headline used for title-similarity scoring. */
  title: string | null;
  /** When this signal was observed (NOT when this row was created). */
  occurredAt: Date;
  jurisdiction: string | null;
  /** Parcel identifiers attached to this signal (e.g., from permit metadata). */
  parcelIds: string[];
  /** Canonical entity IDs attached to this signal, by role. The aggregator
   *  uses these for developer/engineer/broker continuity scoring. */
  entityIds: Array<{ entityId: string; role: ProjectEntityRole }>;
  /** Free-text address (used as a weak parcel-substitute when parcelId is unknown). */
  address: string | null;
  /** Optional zoning / utility / building-type tokens for continuity scoring. */
  tags: string[];
}

/** Projection of an existing Project's accumulated context used as the
 *  comparison target. Pre-built once per scoring run. */
export interface ProjectContext {
  id: string;
  workingTitle: string;
  jurisdiction: string | null;
  lifecycleState: LifecycleState;
  firstSignalAt: Date | null;
  lastSignalAt: Date | null;
  /** Parcels currently attached to this project (deduped). */
  parcelIds: string[];
  /** Active entity attachments (role-keyed). */
  entityIdsByRole: Record<ProjectEntityRole, string[]>;
  /** Recent signal tags (window of last N signals). */
  recentTags: string[];
  /** Cumulative continuance count across attached agenda-bearing signals. */
  continuanceCount: number;
  /** True when the project's attached signal set matches the shell-building
   *  pattern (industrial-zoned parcel + utility-extension signal + engineer
   *  attached without owner yet). Pre-computed by the caller. */
  hasShellBuildingPattern: boolean;
}

/** Per-factor score breakdown returned by scoreProjectSimilarity. Every
 *  factor is in [0, 1] where 0 = neutral and 1 = maximally consistent
 *  with attachment. Composite score = weighted sum / sum of weights. */
export interface SimilarityFactors {
  parcelMatch: number;        // strong — 1.0 when any parcel matches
  developerMatch: number;     // strong
  jurisdictionMatch: number;  // medium
  recurringEngineer: number;  // medium
  recurringBroker: number;    // medium
  zoningContinuity: number;   // medium
  utilityExtension: number;   // medium
  temporalProximity: number;  // variable — bell curve around recent activity
  titleSimilarity: number;    // weak
  agendaContinuity: number;   // medium
  continuanceCount: number;   // strong when ≥ 2
  shellBuildingPattern: number; // strong but type-specific
}

/** Final scoring decision. */
export interface SimilarityResult {
  candidateProjectId: string;
  score: number;             // composite 0..1
  factors: SimilarityFactors;
  reasonLog: string[];       // operator-readable reasons why the score is what it is
}

/** Outcome of detectProjectContinuation — the decision the aggregator wants
 *  the caller to make. Aggregator is deterministic-first: AMBIGUOUS results
 *  defer to operator review, never auto-merge. */
export type ContinuationDecision =
  | { kind: "create_new"; reason: string }
  | { kind: "attach_to_existing"; project: SimilarityResult; reason: string }
  | { kind: "needs_review"; candidates: SimilarityResult[]; reason: string };

export interface AggregatorActorContext {
  userId: string | null;
  email: string | null;
}

/** Score thresholds — operator-tunable via opts but documented as defaults
 *  here so the policy is in one place. */
export const SCORE_THRESHOLDS = {
  /** ≥ this score → attach_to_existing without review. */
  ATTACH_AUTO: 0.8,
  /** ≥ this score and < ATTACH_AUTO → needs_review. */
  REVIEW: 0.55,
  /** < REVIEW → ignore as candidate. */
} as const;

/** Default factor weights — operator-tunable; sum doesn't need to equal 1. */
export const FACTOR_WEIGHTS: Record<keyof SimilarityFactors, number> = {
  parcelMatch: 5,         // single strongest signal: same dirt = same project
  developerMatch: 4,
  continuanceCount: 3,
  shellBuildingPattern: 3,
  jurisdictionMatch: 2,
  recurringEngineer: 2,
  recurringBroker: 2,
  zoningContinuity: 2,
  utilityExtension: 2,
  agendaContinuity: 2,
  temporalProximity: 1.5,
  titleSimilarity: 1,
};

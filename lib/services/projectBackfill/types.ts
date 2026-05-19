// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectBackfill/types.ts
//  Phase MI-6 PR2 — Historical Project Aggregate Formation types.
//
//  All JSON-serializable. Checkpoint and report files persist to the
//  filesystem; the structures here are their schema.
// ──────────────────────────────────────────────────────────────────────────────

import type {
  ContinuationDecision,
  LifecycleState,
} from "@/lib/services/projectAggregation";

export type BackfillMode = "dry-run" | "report-only" | "execute" | "replay";
export type BackfillTier =
  | "development-parity"
  | "staging"
  | "production";

export interface ProjectBackfillOptions {
  mode: BackfillMode;
  tier: BackfillTier;
  batchSize: number;            // default 50
  maxRows: number | null;       // safety cap; null = unlimited
  sources: BackfillSource[];    // which corpus tables to walk
  checkpointPath: string;
  reportPath: string;
  /** Override score thresholds for this run; otherwise the aggregator
   *  defaults (ATTACH_AUTO=0.80, REVIEW=0.55) apply. */
  attachAutoThreshold?: number;
  reviewThreshold?: number;
  /** Skip the report-generation phase (useful for fast iteration). */
  skipReport: boolean;
  verbose: boolean;
}

export type BackfillSource = "RelationshipEdge" | "MarketSignal" | "MarketLead";

export type PhaseStatus = "pending" | "in_progress" | "complete" | "failed" | "skipped";

interface BasePhaseProgress {
  status: PhaseStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface SourcePhaseProgress extends BasePhaseProgress {
  source: BackfillSource;
  totalCandidates: number;
  lastProcessedId: string | null;
  rowsProcessed: number;
  rowsSkipped: number;
  decisionCounts: {
    create_new: number;
    attach_to_existing: number;
    needs_review: number;
  };
  projectsCreated: number;
  signalsAttached: number;
}

export interface CheckpointState {
  schemaVersion: 1;
  startedAt: string;
  lastUpdatedAt: string;
  aggregatorVersion: string;
  tier: BackfillTier;
  mode: BackfillMode;
  phases: {
    relationshipEdge: SourcePhaseProgress;
    marketLead: SourcePhaseProgress;
    marketSignal: SourcePhaseProgress;
  };
}

export interface ProjectCollisionFinding {
  kind:
    | "likely_duplicate_pair"          // two projects look like one
    | "over_merged_cluster"             // one project's signals look like two
    | "weakly_related_signals"          // median pairwise score below threshold
    | "jurisdiction_drift"              // signals span > 1 jurisdiction
    | "parcel_divergence";              // attached parcels are far apart
  projectIds: string[];
  description: string;
  recommendedAction: string;
  evidence?: Record<string, unknown>;
}

export interface ProjectBackfillReport {
  schemaVersion: 1;
  generatedAt: string;
  tier: BackfillTier;
  mode: BackfillMode;
  aggregatorVersion: string;
  durationMs: number;
  phases: CheckpointState["phases"];

  totals: {
    rowsScanned: number;
    projectsTotal: number;
    projectsCreatedThisRun: number;
    signalsAttachedThisRun: number;
    pendingReviewCount: number;
    rejectedCount: number;
    avgSignalsPerProject: number;
  };

  // Histograms
  lifecycleHistogram: Record<LifecycleState, number>;
  confidenceHistogram: Record<string, number>;
  reviewStatusHistogram: Record<string, number>;
  probabilityHistogram: Record<string, number>;     // bucketed 0-0.1, 0.1-0.2, ...
  signalsPerProjectHistogram: Record<string, number>; // bucketed 1-2, 3-5, 6-10, 11+

  // Top lists
  topJurisdictions: Array<{ jurisdiction: string; projectCount: number }>;
  topDevelopers: Array<{
    entityId: string;
    canonicalName: string;
    projectCount: number;
  }>;
  topRecurringPatterns: Array<{
    pattern: string;
    occurrences: number;
    example: { projectId: string; workingTitle: string } | null;
  }>;
  longestLifespanProjects: Array<{
    projectId: string;
    workingTitle: string;
    spanDays: number;
    signalCount: number;
  }>;

  // Findings + operator workload
  collisions: ProjectCollisionFinding[];
  mergeCandidates: number;
  splitCandidates: number;
  reviewQueueSize: number;
}

/** Per-row outcome captured during execute() for the report aggregator. */
export interface PerSignalOutcome {
  source: BackfillSource;
  sourceId: string;
  decisionKind: ContinuationDecision["kind"];
  projectId: string | null;
  score: number | null;
  createdNew: boolean;
}

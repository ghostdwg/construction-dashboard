// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityBackfill/types.ts
//  Phase MI-3 — Historical Entity Backfill + Graph Formation types.
//
//  All non-Prisma wire shapes for the backfill pipeline. The pipeline runs
//  as a CLI tool (scripts/backfill-entity-graph.ts) and writes checkpoint +
//  report files alongside its run. Every shape here MUST be JSON-serializable.
// ──────────────────────────────────────────────────────────────────────────────

import type { Confidence, EntityType, ResolverPass } from "@/lib/services/entityResolver";

/** Backfill operates in one of these modes. Selected via CLI flag. */
export type BackfillMode =
  | "dry-run"       // build plan, exit without DB writes
  | "report-only"   // run analyses + report, no resolver calls
  | "execute"       // full run with writes
  | "replay";       // execute, but ignore resolverVersion match (re-resolve everything)

/** A tier the backfill is targeting. The CLI fences APP_ENV against this. */
export type BackfillTier =
  | "development-parity"
  | "staging"
  | "production";

/** Top-level options collected from the CLI. */
export interface BackfillOptions {
  mode: BackfillMode;
  tier: BackfillTier;
  batchSize: number;            // default 50
  maxRows: number | null;       // safety cap, null = unlimited
  tables: BackfillTable[];      // subset of allowed tables
  checkpointPath: string;       // default ./entity-backfill-checkpoint.json
  reportPath: string;           // default ./entity-backfill-report.json
  noSeed: boolean;              // skip Phase A (watchlist materialization)
  verbose: boolean;
}

export type BackfillTable = "RelationshipEdge" | "MarketSignal" | "MarketLead";

/** A single watchlist seed entry parsed from docs/sources/ENTITIES_WATCHLIST.md. */
export interface WatchlistSeedEntry {
  rawName: string;             // exactly as it appears in the ### heading
  normalizedName: string;      // normalizeEntityName(rawName)
  entityType: EntityType;      // inferred from Role line + category
  category: string;            // markdown ## section heading
  notes: string | null;        // joined bullet lines under the entry
  knownCounterparties: string[]; // parsed from "Frequent ... partners:" line(s)
}

/** Per-phase status persisted in the checkpoint file. */
export type PhaseStatus = "pending" | "in_progress" | "complete" | "failed" | "skipped";

export interface PhaseProgressBase {
  status: PhaseStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface WatchlistSeedProgress extends PhaseProgressBase {
  parsedEntries: number;
  materializedSeedRows: number;     // EntityWatchlistSeed inserts
  createdEntities: number;          // Entity rows newly inserted
  skippedExistingEntities: number;  // Entity rows already present
}

export interface RelationshipEdgeProgress extends PhaseProgressBase {
  totalCandidates: number;
  lastProcessedId: string | null;
  batchesComplete: number;
  totalBatchesPlanned: number;
  rowsProcessed: number;
  skippedAlreadyResolved: number;
  fromMatches: ResolverPassCounts;
  toMatches: ResolverPassCounts;
  entityRelationshipsCreated: number;
}

export interface MarketSignalProgress extends PhaseProgressBase {
  totalSignals: number;
  signalsAnalyzed: number;
  mentionsFound: number;
  entityRelationshipsCreated: number;
}

/** Counts of resolver outcomes per pass. */
export interface ResolverPassCounts {
  pass1_exactName: number;
  pass2_exactAlias: number;
  pass3_fuzzyHigh: number;
  pass4_needsReview: number;
  pass5_autoCreated: number;
  pass6_arbitrated: number;
  noMatch: number;
}

/** Full checkpoint file structure (JSON-safe). */
export interface CheckpointState {
  schemaVersion: 1;
  startedAt: string;
  lastUpdatedAt: string;
  resolverVersion: string;
  tier: BackfillTier;
  mode: BackfillMode;
  phases: {
    watchlistSeed: WatchlistSeedProgress;
    relationshipEdge: RelationshipEdgeProgress;
    marketSignal: MarketSignalProgress;
  };
}

/** A collision candidate detected by collisions.ts. */
export interface CollisionCandidate {
  kind:
    | "shared_normalized_form_across_types"   // same normalizedName, different entityType
    | "very_close_canonical_pair"             // two entities scored ≥0.92 fuzzy
    | "alias_loop"                            // alias points to entity whose canonical
                                              // also matches another entity's alias
    | "pending_review_cluster";               // ≥5 PENDING_REVIEW entities sharing a
                                              // similarity neighborhood
  entityIds: string[];
  description: string;
  recommendedAction: string;
}

/** A row exported for operator manual review (MI-4 UI consumes this). */
export interface ManualReviewRow {
  entityId: string;
  canonicalName: string;
  entityType: string;
  reviewStatus: string;
  confidence: string;
  source: string | null;
  inboundRelationships: number;
  outboundRelationships: number;
  closestPeers: Array<{ id: string; canonicalName: string; similarityScore: number }>;
}

/** Top-level report written by the backfill at end-of-run. */
export interface BackfillReport {
  schemaVersion: 1;
  generatedAt: string;
  tier: BackfillTier;
  mode: BackfillMode;
  resolverVersion: string;
  durationMs: number;
  phases: CheckpointState["phases"];

  // Aggregated cross-phase stats
  totals: {
    rowsScanned: number;
    entitiesTotal: number;
    entitiesCreatedThisRun: number;
    aliasesCreatedThisRun: number;
    entityRelationshipsTotal: number;
    entityRelationshipsCreatedThisRun: number;
    unresolvedNames: string[];           // small sample, bounded
    pendingReviewCount: number;
    lowConfidenceCount: number;
  };

  // Histograms
  confidenceHistogram: Record<Confidence, number>;
  reviewStatusHistogram: Record<string, number>;
  resolverPassHistogram: Record<string, number>;
  resolverVersionDistribution: Record<string, { entities: number; edges: number }>;

  // Top lists
  topEntities: Array<{
    id: string;
    canonicalName: string;
    entityType: string;
    relationshipCount: number;
  }>;
  topPairings: Array<{
    fromId: string;
    fromCanonicalName: string;
    toId: string;
    toCanonicalName: string;
    relationshipCount: number;
    relationshipType: string;
  }>;

  // Operator artifacts
  collisions: CollisionCandidate[];
  manualReviewQueue: ManualReviewRow[];   // top N — full list in side file
}

/** Result of a single resolver invocation captured for the report. */
export interface PerCallResult {
  inputName: string;
  inputType: EntityType | null;
  resolvedEntityId: string | null;
  pass: ResolverPass | null;
  confidence: Confidence;
  similarityScore: number | null;
  created: boolean;
  source: string;
}

// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/liveIngestion/types.ts
//  Phase MI-5 — Live Emergence Ingestion Integration types.
// ──────────────────────────────────────────────────────────────────────────────

import type { ContinuationDecision } from "@/lib/services/projectAggregation";

export type IngestionSourceKind = "MARKET_SIGNAL" | "RELATIONSHIP_EDGE" | "MARKET_LEAD";

/** Optional overrides for ingestion processing. */
export interface IngestionProcessOptions {
  /** When true (default), skips rows already attached to a project via a
   *  non-detached ProjectSignal. Set false to re-process (operator-driven). */
  skipIfAttached?: boolean;
  /** Override aggregator's ATTACH_AUTO threshold (default 0.80). */
  attachAutoThreshold?: number;
  /** Override aggregator's REVIEW threshold (default 0.55). */
  reviewThreshold?: number;
  /** Skip the post-attach probability recompute. Off by default — leave
   *  on so probability evolves with each new signal. */
  skipProbability?: boolean;
  /** Per-row console audit when true. */
  verbose?: boolean;
  /** Operator attribution; null when system-driven. */
  actor?: { userId: string | null; email: string | null };
}

export interface IngestionAuditEntry {
  timestamp: string;
  sourceKind: IngestionSourceKind;
  sourceId: string;
  decision: ContinuationDecision["kind"] | "already_processed" | "skipped";
  projectId: string | null;
  attachScore: number | null;
  reason: string;
  ingestionVersion: string;
  resolverVersion: string;
  aggregatorVersion: string;
  actorUserId: string | null;
  actorEmail: string | null;
}

export interface IngestionResult {
  ok: boolean;
  sourceKind: IngestionSourceKind;
  sourceId: string;
  decision: ContinuationDecision["kind"] | "already_processed" | "skipped";
  projectId: string | null;
  projectSignalId: string | null;
  createdNewProject: boolean;
  audit: IngestionAuditEntry;
  error?: string;
}

export const INGESTION_VERSION = "v1" as const;

// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityBackfill/checkpoint.ts
//  Phase MI-3 — Backfill checkpoint persistence.
//
//  Checkpoints land as JSON on the filesystem (NOT in the DB) so a crashed
//  run can be resumed without touching the DB schema. The schemaVersion
//  field gates compatibility: if a future MI-3.x introduces breaking
//  checkpoint shape changes, readCheckpoint rejects old files rather than
//  silently mis-resuming.
//
//  Writes are atomic: write to .tmp, fsync, rename. This avoids leaving a
//  half-written checkpoint if the process is killed mid-write.
// ──────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { RESOLVER_VERSION } from "@/lib/services/entityResolver";
import type { BackfillMode, BackfillTier, CheckpointState } from "./types";

export function initialCheckpoint(
  tier: BackfillTier,
  mode: BackfillMode
): CheckpointState {
  const ts = new Date().toISOString();
  return {
    schemaVersion: 1,
    startedAt: ts,
    lastUpdatedAt: ts,
    resolverVersion: RESOLVER_VERSION,
    tier,
    mode,
    phases: {
      watchlistSeed: emptyPhase(),
      relationshipEdge: {
        ...emptyPhase(),
        totalCandidates: 0,
        lastProcessedId: null,
        batchesComplete: 0,
        totalBatchesPlanned: 0,
        rowsProcessed: 0,
        skippedAlreadyResolved: 0,
        fromMatches: emptyPassCounts(),
        toMatches: emptyPassCounts(),
        entityRelationshipsCreated: 0,
      },
      marketSignal: {
        ...emptyPhase(),
        totalSignals: 0,
        signalsAnalyzed: 0,
        mentionsFound: 0,
        entityRelationshipsCreated: 0,
      },
    },
  } as CheckpointState;
}

function emptyPhase() {
  return {
    status: "pending" as const,
    startedAt: null,
    completedAt: null,
    error: null,
    parsedEntries: 0,
    materializedSeedRows: 0,
    createdEntities: 0,
    skippedExistingEntities: 0,
  };
}

function emptyPassCounts() {
  return {
    pass1_exactName: 0,
    pass2_exactAlias: 0,
    pass3_fuzzyHigh: 0,
    pass4_needsReview: 0,
    pass5_autoCreated: 0,
    pass6_arbitrated: 0,
    noMatch: 0,
  };
}

export function readCheckpoint(path: string): CheckpointState | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as CheckpointState;
  if (parsed.schemaVersion !== 1) {
    throw new Error(
      `Checkpoint file ${path} has schemaVersion=${parsed.schemaVersion}; ` +
        "this backfill only understands schemaVersion=1. Delete or migrate."
    );
  }
  return parsed;
}

export function writeCheckpoint(path: string, state: CheckpointState): void {
  state.lastUpdatedAt = new Date().toISOString();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, path);
}

/**
 * Verify the checkpoint matches the current run's tier + resolver version.
 * If mismatched, the caller MUST decide whether to resume (impossible —
 * incompatible state) or start fresh (delete checkpoint).
 */
export function checkpointMatchesRun(
  state: CheckpointState,
  tier: BackfillTier,
  resolverVersion: string
): { compatible: boolean; reason: string } {
  if (state.tier !== tier) {
    return { compatible: false, reason: `checkpoint tier=${state.tier} != run tier=${tier}` };
  }
  if (state.resolverVersion !== resolverVersion) {
    return {
      compatible: false,
      reason: `checkpoint resolverVersion=${state.resolverVersion} != current=${resolverVersion}; replay required`,
    };
  }
  return { compatible: true, reason: "checkpoint compatible" };
}

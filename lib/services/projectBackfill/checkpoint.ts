// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectBackfill/checkpoint.ts
//  Phase MI-6 PR2 — File-based resumable state.
//
//  Atomic writes via .tmp + rename. schemaVersion gate refuses incompatible
//  files rather than silently mis-resuming. Same pattern as MI-3 backfill.
// ──────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { AGGREGATOR_VERSION } from "@/lib/services/projectAggregation";
import type {
  BackfillMode,
  BackfillSource,
  BackfillTier,
  CheckpointState,
  SourcePhaseProgress,
} from "./types";

function emptyPhase(source: BackfillSource): SourcePhaseProgress {
  return {
    source,
    status: "pending",
    startedAt: null,
    completedAt: null,
    error: null,
    totalCandidates: 0,
    lastProcessedId: null,
    rowsProcessed: 0,
    rowsSkipped: 0,
    decisionCounts: { create_new: 0, attach_to_existing: 0, needs_review: 0 },
    projectsCreated: 0,
    signalsAttached: 0,
  };
}

export function initialCheckpoint(tier: BackfillTier, mode: BackfillMode): CheckpointState {
  const ts = new Date().toISOString();
  return {
    schemaVersion: 1,
    startedAt: ts,
    lastUpdatedAt: ts,
    aggregatorVersion: AGGREGATOR_VERSION,
    tier,
    mode,
    phases: {
      relationshipEdge: emptyPhase("RelationshipEdge"),
      marketLead: emptyPhase("MarketLead"),
      marketSignal: emptyPhase("MarketSignal"),
    },
  };
}

export function readCheckpoint(path: string): CheckpointState | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as CheckpointState;
  if (parsed.schemaVersion !== 1) {
    throw new Error(
      `Checkpoint ${path} has schemaVersion=${parsed.schemaVersion}; this ` +
        "backfill only understands schemaVersion=1. Delete or migrate."
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

export function checkpointCompatible(
  state: CheckpointState,
  tier: BackfillTier,
  aggregatorVersion: string
): { compatible: boolean; reason: string } {
  if (state.tier !== tier) {
    return { compatible: false, reason: `checkpoint tier=${state.tier} != run tier=${tier}` };
  }
  if (state.aggregatorVersion !== aggregatorVersion) {
    return {
      compatible: false,
      reason:
        `checkpoint aggregatorVersion=${state.aggregatorVersion} != current=${aggregatorVersion}; ` +
        "delete checkpoint or use --replay",
    };
  }
  return { compatible: true, reason: "checkpoint compatible" };
}

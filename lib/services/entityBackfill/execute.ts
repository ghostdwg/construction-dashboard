// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityBackfill/execute.ts
//  Phase MI-3 — Backfill execution orchestrator.
//
//  Three phases, each gated by checkpoint state so a resumed run picks up
//  where the previous run left off:
//
//   Phase A — Watchlist Seed Materialization
//     Read docs/sources/ENTITIES_WATCHLIST.md, parse, materialize seed +
//     Entity rows at VERIFIED+VERIFIED. Idempotent.
//
//   Phase B — RelationshipEdge Backfill
//     Iterate RelationshipEdge rows in batches (default size 50). For each
//     row that's not already resolved at the current resolverVersion:
//       - resolveEntity(fromName, fromType, source='backfill_edge')
//       - resolveEntity(toName, toType, source='backfill_edge')
//       - update RelationshipEdge: fromEntityId, toEntityId, resolverVersion,
//         resolverConfidence
//       - create EntityRelationship with legacyEdgeId pointer
//     Each batch commits as a single Prisma transaction. Checkpoint written
//     after each successful batch.
//
//   Phase C — MarketSignal mentions (DEFERRED in MI-3)
//     Conservative keyword matching of seeded canonical names against
//     signal headlines. Not implemented in this PR — phase is marked
//     "skipped" in the checkpoint and report.
//
//  All writes preserve the original free-text fields. RelationshipEdge.
//  fromName/toName are NEVER modified.
//
//  Resumability: between batches, the checkpoint file holds enough state
//  to resume. Mid-batch crashes roll back via Prisma transaction.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import {
  resolveEntity,
  RESOLVER_VERSION,
  type EntityType,
  type ResolverPass,
} from "@/lib/services/entityResolver";
import { writeCheckpoint, readCheckpoint, initialCheckpoint, checkpointMatchesRun } from "./checkpoint";
import { parseWatchlist, readWatchlist, materializeSeed } from "./seed";
import type {
  BackfillOptions,
  CheckpointState,
  RelationshipEdgeProgress,
  ResolverPassCounts,
} from "./types";

// ── Free-text → EntityType mapping ────────────────────────────────────────────

const TYPE_NORMALIZATION_MAP: Record<string, EntityType> = {
  GC: "GC",
  OWNER: "Owner",
  DEVELOPER: "Developer",
  ARCHITECT: "Architect",
  ENGINEER: "Engineer",
  BROKER: "Broker",
  MUNICIPALITY: "Municipality",
  TENANT: "Tenant",
  LENDER: "Lender",
  AGENCY: "Agency",
};

function normalizeTypeString(raw: string): EntityType {
  if (!raw) return "Unknown";
  const key = raw.toUpperCase().trim();
  return TYPE_NORMALIZATION_MAP[key] ?? "Unknown";
}

// Map a free-text RelationshipEdge.relationshipType to an EntityRelationship
// relationshipType. The schema column is TEXT so any value is technically
// allowed; this just enforces our pseudo-enum convention.
const REL_TYPE_MAP: Record<string, string> = {
  DESIGNED: "DESIGNED",
  BUILT: "BUILT",
  OWNED: "OWNS",
  PARTNERED: "PARTNERED",
  COMPETING: "COMPETED_FOR",
};

function normalizeRelationshipType(raw: string): string {
  const key = (raw ?? "").toUpperCase().trim();
  return REL_TYPE_MAP[key] ?? "OTHER";
}

// Confidence string normalization for resolverConfidence on RelationshipEdge.
// Use the worst of the two resolver outcomes.
function combineConfidence(a: string, b: string): string {
  const order = ["NONE", "LOW", "MEDIUM", "HIGH", "VERIFIED"];
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia < 0 || ib < 0) return "NONE";
  return order[Math.min(ia, ib)];
}

function incrementPassCount(counts: ResolverPassCounts, pass: ResolverPass | null, matched: boolean): void {
  if (!matched || pass === null) {
    counts.noMatch += 1;
    return;
  }
  if (pass === 1) counts.pass1_exactName += 1;
  else if (pass === 2) counts.pass2_exactAlias += 1;
  else if (pass === 3) counts.pass3_fuzzyHigh += 1;
  else if (pass === 4) counts.pass4_needsReview += 1;
  else if (pass === 5) counts.pass5_autoCreated += 1;
  else if (pass === 6) counts.pass6_arbitrated += 1;
}

// ── Phase B implementation ────────────────────────────────────────────────────

async function processRelationshipEdgeBatch(
  edgeIds: string[],
  resolverVersion: string,
  progress: RelationshipEdgeProgress,
  verbose: boolean
): Promise<void> {
  const edges = await prisma.relationshipEdge.findMany({
    where: { id: { in: edgeIds } },
    orderBy: { id: "asc" },
  });

  for (const edge of edges) {
    if (edge.resolverVersion === resolverVersion) {
      progress.skippedAlreadyResolved += 1;
      progress.lastProcessedId = edge.id;
      continue;
    }

    const fromType = normalizeTypeString(edge.fromType);
    const toType = normalizeTypeString(edge.toType);

    const fromResult = await resolveEntity(edge.fromName, fromType, {
      source: "backfill_edge",
      create: true,
    });
    incrementPassCount(progress.fromMatches, fromResult.match.pass, !!fromResult.entity);

    const toResult = await resolveEntity(edge.toName, toType, {
      source: "backfill_edge",
      create: true,
    });
    incrementPassCount(progress.toMatches, toResult.match.pass, !!toResult.entity);

    if (verbose) {
      console.log(
        `[backfill] edge ${edge.id}: ${edge.fromName} (pass ${fromResult.match.pass}) ↔ ` +
          `${edge.toName} (pass ${toResult.match.pass})`
      );
    }

    const combined = combineConfidence(fromResult.match.confidence, toResult.match.confidence);
    const relType = normalizeRelationshipType(edge.relationshipType);

    // Single transaction per edge to keep partial-state windows minimal.
    await prisma.$transaction(async (tx) => {
      await tx.relationshipEdge.update({
        where: { id: edge.id },
        data: {
          fromEntityId: fromResult.entity?.id ?? null,
          toEntityId: toResult.entity?.id ?? null,
          resolverVersion: resolverVersion,
          resolverConfidence: combined,
        },
      });

      if (fromResult.entity && toResult.entity) {
        await tx.entityRelationship.create({
          data: {
            fromEntityId: fromResult.entity.id,
            toEntityId: toResult.entity.id,
            relationshipType: relType,
            projectName: edge.projectName,
            projectValue: edge.projectValue,
            projectYear: edge.projectYear,
            jurisdiction: edge.location,
            source: "backfill_edge",
            sourceUrl: edge.sourceUrl,
            confidence: combined,
            reviewStatus:
              combined === "HIGH" || combined === "VERIFIED" ? "AUTO_MATCHED" : "PENDING_REVIEW",
            notes: edge.notes,
            legacyEdgeId: edge.id,
          },
        });
        progress.entityRelationshipsCreated += 1;
      }
    });

    progress.rowsProcessed += 1;
    progress.lastProcessedId = edge.id;
  }
}

async function runPhaseB(
  opts: BackfillOptions,
  state: CheckpointState,
  resolverVersion: string
): Promise<void> {
  const phase = state.phases.relationshipEdge;
  if (phase.status === "complete" || phase.status === "skipped") return;

  phase.status = "in_progress";
  phase.startedAt = phase.startedAt ?? new Date().toISOString();

  // Inventory total candidates. If replaying, count all rows; otherwise only
  // those not yet at the current resolverVersion.
  const where =
    opts.mode === "replay"
      ? {}
      : { OR: [{ resolverVersion: null }, { resolverVersion: { not: resolverVersion } }] };
  const total = await prisma.relationshipEdge.count({ where });
  phase.totalCandidates = total;

  const limit = opts.maxRows ?? total;
  const effectiveTotal = Math.min(total, limit);
  phase.totalBatchesPlanned = Math.ceil(effectiveTotal / opts.batchSize);

  let processedThisRun = 0;
  let cursor = phase.lastProcessedId;

  while (processedThisRun < effectiveTotal) {
    const remaining = effectiveTotal - processedThisRun;
    const batch = Math.min(opts.batchSize, remaining);
    const rows = await prisma.relationshipEdge.findMany({
      where: {
        ...where,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: batch,
      select: { id: true },
    });
    if (rows.length === 0) break;

    await processRelationshipEdgeBatch(
      rows.map((r) => r.id),
      resolverVersion,
      phase,
      opts.verbose
    );

    phase.batchesComplete += 1;
    processedThisRun += rows.length;
    cursor = phase.lastProcessedId;

    writeCheckpoint(opts.checkpointPath, state);
  }

  phase.status = "complete";
  phase.completedAt = new Date().toISOString();
  writeCheckpoint(opts.checkpointPath, state);
}

async function runPhaseA(opts: BackfillOptions, state: CheckpointState): Promise<void> {
  const phase = state.phases.watchlistSeed;
  if (opts.noSeed) {
    phase.status = "skipped";
    phase.startedAt = phase.startedAt ?? new Date().toISOString();
    phase.completedAt = new Date().toISOString();
    writeCheckpoint(opts.checkpointPath, state);
    return;
  }
  if (phase.status === "complete") return;

  phase.status = "in_progress";
  phase.startedAt = phase.startedAt ?? new Date().toISOString();
  writeCheckpoint(opts.checkpointPath, state);

  const markdown = readWatchlist();
  const entries = parseWatchlist(markdown);
  phase.parsedEntries = entries.length;
  const result = await materializeSeed(entries, { dryRun: opts.mode === "dry-run" });
  Object.assign(phase, result);
  phase.status = "complete";
  phase.completedAt = new Date().toISOString();
  writeCheckpoint(opts.checkpointPath, state);
}

async function runPhaseC(opts: BackfillOptions, state: CheckpointState): Promise<void> {
  // MI-3 deferred. Phase C lands in a future PR (MI-3.x or MI-5 ingestion
  // path will obviate it).
  const phase = state.phases.marketSignal;
  phase.status = "skipped";
  phase.startedAt = new Date().toISOString();
  phase.completedAt = new Date().toISOString();
  phase.totalSignals = await prisma.marketSignal.count();
  writeCheckpoint(opts.checkpointPath, state);
}

/**
 * Top-level backfill entry point. Picks up from checkpoint if compatible,
 * otherwise refuses (operator deletes the checkpoint to start fresh).
 *
 * Returns the final CheckpointState. Caller (CLI) is responsible for
 * producing the human-readable report and exiting with the right code.
 */
export async function runBackfill(opts: BackfillOptions): Promise<CheckpointState> {
  const resolverVersion = RESOLVER_VERSION;

  let state: CheckpointState | null = readCheckpoint(opts.checkpointPath);
  if (state) {
    const compat = checkpointMatchesRun(state, opts.tier, resolverVersion);
    if (!compat.compatible) {
      throw new Error(
        `Refusing to resume incompatible checkpoint: ${compat.reason}. ` +
          `Delete ${opts.checkpointPath} to start fresh, or use --replay.`
      );
    }
    state.mode = opts.mode; // mode can change between runs
  } else {
    state = initialCheckpoint(opts.tier, opts.mode);
    writeCheckpoint(opts.checkpointPath, state);
  }

  // Dry-run / report-only modes return before any writes (Phase A's
  // materializeSeed honors dryRun internally; Phase B doesn't run).
  if (opts.mode === "dry-run" || opts.mode === "report-only") {
    if (!opts.noSeed) {
      const markdown = readWatchlist();
      const entries = parseWatchlist(markdown);
      const dryProgress = await materializeSeed(entries, { dryRun: true });
      Object.assign(state.phases.watchlistSeed, dryProgress);
    }
    state.phases.relationshipEdge.status = "skipped";
    state.phases.marketSignal.status = "skipped";
    writeCheckpoint(opts.checkpointPath, state);
    return state;
  }

  await runPhaseA(opts, state);
  await runPhaseB(opts, state, resolverVersion);
  await runPhaseC(opts, state);

  return state;
}

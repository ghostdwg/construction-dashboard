// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityBackfill/plan.ts
//  Phase MI-3 — Read-only backfill plan generator.
//
//  Inspects the corpus and produces a structured "what would happen if we
//  ran a full backfill right now" snapshot. Used by --dry-run mode to show
//  operators the blast radius before they commit to writes.
//
//  Plan is bounded by maxRows / batchSize from BackfillOptions. No DB
//  writes. No resolver calls.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import type { BackfillOptions } from "./types";

export interface BackfillPlan {
  tier: string;
  mode: string;
  resolverVersion: string;
  totals: {
    relationshipEdgeRowsTotal: number;
    relationshipEdgeRowsAlreadyResolved: number;
    relationshipEdgeRowsToProcess: number;
    marketSignalRowsTotal: number;
    marketLeadRowsTotal: number;
    entityRowsExisting: number;
    entityAliasRowsExisting: number;
    entityWatchlistSeedRowsExisting: number;
  };
  batches: {
    relationshipEdgeBatchCount: number;
    relationshipEdgeBatchSize: number;
  };
  sampleRows: {
    relationshipEdge: Array<{
      id: string;
      fromName: string;
      fromType: string;
      toName: string;
      toType: string;
      relationshipType: string;
      alreadyResolved: boolean;
    }>;
  };
  notes: string[];
}

export async function buildPlan(opts: BackfillOptions, resolverVersion: string): Promise<BackfillPlan> {
  const notes: string[] = [];

  const reTotal = await prisma.relationshipEdge.count();
  const reAlreadyResolved =
    opts.mode === "replay"
      ? 0
      : await prisma.relationshipEdge.count({
          where: { resolverVersion: resolverVersion },
        });
  const reToProcess = Math.min(
    reTotal - reAlreadyResolved,
    opts.maxRows ?? Number.POSITIVE_INFINITY
  );

  const msTotal = await prisma.marketSignal.count();
  const mlTotal = await prisma.marketLead.count();

  const entityTotal = await prisma.entity.count();
  const aliasTotal = await prisma.entityAlias.count();
  const seedTotal = await prisma.entityWatchlistSeed.count();

  const sampleEdges = await prisma.relationshipEdge.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fromName: true,
      fromType: true,
      toName: true,
      toType: true,
      relationshipType: true,
      resolverVersion: true,
    },
  });

  if (reTotal === 0) {
    notes.push("No RelationshipEdge rows present. Phase B will be a no-op.");
  }
  if (reAlreadyResolved > 0 && opts.mode !== "replay") {
    notes.push(
      `${reAlreadyResolved} RelationshipEdge rows already resolved at ` +
        `version ${resolverVersion}. Use --replay to force re-resolution.`
    );
  }
  if (entityTotal === 0 && seedTotal === 0 && !opts.noSeed) {
    notes.push("Entity table empty — Phase A will materialize the watchlist seed first.");
  }
  if (opts.noSeed && entityTotal === 0) {
    notes.push(
      "WARNING: --no-seed AND Entity table empty. Phase B Pass-5 auto-creation " +
        "will produce LOW_CONFIDENCE entities for every name in the corpus. " +
        "Strongly recommend seeding first."
    );
  }

  return {
    tier: opts.tier,
    mode: opts.mode,
    resolverVersion,
    totals: {
      relationshipEdgeRowsTotal: reTotal,
      relationshipEdgeRowsAlreadyResolved: reAlreadyResolved,
      relationshipEdgeRowsToProcess: reToProcess,
      marketSignalRowsTotal: msTotal,
      marketLeadRowsTotal: mlTotal,
      entityRowsExisting: entityTotal,
      entityAliasRowsExisting: aliasTotal,
      entityWatchlistSeedRowsExisting: seedTotal,
    },
    batches: {
      relationshipEdgeBatchCount: Math.ceil(reToProcess / opts.batchSize),
      relationshipEdgeBatchSize: opts.batchSize,
    },
    sampleRows: {
      relationshipEdge: sampleEdges.map((r) => ({
        id: r.id,
        fromName: r.fromName,
        fromType: r.fromType,
        toName: r.toName,
        toType: r.toType,
        relationshipType: r.relationshipType,
        alreadyResolved: r.resolverVersion === resolverVersion,
      })),
    },
    notes,
  };
}

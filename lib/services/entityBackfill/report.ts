// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityBackfill/report.ts
//  Phase MI-3 — Post-backfill aggregation and reporting.
//
//  After execute.ts finishes, this module produces a structured
//  BackfillReport (JSON-safe) and a human-readable string rendering.
//  The structured report is the input to the future MI-4 review UI.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import {
  RESOLVER_VERSION,
  type Confidence,
  type EntityRecord,
  type AliasRecord,
} from "@/lib/services/entityResolver";
import { detectCollisions } from "./collisions";
import type {
  BackfillReport,
  CheckpointState,
  ManualReviewRow,
} from "./types";

const TOP_LIST_LIMIT = 20;
const UNRESOLVED_SAMPLE_LIMIT = 25;

export async function buildReport(state: CheckpointState): Promise<BackfillReport> {
  const generatedAt = new Date().toISOString();
  const durationMs =
    new Date(generatedAt).getTime() - new Date(state.startedAt).getTime();

  // Fetch the corpus snapshot for analysis. For large datasets these
  // queries grow; for MI-3's expected volume (≤ a few thousand entities)
  // they're cheap.
  const entities = (await prisma.entity.findMany()) as EntityRecord[];
  const aliases = (await prisma.entityAlias.findMany()) as AliasRecord[];
  const entityRelationships = await prisma.entityRelationship.findMany({
    select: {
      id: true,
      fromEntityId: true,
      toEntityId: true,
      relationshipType: true,
      reviewStatus: true,
      confidence: true,
      source: true,
    },
  });

  // ── Aggregates ────────────────────────────────────────────────────────────
  const reviewStatusHistogram: Record<string, number> = {};
  const confidenceHistogram: Record<Confidence, number> = {
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    NONE: 0,
  };
  let entitiesCreatedThisRun = 0;
  let pendingReviewCount = 0;
  let lowConfidenceCount = 0;

  for (const e of entities) {
    reviewStatusHistogram[e.reviewStatus] =
      (reviewStatusHistogram[e.reviewStatus] ?? 0) + 1;
    if (e.confidence in confidenceHistogram) {
      confidenceHistogram[e.confidence as Confidence] += 1;
    }
    if (e.source === "backfill_edge" || e.source === "resolver") entitiesCreatedThisRun += 1;
    if (e.reviewStatus === "PENDING_REVIEW") pendingReviewCount += 1;
    if (e.reviewStatus === "LOW_CONFIDENCE") lowConfidenceCount += 1;
  }

  // Aliases created this run (best-effort: source field)
  const aliasesCreatedThisRun = aliases.filter(
    (a) => a.confidence !== "VERIFIED" // crude heuristic; alias rows lack source
  ).length;

  // ── Resolver pass histogram (read from checkpoint) ────────────────────────
  const fp = state.phases.relationshipEdge.fromMatches;
  const tp = state.phases.relationshipEdge.toMatches;
  const resolverPassHistogram: Record<string, number> = {
    pass1_exactName: fp.pass1_exactName + tp.pass1_exactName,
    pass2_exactAlias: fp.pass2_exactAlias + tp.pass2_exactAlias,
    pass3_fuzzyHigh: fp.pass3_fuzzyHigh + tp.pass3_fuzzyHigh,
    pass4_needsReview: fp.pass4_needsReview + tp.pass4_needsReview,
    pass5_autoCreated: fp.pass5_autoCreated + tp.pass5_autoCreated,
    pass6_arbitrated: fp.pass6_arbitrated + tp.pass6_arbitrated,
    noMatch: fp.noMatch + tp.noMatch,
  };

  // ── ResolverVersion distribution ──────────────────────────────────────────
  const versionCounts: Record<string, { entities: number; edges: number }> = {};
  const edgeRows = await prisma.relationshipEdge.findMany({
    select: { resolverVersion: true },
  });
  for (const r of edgeRows) {
    const v = r.resolverVersion ?? "unresolved";
    if (!versionCounts[v]) versionCounts[v] = { entities: 0, edges: 0 };
    versionCounts[v].edges += 1;
  }
  for (const e of entities) {
    const v = (e.source ?? "").startsWith("backfill") ? RESOLVER_VERSION : "manual_or_seed";
    if (!versionCounts[v]) versionCounts[v] = { entities: 0, edges: 0 };
    versionCounts[v].entities += 1;
  }

  // ── Top entities by relationship count ────────────────────────────────────
  const relCount = new Map<string, number>();
  for (const er of entityRelationships) {
    relCount.set(er.fromEntityId, (relCount.get(er.fromEntityId) ?? 0) + 1);
    relCount.set(er.toEntityId, (relCount.get(er.toEntityId) ?? 0) + 1);
  }
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const topEntities = [...relCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_LIST_LIMIT)
    .map(([id, count]) => {
      const e = entityById.get(id);
      return {
        id,
        canonicalName: e?.canonicalName ?? "(unknown)",
        entityType: e?.entityType ?? "Unknown",
        relationshipCount: count,
      };
    });

  // ── Top recurring pairings ────────────────────────────────────────────────
  // Aggregate by (fromId, toId, relType). Use sorted pair as key so the
  // count includes both directions for partnership-style relationships.
  const pairCount = new Map<
    string,
    { fromId: string; toId: string; relationshipType: string; count: number }
  >();
  for (const er of entityRelationships) {
    const key = `${er.fromEntityId}|${er.toEntityId}|${er.relationshipType}`;
    const prev = pairCount.get(key);
    if (prev) prev.count += 1;
    else
      pairCount.set(key, {
        fromId: er.fromEntityId,
        toId: er.toEntityId,
        relationshipType: er.relationshipType,
        count: 1,
      });
  }
  const topPairings = [...pairCount.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_LIST_LIMIT)
    .map((p) => ({
      fromId: p.fromId,
      fromCanonicalName: entityById.get(p.fromId)?.canonicalName ?? "(unknown)",
      toId: p.toId,
      toCanonicalName: entityById.get(p.toId)?.canonicalName ?? "(unknown)",
      relationshipCount: p.count,
      relationshipType: p.relationshipType,
    }));

  // ── Unresolved name samples ───────────────────────────────────────────────
  const unresolvedEdges = await prisma.relationshipEdge.findMany({
    where: { resolverVersion: null },
    take: UNRESOLVED_SAMPLE_LIMIT,
    select: { fromName: true, toName: true },
  });
  const unresolvedNames = unresolvedEdges
    .flatMap((e) => [e.fromName, e.toName])
    .slice(0, UNRESOLVED_SAMPLE_LIMIT);

  // ── Collisions ────────────────────────────────────────────────────────────
  const collisions = detectCollisions(entities, aliases);

  // ── Manual review queue (top N) ───────────────────────────────────────────
  const pending = entities.filter(
    (e) => e.reviewStatus === "PENDING_REVIEW" || e.reviewStatus === "LOW_CONFIDENCE"
  );
  const inboundCounts = new Map<string, number>();
  const outboundCounts = new Map<string, number>();
  for (const er of entityRelationships) {
    inboundCounts.set(er.toEntityId, (inboundCounts.get(er.toEntityId) ?? 0) + 1);
    outboundCounts.set(er.fromEntityId, (outboundCounts.get(er.fromEntityId) ?? 0) + 1);
  }
  const manualReviewQueue: ManualReviewRow[] = pending
    .slice(0, TOP_LIST_LIMIT)
    .map((e) => ({
      entityId: e.id,
      canonicalName: e.canonicalName,
      entityType: e.entityType,
      reviewStatus: e.reviewStatus,
      confidence: e.confidence,
      source: e.source ?? null,
      inboundRelationships: inboundCounts.get(e.id) ?? 0,
      outboundRelationships: outboundCounts.get(e.id) ?? 0,
      closestPeers: [],
    }));

  return {
    schemaVersion: 1,
    generatedAt,
    tier: state.tier,
    mode: state.mode,
    resolverVersion: state.resolverVersion,
    durationMs,
    phases: state.phases,
    totals: {
      rowsScanned:
        state.phases.relationshipEdge.rowsProcessed +
        state.phases.relationshipEdge.skippedAlreadyResolved,
      entitiesTotal: entities.length,
      entitiesCreatedThisRun,
      aliasesCreatedThisRun,
      entityRelationshipsTotal: entityRelationships.length,
      entityRelationshipsCreatedThisRun:
        state.phases.relationshipEdge.entityRelationshipsCreated,
      unresolvedNames,
      pendingReviewCount,
      lowConfidenceCount,
    },
    confidenceHistogram,
    reviewStatusHistogram,
    resolverPassHistogram,
    resolverVersionDistribution: versionCounts,
    topEntities,
    topPairings,
    collisions,
    manualReviewQueue,
  };
}

export function formatReport(report: BackfillReport): string {
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push("=== Entity Backfill Report ===");
  push(`Generated:        ${report.generatedAt}`);
  push(`Tier:             ${report.tier}`);
  push(`Mode:             ${report.mode}`);
  push(`Resolver version: ${report.resolverVersion}`);
  push(`Duration:         ${(report.durationMs / 1000).toFixed(1)}s`);
  push("");

  push("── Phase A — Watchlist Seed ──");
  const a = report.phases.watchlistSeed;
  push(`  Status:                  ${a.status}`);
  push(`  Parsed entries:          ${a.parsedEntries}`);
  push(`  Seed rows materialized:  ${a.materializedSeedRows}`);
  push(`  Entities created:        ${a.createdEntities}`);
  push(`  Existing skipped:        ${a.skippedExistingEntities}`);
  if (a.error) push(`  Error:                   ${a.error}`);
  push("");

  push("── Phase B — RelationshipEdge ──");
  const b = report.phases.relationshipEdge;
  push(`  Status:                  ${b.status}`);
  push(`  Total candidates:        ${b.totalCandidates}`);
  push(`  Rows processed:          ${b.rowsProcessed}`);
  push(`  Already resolved (skipped): ${b.skippedAlreadyResolved}`);
  push(`  Batches: ${b.batchesComplete}/${b.totalBatchesPlanned}`);
  push(`  EntityRelationships:     ${b.entityRelationshipsCreated}`);
  push("  Pass distribution (from + to combined):");
  for (const [k, v] of Object.entries(report.resolverPassHistogram)) {
    push(`    ${k.padEnd(22)} ${v}`);
  }
  if (b.error) push(`  Error:                   ${b.error}`);
  push("");

  push("── Phase C — MarketSignal mentions (deferred in MI-3) ──");
  const c = report.phases.marketSignal;
  push(`  Status:                  ${c.status}`);
  push(`  Total signals (corpus):  ${c.totalSignals}`);
  push("");

  push("── Top recurring entities ──");
  for (const t of report.topEntities) {
    push(
      `  ${t.canonicalName.padEnd(40)} ${t.entityType.padEnd(12)} ${t.relationshipCount} rel`
    );
  }
  push("");

  push("── Top recurring pairings ──");
  for (const p of report.topPairings) {
    push(
      `  ${p.fromCanonicalName} ↔ ${p.toCanonicalName} ` +
        `(${p.relationshipType}) ×${p.relationshipCount}`
    );
  }
  push("");

  push("── Manual review queue ──");
  push(`  PENDING_REVIEW: ${report.totals.pendingReviewCount}`);
  push(`  LOW_CONFIDENCE: ${report.totals.lowConfidenceCount}`);
  push(`  (top ${report.manualReviewQueue.length} listed in JSON report)`);
  push("");

  push("── Collisions detected ──");
  if (report.collisions.length === 0) push("  (none)");
  for (const c of report.collisions) {
    push(`  [${c.kind}] ${c.description}`);
  }
  push("");

  push("── Resolver version distribution ──");
  for (const [v, counts] of Object.entries(report.resolverVersionDistribution)) {
    push(`  ${v.padEnd(12)} entities=${counts.entities} edges=${counts.edges}`);
  }

  if (report.totals.unresolvedNames.length > 0) {
    push("");
    push("── Unresolved name sample (first 25) ──");
    for (const n of report.totals.unresolvedNames) push(`  ${n}`);
  }

  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectBackfill/report.ts
//  Phase MI-6 PR2 — Post-backfill aggregation + reporting.
//
//  Reads the corpus after a backfill run, computes histograms, runs the
//  collision detectors, and returns a JSON-safe ProjectBackfillReport
//  plus a human-readable formatReport rendering for stdout.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { AGGREGATOR_VERSION, LIFECYCLE_STATES, type LifecycleState } from "@/lib/services/projectAggregation";
import {
  detectProjectCollisions,
  type ProjectParcelSnapshot,
  type ProjectSnapshot,
} from "./collisions";
import type {
  CheckpointState,
  ProjectBackfillReport,
} from "./types";

const TOP_LIST_LIMIT = 15;

export async function buildReport(state: CheckpointState): Promise<ProjectBackfillReport> {
  const generatedAt = new Date().toISOString();
  const durationMs = new Date(generatedAt).getTime() - new Date(state.startedAt).getTime();

  const projects = await prisma.project.findMany();
  const projectIds = projects.map((p) => p.id);
  const [signals, entities, parcels] = await Promise.all([
    prisma.projectSignal.findMany({
      where: { detachedAt: null },
      select: { projectId: true, signalKind: true, attachScore: true, factorJson: true },
    }),
    prisma.projectEntity.findMany({
      where: { removed: false },
      select: { projectId: true, entityId: true, role: true },
    }),
    prisma.projectParcel.findMany({
      select: { projectId: true, parcelId: true, parcelSource: true },
    }),
  ]);

  // ── Histograms ───────────────────────────────────────────────────────────
  const lifecycleHistogram: Record<LifecycleState, number> = LIFECYCLE_STATES.reduce(
    (acc, s) => ({ ...acc, [s]: 0 }),
    {} as Record<LifecycleState, number>
  );
  const confidenceHistogram: Record<string, number> = {};
  const reviewStatusHistogram: Record<string, number> = {};
  const probabilityBuckets: Record<string, number> = {
    "0.0-0.1": 0, "0.1-0.2": 0, "0.2-0.3": 0, "0.3-0.4": 0, "0.4-0.5": 0,
    "0.5-0.6": 0, "0.6-0.7": 0, "0.7-0.8": 0, "0.8-0.9": 0, "0.9-1.0": 0, "(unset)": 0,
  };

  let projectsCreatedThisRun = 0;
  let pendingReviewCount = 0;
  let rejectedCount = 0;

  for (const p of projects) {
    if (p.lifecycleState in lifecycleHistogram) {
      lifecycleHistogram[p.lifecycleState as LifecycleState] += 1;
    }
    confidenceHistogram[p.confidence] = (confidenceHistogram[p.confidence] ?? 0) + 1;
    reviewStatusHistogram[p.reviewStatus] = (reviewStatusHistogram[p.reviewStatus] ?? 0) + 1;
    if (p.emergenceProbability == null) {
      probabilityBuckets["(unset)"] += 1;
    } else {
      const idx = Math.min(9, Math.floor(p.emergenceProbability * 10));
      const lo = (idx / 10).toFixed(1);
      const hi = ((idx + 1) / 10).toFixed(1);
      probabilityBuckets[`${lo}-${hi}`] += 1;
    }
    if (p.source?.startsWith("backfill_")) projectsCreatedThisRun += 1;
    if (p.reviewStatus === "PENDING_REVIEW") pendingReviewCount += 1;
    if (p.reviewStatus === "REJECTED") rejectedCount += 1;
  }

  // Signals per project — count grouping
  const signalsByProject = new Map<string, number>();
  for (const s of signals) signalsByProject.set(s.projectId, (signalsByProject.get(s.projectId) ?? 0) + 1);
  const signalsPerProjectHistogram: Record<string, number> = {
    "1-2": 0, "3-5": 0, "6-10": 0, "11-20": 0, "21+": 0,
  };
  for (const count of signalsByProject.values()) {
    if (count <= 2) signalsPerProjectHistogram["1-2"] += 1;
    else if (count <= 5) signalsPerProjectHistogram["3-5"] += 1;
    else if (count <= 10) signalsPerProjectHistogram["6-10"] += 1;
    else if (count <= 20) signalsPerProjectHistogram["11-20"] += 1;
    else signalsPerProjectHistogram["21+"] += 1;
  }

  // ── Top jurisdictions ────────────────────────────────────────────────────
  const jurisdictionCounts = new Map<string, number>();
  for (const p of projects) {
    if (!p.jurisdiction) continue;
    jurisdictionCounts.set(p.jurisdiction, (jurisdictionCounts.get(p.jurisdiction) ?? 0) + 1);
  }
  const topJurisdictions = [...jurisdictionCounts.entries()]
    .map(([jurisdiction, projectCount]) => ({ jurisdiction, projectCount }))
    .sort((a, b) => b.projectCount - a.projectCount)
    .slice(0, TOP_LIST_LIMIT);

  // ── Top developers (project participation) ───────────────────────────────
  const devCounts = new Map<string, number>();
  for (const e of entities) {
    if (e.role !== "DEVELOPER" && e.role !== "OWNER") continue;
    devCounts.set(e.entityId, (devCounts.get(e.entityId) ?? 0) + 1);
  }
  const topDeveloperIds = [...devCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_LIST_LIMIT);
  const devEntities = await prisma.entity.findMany({
    where: { id: { in: topDeveloperIds.map((d) => d[0]) } },
    select: { id: true, canonicalName: true },
  });
  const devNameById = new Map(devEntities.map((e) => [e.id, e.canonicalName]));
  const topDevelopers = topDeveloperIds.map(([entityId, projectCount]) => ({
    entityId,
    canonicalName: devNameById.get(entityId) ?? "(unknown)",
    projectCount,
  }));

  // ── Longest lifespan projects ────────────────────────────────────────────
  const longestLifespanProjects = projects
    .filter((p) => p.firstSignalAt && p.lastSignalAt)
    .map((p) => {
      const span = p.lastSignalAt!.getTime() - p.firstSignalAt!.getTime();
      return {
        projectId: p.id,
        workingTitle: p.workingTitle,
        spanDays: Math.round(span / (24 * 60 * 60 * 1000)),
        signalCount: signalsByProject.get(p.id) ?? 0,
      };
    })
    .sort((a, b) => b.spanDays - a.spanDays)
    .slice(0, TOP_LIST_LIMIT);

  // ── Top recurring patterns (jurisdiction + signal-kind tuple) ─────────────
  const patternCounts = new Map<string, { count: number; example: { projectId: string; workingTitle: string } | null }>();
  for (const p of projects) {
    if (!p.projectType && !p.jurisdiction) continue;
    const key = `${p.projectType ?? "?"}@${p.jurisdiction ?? "?"}`;
    const cur = patternCounts.get(key) ?? { count: 0, example: null };
    cur.count += 1;
    if (!cur.example) cur.example = { projectId: p.id, workingTitle: p.workingTitle };
    patternCounts.set(key, cur);
  }
  const topRecurringPatterns = [...patternCounts.entries()]
    .map(([pattern, v]) => ({ pattern, occurrences: v.count, example: v.example }))
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, TOP_LIST_LIMIT);

  // ── Collisions ───────────────────────────────────────────────────────────
  const developerByProject = new Map<string, string[]>();
  for (const e of entities) {
    if (e.role !== "DEVELOPER" && e.role !== "OWNER") continue;
    const arr = developerByProject.get(e.projectId) ?? [];
    arr.push(e.entityId);
    developerByProject.set(e.projectId, arr);
  }
  const parcelsByProject = new Map<string, Array<{ parcelId: string; parcelSource: string }>>();
  for (const par of parcels) {
    const arr = parcelsByProject.get(par.projectId) ?? [];
    arr.push({ parcelId: par.parcelId, parcelSource: par.parcelSource });
    parcelsByProject.set(par.projectId, arr);
  }
  const signalsByProjectFull = new Map<string, { scores: number[]; jurisdictions: string[] }>();
  for (const s of signals) {
    const cur = signalsByProjectFull.get(s.projectId) ?? { scores: [], jurisdictions: [] };
    cur.scores.push(s.attachScore);
    // Jurisdiction harvested from factorJson if present, else from project.
    if (s.factorJson) {
      try {
        const f = JSON.parse(s.factorJson) as { jurisdiction?: string };
        if (typeof f.jurisdiction === "string") cur.jurisdictions.push(f.jurisdiction);
      } catch {
        // ignore
      }
    }
    signalsByProjectFull.set(s.projectId, cur);
  }

  const projectSnapshots: ProjectSnapshot[] = projects.map((p) => ({
    id: p.id,
    workingTitle: p.workingTitle,
    jurisdiction: p.jurisdiction,
    reviewStatus: p.reviewStatus,
    parcelIds: (parcelsByProject.get(p.id) ?? []).map((x) => x.parcelId),
    developerIds: developerByProject.get(p.id) ?? [],
    signalScores: signalsByProjectFull.get(p.id)?.scores ?? [],
    signalJurisdictions:
      signalsByProjectFull.get(p.id)?.jurisdictions ?? (p.jurisdiction ? [p.jurisdiction] : []),
  }));
  const parcelSnapshots: ProjectParcelSnapshot[] = projects.map((p) => ({
    id: p.id,
    workingTitle: p.workingTitle,
    reviewStatus: p.reviewStatus,
    parcels: parcelsByProject.get(p.id) ?? [],
  }));

  const collisions = detectProjectCollisions({ projects: projectSnapshots, parcelSnapshots });
  const mergeCandidates = collisions.filter((c) => c.kind === "likely_duplicate_pair").length;
  const splitCandidates = collisions.filter(
    (c) => c.kind === "over_merged_cluster" || c.kind === "jurisdiction_drift"
  ).length;

  // ── Totals ───────────────────────────────────────────────────────────────
  const signalsAttachedThisRun =
    state.phases.relationshipEdge.signalsAttached +
    state.phases.marketLead.signalsAttached +
    state.phases.marketSignal.signalsAttached;

  const rowsScanned =
    state.phases.relationshipEdge.rowsProcessed +
    state.phases.relationshipEdge.rowsSkipped +
    state.phases.marketLead.rowsProcessed +
    state.phases.marketLead.rowsSkipped +
    state.phases.marketSignal.rowsProcessed +
    state.phases.marketSignal.rowsSkipped;

  const totalSignals = signals.length;
  const avgSignalsPerProject = projects.length > 0 ? totalSignals / projects.length : 0;

  return {
    schemaVersion: 1,
    generatedAt,
    tier: state.tier,
    mode: state.mode,
    aggregatorVersion: AGGREGATOR_VERSION,
    durationMs,
    phases: state.phases,
    totals: {
      rowsScanned,
      projectsTotal: projects.length,
      projectsCreatedThisRun,
      signalsAttachedThisRun,
      pendingReviewCount,
      rejectedCount,
      avgSignalsPerProject: Number(avgSignalsPerProject.toFixed(2)),
    },
    lifecycleHistogram,
    confidenceHistogram,
    reviewStatusHistogram,
    probabilityHistogram: probabilityBuckets,
    signalsPerProjectHistogram,
    topJurisdictions,
    topDevelopers,
    topRecurringPatterns,
    longestLifespanProjects,
    collisions,
    mergeCandidates,
    splitCandidates,
    reviewQueueSize: pendingReviewCount,
  };
}

export function formatReport(report: ProjectBackfillReport): string {
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push("=== Project Aggregate Backfill Report ===");
  push(`Generated:           ${report.generatedAt}`);
  push(`Tier:                ${report.tier}`);
  push(`Mode:                ${report.mode}`);
  push(`Aggregator version:  ${report.aggregatorVersion}`);
  push(`Duration:            ${(report.durationMs / 1000).toFixed(1)}s`);
  push("");

  push("── Per-phase progress ──");
  for (const [name, phase] of Object.entries(report.phases)) {
    push(`  ${name.padEnd(20)} ${phase.status.padEnd(12)} ${phase.rowsProcessed}/${phase.totalCandidates} processed, ${phase.rowsSkipped} skipped`);
    push(`    decisions: create_new=${phase.decisionCounts.create_new} attach=${phase.decisionCounts.attach_to_existing} review=${phase.decisionCounts.needs_review}`);
  }
  push("");

  push("── Totals ──");
  push(`  Rows scanned:               ${report.totals.rowsScanned}`);
  push(`  Projects total:             ${report.totals.projectsTotal}`);
  push(`  Projects created this run:  ${report.totals.projectsCreatedThisRun}`);
  push(`  Signals attached this run:  ${report.totals.signalsAttachedThisRun}`);
  push(`  Avg signals / project:      ${report.totals.avgSignalsPerProject}`);
  push(`  PENDING_REVIEW:             ${report.totals.pendingReviewCount}`);
  push(`  REJECTED:                   ${report.totals.rejectedCount}`);
  push("");

  push("── Lifecycle state distribution ──");
  for (const [k, v] of Object.entries(report.lifecycleHistogram)) {
    if (v > 0) push(`  ${k.padEnd(22)} ${v}`);
  }
  push("");

  push("── Probability distribution ──");
  for (const [bucket, count] of Object.entries(report.probabilityHistogram)) {
    if (count > 0) push(`  ${bucket.padEnd(10)} ${count}`);
  }
  push("");

  push("── Top jurisdictions ──");
  for (const t of report.topJurisdictions) push(`  ${t.jurisdiction.padEnd(30)} ${t.projectCount}`);
  push("");

  push("── Top developers ──");
  for (const d of report.topDevelopers) {
    push(`  ${d.canonicalName.padEnd(36)} ${d.projectCount} project(s)`);
  }
  push("");

  push("── Longest-lifespan projects ──");
  for (const p of report.longestLifespanProjects) {
    push(`  ${p.spanDays}d  ${p.signalCount}sig  ${p.workingTitle}`);
  }
  push("");

  push("── Top recurring patterns (projectType@jurisdiction) ──");
  for (const p of report.topRecurringPatterns) {
    push(`  ${p.pattern.padEnd(36)} ${p.occurrences}`);
  }
  push("");

  push("── Operator review workload ──");
  push(`  Review queue size:    ${report.reviewQueueSize}`);
  push(`  Merge candidates:     ${report.mergeCandidates}`);
  push(`  Split candidates:     ${report.splitCandidates}`);
  push("");

  push("── Collisions detected ──");
  if (report.collisions.length === 0) push("  (none)");
  for (const c of report.collisions.slice(0, 30)) {
    push(`  [${c.kind}] ${c.description}`);
  }
  if (report.collisions.length > 30) {
    push(`  ... and ${report.collisions.length - 30} more (full list in JSON report)`);
  }

  return lines.join("\n");
}

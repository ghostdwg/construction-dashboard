// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectBackfill/execute.ts
//  Phase MI-6 PR2 — Three-phase historical aggregation orchestrator.
//
//  Phase A: RelationshipEdge backfill (strongest structured signals first)
//  Phase B: MarketLead backfill
//  Phase C: MarketSignal backfill (weakest, most ambiguous, last)
//
//  Each phase iterates its source table in id-asc batches, converts rows
//  to SignalInput, fetches a filtered candidate pool, calls
//  detectProjectContinuation, and acts on the result:
//
//    create_new          → createProjectAggregate(source='backfill_v1') then attach
//    attach_to_existing  → attachSignalToProject with the resolved score
//    needs_review        → create a NEW Project at reviewStatus=PENDING_REVIEW
//                          with the candidate list captured in TimelineEvent
//                          payload, then attach the signal to it. Operator
//                          merges in MI-6 PR3 UI if appropriate. This avoids
//                          auto-merging ambiguous projects.
//
//  After each batch, the checkpoint is rewritten so resume picks up at
//  the last processed id.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import {
  attachSignalToProject,
  createProjectAggregate,
  detectProjectContinuation,
  recordTimelineEvent,
  updateProjectProbability,
  AGGREGATOR_VERSION,
  type SignalInput,
  type ContinuationDecision,
} from "@/lib/services/projectAggregation";
import {
  buildProjectContext,
  fetchCandidateProjectIds,
} from "./candidatePool";
import {
  initialCheckpoint,
  readCheckpoint,
  writeCheckpoint,
  checkpointCompatible,
} from "./checkpoint";
import {
  marketLeadToSignalInput,
  marketSignalToSignalInput,
  relationshipEdgeToSignalInput,
  type MarketLeadRow,
  type MarketSignalRow,
  type RelationshipEdgeRow,
} from "./signalSources";
import type {
  CheckpointState,
  ProjectBackfillOptions,
  SourcePhaseProgress,
} from "./types";

// ── Common batch driver ──────────────────────────────────────────────────────

interface BatchDriverArgs<TRow extends { id: string }> {
  opts: ProjectBackfillOptions;
  state: CheckpointState;
  phase: SourcePhaseProgress;
  fetchBatch: (cursor: string | null, batchSize: number) => Promise<TRow[]>;
  toSignal: (row: TRow) => SignalInput;
  alreadyAttachedCheck: (row: TRow) => Promise<boolean>;
}

async function runBatchedPhase<TRow extends { id: string }>(args: BatchDriverArgs<TRow>): Promise<void> {
  const { opts, state, phase, fetchBatch, toSignal, alreadyAttachedCheck } = args;
  if (phase.status === "complete" || phase.status === "skipped") return;

  phase.status = "in_progress";
  phase.startedAt = phase.startedAt ?? new Date().toISOString();
  writeCheckpoint(opts.checkpointPath, state);

  let cursor = phase.lastProcessedId;
  let processed = phase.rowsProcessed;
  const maxRows = opts.maxRows ?? Number.POSITIVE_INFINITY;

  while (processed < maxRows) {
    const remaining = Math.min(opts.batchSize, maxRows - processed);
    const rows = await fetchBatch(cursor, remaining);
    if (rows.length === 0) break;

    for (const row of rows) {
      cursor = row.id;
      if (opts.mode !== "replay") {
        const already = await alreadyAttachedCheck(row);
        if (already) {
          phase.rowsSkipped += 1;
          phase.lastProcessedId = row.id;
          continue;
        }
      }

      const signal = toSignal(row);
      const decision = await scoreAndDecide(signal, opts);

      await applyDecision(decision, signal, phase, opts);

      processed += 1;
      phase.rowsProcessed = processed;
      phase.lastProcessedId = row.id;

      if (processed >= maxRows) break;
    }

    writeCheckpoint(opts.checkpointPath, state);
  }

  phase.status = "complete";
  phase.completedAt = new Date().toISOString();
  writeCheckpoint(opts.checkpointPath, state);
}

// ── Scoring + decision ──────────────────────────────────────────────────────

async function scoreAndDecide(
  signal: SignalInput,
  opts: ProjectBackfillOptions
): Promise<ContinuationDecision> {
  const candidateIds = await fetchCandidateProjectIds(signal);
  if (candidateIds.length === 0) {
    return { kind: "create_new", reason: "no candidate projects in pool" };
  }
  const contexts = (
    await Promise.all(candidateIds.map((id) => buildProjectContext(id)))
  ).filter((c): c is NonNullable<typeof c> => c !== null);

  return detectProjectContinuation({
    signal,
    candidates: contexts,
    thresholdsOverride: {
      attachAuto: opts.attachAutoThreshold,
      review: opts.reviewThreshold,
    },
  });
}

// ── Acting on a decision ─────────────────────────────────────────────────────

async function applyDecision(
  decision: ContinuationDecision,
  signal: SignalInput,
  phase: SourcePhaseProgress,
  opts: ProjectBackfillOptions
): Promise<void> {
  if (decision.kind === "create_new") {
    const { projectId } = await createProjectAggregate({
      workingTitle: signal.title?.trim() || workingTitleFallback(signal),
      jurisdiction: signal.jurisdiction,
      source: `backfill_${signal.kind.toLowerCase()}`,
      initialSignal: signal,
    });
    phase.projectsCreated += 1;
    phase.signalsAttached += 1;
    phase.decisionCounts.create_new += 1;
    await maybeUpdateProbability(projectId);
    return;
  }

  if (decision.kind === "attach_to_existing") {
    const projectId = decision.project.candidateProjectId;
    await attachSignalToProject({
      projectId,
      signal,
      attachReason: decision.project.reasonLog.join(" + ") || decision.reason,
      attachScore: decision.project.score,
      factors: factorsToRecord(decision.project.factors),
    });
    phase.signalsAttached += 1;
    phase.decisionCounts.attach_to_existing += 1;
    await maybeUpdateProbability(projectId);
    return;
  }

  // needs_review: create a NEW project at PENDING_REVIEW with the candidates
  // captured in a timeline event. Operator decides whether to merge later
  // (MI-6 PR3 UI). This avoids auto-merging ambiguous projects.
  const candidates = decision.candidates;
  const { projectId } = await createProjectAggregate({
    workingTitle: signal.title?.trim() || workingTitleFallback(signal),
    jurisdiction: signal.jurisdiction,
    source: `backfill_${signal.kind.toLowerCase()}_pending`,
    initialSignal: signal,
  });
  await prisma.project.update({
    where: { id: projectId },
    data: { reviewStatus: "PENDING_REVIEW", confidence: "LOW" },
  });
  await recordTimelineEvent({
    projectId,
    eventType: "REVIEW_ACTION",
    occurredAt: signal.occurredAt,
    summary:
      `Created at PENDING_REVIEW with ${candidates.length} candidate project(s) ` +
      `in the review band (best score ${candidates[0]?.score.toFixed(3) ?? "n/a"})`,
    payload: {
      reason: decision.reason,
      candidates: candidates.map((c) => ({
        projectId: c.candidateProjectId,
        score: c.score,
        reasons: c.reasonLog,
      })),
    },
  });
  phase.projectsCreated += 1;
  phase.signalsAttached += 1;
  phase.decisionCounts.needs_review += 1;
  await maybeUpdateProbability(projectId);

  if (opts.verbose) {
    console.log(
      `[project-backfill] needs_review: created PENDING_REVIEW project ${projectId} ` +
        `(${candidates.length} merge candidates)`
    );
  }
}

async function maybeUpdateProbability(projectId: string): Promise<void> {
  // Probability recomputed once per attachment so the snapshot history reflects
  // each accretion. For very high-volume runs this could be deferred until
  // end-of-phase; for MI-6 PR2 volumes it's negligible cost.
  try {
    await updateProjectProbability({ projectId, reason: "backfill_accretion" });
  } catch (err) {
    // Probability is recoverable — don't fail the batch on a snapshot error.
    console.warn(`[project-backfill] probability update failed for ${projectId}:`, err);
  }
}

function workingTitleFallback(signal: SignalInput): string {
  if (signal.address) return signal.address.slice(0, 120);
  if (signal.jurisdiction) return `${signal.jurisdiction} project (${signal.kind})`;
  return `Untitled ${signal.kind} ${signal.occurredAt.toISOString().slice(0, 10)}`;
}

function factorsToRecord(factors: object): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(factors)) {
    if (typeof v === "number") out[k] = Number(v.toFixed(4));
  }
  return out;
}

// ── Phase wrappers ───────────────────────────────────────────────────────────

async function fetchEdges(cursor: string | null, take: number): Promise<RelationshipEdgeRow[]> {
  return prisma.relationshipEdge.findMany({
    where: cursor ? { id: { gt: cursor } } : {},
    orderBy: { id: "asc" },
    take,
    select: {
      id: true,
      fromType: true,
      fromName: true,
      fromEntityId: true,
      toType: true,
      toName: true,
      toEntityId: true,
      relationshipType: true,
      projectName: true,
      projectYear: true,
      location: true,
      source: true,
      createdAt: true,
    },
  });
}

async function fetchLeads(cursor: string | null, take: number): Promise<MarketLeadRow[]> {
  return prisma.marketLead.findMany({
    where: cursor ? { id: { gt: cursor } } : {},
    orderBy: { id: "asc" },
    take,
    select: {
      id: true,
      title: true,
      leadType: true,
      source: true,
      status: true,
      confidence: true,
      location: true,
      jurisdiction: true,
      projectType: true,
      estimatedValue: true,
      detectedAt: true,
    },
  });
}

async function fetchSignals(cursor: string | null, take: number): Promise<MarketSignalRow[]> {
  return prisma.marketSignal.findMany({
    where: cursor ? { id: { gt: cursor } } : {},
    orderBy: { id: "asc" },
    take,
    select: {
      id: true,
      headline: true,
      signalType: true,
      signalSubtype: true,
      sourceDate: true,
      metadata: true,
      createdAt: true,
    },
  });
}

async function edgeAlreadyAttached(row: { id: string }): Promise<boolean> {
  const hit = await prisma.projectSignal.findFirst({
    where: { sourceRelationshipEdgeId: row.id, detachedAt: null },
    select: { id: true },
  });
  return hit !== null;
}

async function leadAlreadyAttached(row: { id: string }): Promise<boolean> {
  const hit = await prisma.projectSignal.findFirst({
    where: { sourceMarketLeadId: row.id, detachedAt: null },
    select: { id: true },
  });
  return hit !== null;
}

async function signalAlreadyAttached(row: { id: string }): Promise<boolean> {
  const hit = await prisma.projectSignal.findFirst({
    where: { sourceMarketSignalId: row.id, detachedAt: null },
    select: { id: true },
  });
  return hit !== null;
}

// ── Public entry ─────────────────────────────────────────────────────────────

export async function runProjectBackfill(opts: ProjectBackfillOptions): Promise<CheckpointState> {
  const aggregatorVersion = AGGREGATOR_VERSION;

  let state: CheckpointState | null = readCheckpoint(opts.checkpointPath);
  if (state) {
    const compat = checkpointCompatible(state, opts.tier, aggregatorVersion);
    if (!compat.compatible) {
      throw new Error(
        `Refusing to resume incompatible checkpoint: ${compat.reason}. ` +
          `Delete ${opts.checkpointPath} or use --replay.`
      );
    }
    state.mode = opts.mode;
  } else {
    state = initialCheckpoint(opts.tier, opts.mode);
    writeCheckpoint(opts.checkpointPath, state);
  }

  if (opts.mode === "dry-run" || opts.mode === "report-only") {
    // Dry-run / report-only: don't execute phases. Caller has already
    // emitted the plan if dry-run; report.ts produces the report.
    for (const k of ["relationshipEdge", "marketLead", "marketSignal"] as const) {
      const p = state.phases[k];
      if (p.status === "pending") p.status = "skipped";
    }
    writeCheckpoint(opts.checkpointPath, state);
    return state;
  }

  // Phase A: RelationshipEdge (strongest)
  if (opts.sources.includes("RelationshipEdge")) {
    state.phases.relationshipEdge.totalCandidates = await prisma.relationshipEdge.count();
    await runBatchedPhase({
      opts,
      state,
      phase: state.phases.relationshipEdge,
      fetchBatch: fetchEdges,
      toSignal: relationshipEdgeToSignalInput,
      alreadyAttachedCheck: edgeAlreadyAttached,
    });
  } else {
    state.phases.relationshipEdge.status = "skipped";
  }

  // Phase B: MarketLead
  if (opts.sources.includes("MarketLead")) {
    state.phases.marketLead.totalCandidates = await prisma.marketLead.count();
    await runBatchedPhase({
      opts,
      state,
      phase: state.phases.marketLead,
      fetchBatch: fetchLeads,
      toSignal: marketLeadToSignalInput,
      alreadyAttachedCheck: leadAlreadyAttached,
    });
  } else {
    state.phases.marketLead.status = "skipped";
  }

  // Phase C: MarketSignal
  if (opts.sources.includes("MarketSignal")) {
    state.phases.marketSignal.totalCandidates = await prisma.marketSignal.count();
    await runBatchedPhase({
      opts,
      state,
      phase: state.phases.marketSignal,
      fetchBatch: fetchSignals,
      toSignal: marketSignalToSignalInput,
      alreadyAttachedCheck: signalAlreadyAttached,
    });
  } else {
    state.phases.marketSignal.status = "skipped";
  }

  return state;
}

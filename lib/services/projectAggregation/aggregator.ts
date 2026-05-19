// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectAggregation/aggregator.ts
//  Phase MI-6 — Project aggregation service primitives.
//
//  Exports the seven capabilities the MI-6 spec demands:
//    createProjectAggregate
//    attachSignalToProject
//    scoreProjectSimilarity      (re-exported from similarity.ts)
//    detectProjectContinuation
//    updateProjectProbability
//    inferRelatedEntities        (in inference.ts)
//    inferRelatedParcels         (in inference.ts)
//
//  Deterministic-first throughout. AMBIGUOUS scores defer to operator
//  review; nothing auto-merges. No LLM calls. No black-box clustering.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import {
  type AggregatorActorContext,
  type ContinuationDecision,
  type LifecycleState,
  type ProjectContext,
  type ProjectEntityRole,
  type SignalInput,
  type SimilarityResult,
  PROJECT_ENTITY_ROLES,
  AGGREGATOR_VERSION,
  SCORE_THRESHOLDS,
} from "./types";
import { scoreAgainstCandidates, scoreProjectSimilarity } from "./similarity";
import { canTransition } from "./lifecycle";
import { recordSignalAttached, recordTimelineEvent } from "./timeline";
import { emitAggregatorAudit } from "./audit";

export { scoreProjectSimilarity } from "./similarity";

// ── createProjectAggregate ───────────────────────────────────────────────────

interface CreateProjectInput {
  workingTitle: string;
  jurisdiction?: string | null;
  source: string;
  initialSignal?: SignalInput;
  actor?: AggregatorActorContext;
}

export async function createProjectAggregate(
  input: CreateProjectInput
): Promise<{ projectId: string }> {
  const now = input.initialSignal?.occurredAt ?? new Date();
  const project = await prisma.project.create({
    data: {
      workingTitle: input.workingTitle.trim(),
      jurisdiction: input.jurisdiction ?? input.initialSignal?.jurisdiction ?? null,
      lifecycleState: "EMERGING",
      confidence: "LOW",
      reviewStatus: "AUTO_AGGREGATED",
      source: input.source,
      firstSignalAt: input.initialSignal ? now : null,
      lastSignalAt: input.initialSignal ? now : null,
    },
  });

  await recordTimelineEvent({
    projectId: project.id,
    eventType: "STATE_TRANSITION",
    occurredAt: project.createdAt,
    summary: `Project created (state EMERGING, source=${input.source})`,
    actorUserId: input.actor?.userId ?? null,
    actorEmail: input.actor?.email ?? null,
  });

  if (input.initialSignal) {
    await attachSignalToProject({
      projectId: project.id,
      signal: input.initialSignal,
      attachReason: "initial_signal",
      attachScore: 1.0,
      actor: input.actor,
    });
  }

  emitAggregatorAudit({
    action: "createProjectAggregate",
    projectId: project.id,
    actorUserId: input.actor?.userId ?? null,
    actorEmail: input.actor?.email ?? null,
  });

  return { projectId: project.id };
}

// ── attachSignalToProject ────────────────────────────────────────────────────

interface AttachSignalInput {
  projectId: string;
  signal: SignalInput;
  attachReason: string;
  attachScore: number;
  factors?: Record<string, number>;
  actor?: AggregatorActorContext;
}

export async function attachSignalToProject(
  input: AttachSignalInput
): Promise<{ projectSignalId: string }> {
  const sourcePointer = pickSourcePointer(input.signal);

  // Idempotency: skip if this exact (projectId, source) pair already attached
  if (sourcePointer.column && sourcePointer.value) {
    const existing = await prisma.projectSignal.findFirst({
      where: {
        projectId: input.projectId,
        [sourcePointer.column]: sourcePointer.value,
        detachedAt: null,
      },
    });
    if (existing) {
      return { projectSignalId: existing.id };
    }
  }

  const confidence = scoreToConfidence(input.attachScore);

  const ps = await prisma.projectSignal.create({
    data: {
      projectId: input.projectId,
      signalKind: input.signal.kind,
      sourceMarketSignalId: sourcePointer.column === "sourceMarketSignalId" ? sourcePointer.value : null,
      sourceRelationshipEdgeId: sourcePointer.column === "sourceRelationshipEdgeId" ? sourcePointer.value : null,
      sourceMarketLeadId: sourcePointer.column === "sourceMarketLeadId" ? sourcePointer.value : null,
      sourceMarketSourceDocId: sourcePointer.column === "sourceMarketSourceDocId" ? sourcePointer.value : null,
      sourceExternalRef: sourcePointer.column === "sourceExternalRef" ? sourcePointer.value : null,
      attachReason: input.attachReason,
      attachScore: input.attachScore,
      attachConfidence: confidence,
      factorJson: input.factors ? JSON.stringify(input.factors) : null,
    },
  });

  // Update project temporal anchors
  await prisma.project.update({
    where: { id: input.projectId },
    data: {
      lastSignalAt: input.signal.occurredAt,
      firstSignalAt: { /* set only if currently null */ } as never,
    },
  }).catch(() => {
    // Prisma can't do conditional updates inline; do a fallback if firstSignalAt was null.
  });
  // Conditional firstSignalAt — separate query to keep behavior explicit.
  const proj = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (proj && !proj.firstSignalAt) {
    await prisma.project.update({
      where: { id: input.projectId },
      data: { firstSignalAt: input.signal.occurredAt },
    });
  }

  await recordSignalAttached({
    projectId: input.projectId,
    signalKind: input.signal.kind,
    sourceId: input.signal.sourceId,
    attachReason: input.attachReason,
    attachScore: input.attachScore,
    occurredAt: input.signal.occurredAt,
  });

  emitAggregatorAudit({
    action: "attachSignalToProject",
    projectId: input.projectId,
    score: input.attachScore,
    reasonLog: [input.attachReason],
    factors: input.factors,
    actorUserId: input.actor?.userId ?? null,
    actorEmail: input.actor?.email ?? null,
  });

  return { projectSignalId: ps.id };
}

function pickSourcePointer(signal: SignalInput): { column: string | null; value: string | null } {
  if (!signal.sourceId) return { column: null, value: null };
  switch (signal.kind) {
    case "MARKET_SIGNAL":      return { column: "sourceMarketSignalId", value: signal.sourceId };
    case "RELATIONSHIP_EDGE":  return { column: "sourceRelationshipEdgeId", value: signal.sourceId };
    case "MARKET_LEAD":        return { column: "sourceMarketLeadId", value: signal.sourceId };
    case "SOURCE_DOC":         return { column: "sourceMarketSourceDocId", value: signal.sourceId };
    case "EXTERNAL":           return { column: "sourceExternalRef", value: signal.sourceId };
    case "MANUAL":             return { column: null, value: null };
  }
}

function scoreToConfidence(score: number): string {
  if (score >= 0.9) return "VERIFIED";
  if (score >= 0.75) return "HIGH";
  if (score >= 0.5) return "MEDIUM";
  return "LOW";
}

// ── detectProjectContinuation ────────────────────────────────────────────────
//
// Given a new signal + a candidate pool, score against each and emit a
// decision. Caller (future MI-6 PR2 backfill / MI-7 ingestion) decides
// whether to auto-attach (score ≥ ATTACH_AUTO), defer to review
// (REVIEW ≤ score < ATTACH_AUTO), or create a new project (no candidate
// ≥ REVIEW).

interface ContinuationInput {
  signal: SignalInput;
  candidates: ProjectContext[];
  thresholdsOverride?: {
    attachAuto?: number;
    review?: number;
  };
}

export function detectProjectContinuation(input: ContinuationInput): ContinuationDecision {
  const thresholds = {
    attachAuto: input.thresholdsOverride?.attachAuto ?? SCORE_THRESHOLDS.ATTACH_AUTO,
    review: input.thresholdsOverride?.review ?? SCORE_THRESHOLDS.REVIEW,
  };

  if (input.candidates.length === 0) {
    return { kind: "create_new", reason: "no candidate projects to compare against" };
  }

  const ranked = scoreAgainstCandidates(input.signal, input.candidates);
  const best = ranked[0];

  if (best.score >= thresholds.attachAuto) {
    return {
      kind: "attach_to_existing",
      project: best,
      reason: `composite score ${best.score.toFixed(3)} ≥ ATTACH_AUTO ${thresholds.attachAuto}`,
    };
  }

  if (best.score >= thresholds.review) {
    // Surface all candidates in the review band so the operator can pick.
    const reviewable = ranked.filter((r) => r.score >= thresholds.review);
    return {
      kind: "needs_review",
      candidates: reviewable,
      reason:
        `best score ${best.score.toFixed(3)} falls in review band ` +
        `[${thresholds.review}, ${thresholds.attachAuto}); ${reviewable.length} candidate(s)`,
    };
  }

  return {
    kind: "create_new",
    reason: `best score ${best.score.toFixed(3)} below review threshold ${thresholds.review}`,
  };
}

// ── updateProjectProbability ─────────────────────────────────────────────────
//
// Compute and persist a ProjectProbabilitySnapshot from the project's current
// state. Deterministic — same inputs → same probability. Factors:
//   - signalCount             contributes up to +0.30 (saturates at ~10)
//   - distinct entity roles   contributes up to +0.20 (saturates at 4)
//   - parcel attached         flat +0.15
//   - jurisdiction set        flat +0.05
//   - lifecycleState bias     varies (EMERGING:0, EARLY:.05, PRE_ENT:.15,
//                                     ENT:.30, SITE:.45, PRE_CON:.60,
//                                     ACTIVE:.85, COMPLETED:1.0, STALLED:.30,
//                                     ABANDONED:.0)

interface UpdateProbabilityInput {
  projectId: string;
  reason?: string;
  actor?: AggregatorActorContext;
}

const STATE_BIAS: Record<LifecycleState, number> = {
  EMERGING: 0.0,
  EARLY_SIGNAL: 0.05,
  PRE_ENTITLEMENT: 0.15,
  ENTITLEMENT: 0.3,
  SITE_PREP: 0.45,
  PRE_CONSTRUCTION: 0.6,
  ACTIVE_CONSTRUCTION: 0.85,
  STALLED: 0.3,
  ABANDONED: 0.0,
  COMPLETED: 1.0,
};

export async function updateProjectProbability(
  input: UpdateProbabilityInput
): Promise<{ probability: number; snapshotId: string }> {
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new Error(`Project ${input.projectId} not found`);

  const [signalCount, entityRoleCount, parcelCount] = await Promise.all([
    prisma.projectSignal.count({
      where: { projectId: input.projectId, detachedAt: null },
    }),
    prisma.projectEntity.groupBy({
      by: ["role"],
      where: { projectId: input.projectId, removed: false },
    }).then((rows) => rows.length),
    prisma.projectParcel.count({ where: { projectId: input.projectId } }),
  ]);

  const lifecycle = project.lifecycleState as LifecycleState;
  const stateBias = STATE_BIAS[lifecycle] ?? 0;

  const signalContribution = Math.min(0.3, 0.03 * signalCount);
  const entityContribution = Math.min(0.2, 0.05 * entityRoleCount);
  const parcelContribution = parcelCount > 0 ? 0.15 : 0;
  const jurisdictionContribution = project.jurisdiction ? 0.05 : 0;

  const raw = stateBias + signalContribution + entityContribution + parcelContribution + jurisdictionContribution;
  const probability = Math.max(0, Math.min(1, raw));

  const factors = {
    stateBias,
    signalContribution,
    entityContribution,
    parcelContribution,
    jurisdictionContribution,
    signalCount,
    entityRoleCount,
    parcelCount,
    lifecycleState: lifecycle,
    aggregatorVersion: AGGREGATOR_VERSION,
  };

  const snapshot = await prisma.projectProbabilitySnapshot.create({
    data: {
      projectId: input.projectId,
      probability,
      lifecycleState: lifecycle,
      factorsJson: JSON.stringify(factors),
      reason: input.reason ?? null,
      actorUserId: input.actor?.userId ?? null,
      actorEmail: input.actor?.email ?? null,
    },
  });

  await prisma.project.update({
    where: { id: input.projectId },
    data: { emergenceProbability: probability },
  });

  await recordTimelineEvent({
    projectId: input.projectId,
    eventType: "PROBABILITY_UPDATE",
    occurredAt: snapshot.computedAt,
    summary: `Probability updated to ${(probability * 100).toFixed(1)}%`,
    payload: factors,
    actorUserId: input.actor?.userId ?? null,
    actorEmail: input.actor?.email ?? null,
  });

  emitAggregatorAudit({
    action: "updateProjectProbability",
    projectId: input.projectId,
    score: probability,
    factors,
    actorUserId: input.actor?.userId ?? null,
    actorEmail: input.actor?.email ?? null,
  });

  return { probability, snapshotId: snapshot.id };
}

// ── transitionState ──────────────────────────────────────────────────────────
//
// Operator + automated entry point for moving a project through the
// lifecycle. Validates via lifecycle.canTransition. Records both a
// ProjectStateTransition row AND a ProjectTimelineEvent.

interface TransitionStateInput {
  projectId: string;
  toState: LifecycleState;
  reason: string;
  triggerSignalKind?: string | null;
  triggerSignalId?: string | null;
  actor?: AggregatorActorContext;
  /** When true, bypasses canTransition validation (operator override). */
  override?: boolean;
}

export async function transitionState(
  input: TransitionStateInput
): Promise<{ transitioned: boolean; reason: string; fromState: LifecycleState }> {
  const project = await prisma.project.findUnique({ where: { id: input.projectId } });
  if (!project) throw new Error(`Project ${input.projectId} not found`);

  const fromState = project.lifecycleState as LifecycleState;

  if (!input.override) {
    const check = canTransition(fromState, input.toState);
    if (!check.ok) {
      return { transitioned: false, reason: check.reason, fromState };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectStateTransition.create({
      data: {
        projectId: input.projectId,
        fromState,
        toState: input.toState,
        reason: input.reason,
        triggerSignalRefKind: input.triggerSignalKind ?? null,
        triggerSignalRefId: input.triggerSignalId ?? null,
        actorUserId: input.actor?.userId ?? null,
        actorEmail: input.actor?.email ?? null,
      },
    });
    await tx.project.update({
      where: { id: input.projectId },
      data: { lifecycleState: input.toState },
    });
    await tx.projectTimelineEvent.create({
      data: {
        projectId: input.projectId,
        eventType: "STATE_TRANSITION",
        occurredAt: new Date(),
        summary: `${fromState} → ${input.toState} (${input.reason})`,
        payloadJson: JSON.stringify({ fromState, toState: input.toState, reason: input.reason }),
        actorUserId: input.actor?.userId ?? null,
        actorEmail: input.actor?.email ?? null,
      },
    });
  });

  emitAggregatorAudit({
    action: "transitionState",
    projectId: input.projectId,
    decision: `${fromState} → ${input.toState}`,
    reasonLog: [input.reason],
    actorUserId: input.actor?.userId ?? null,
    actorEmail: input.actor?.email ?? null,
  });

  return { transitioned: true, reason: input.reason, fromState };
}

// ── attachEntityToProject ────────────────────────────────────────────────────

interface AttachEntityInput {
  projectId: string;
  entityId: string;
  role: ProjectEntityRole;
  attachReason: string;
  confidence?: string;
  observedAt?: Date;
  actor?: AggregatorActorContext;
}

export async function attachEntityToProject(
  input: AttachEntityInput
): Promise<{ projectEntityId: string }> {
  if (!PROJECT_ENTITY_ROLES.includes(input.role)) {
    throw new Error(`Invalid role: ${input.role}`);
  }
  const observed = input.observedAt ?? new Date();
  // Idempotent on (projectId, entityId, role)
  const existing = await prisma.projectEntity.findFirst({
    where: { projectId: input.projectId, entityId: input.entityId, role: input.role },
  });
  if (existing) {
    if (existing.removed) {
      await prisma.projectEntity.update({
        where: { id: existing.id },
        data: { removed: false, removedReason: null, removedBy: null, lastSeenAt: observed },
      });
    } else {
      await prisma.projectEntity.update({
        where: { id: existing.id },
        data: { lastSeenAt: observed },
      });
    }
    return { projectEntityId: existing.id };
  }
  const pe = await prisma.projectEntity.create({
    data: {
      projectId: input.projectId,
      entityId: input.entityId,
      role: input.role,
      attachReason: input.attachReason,
      confidence: input.confidence ?? "MEDIUM",
      firstSeenAt: observed,
      lastSeenAt: observed,
    },
  });
  await recordTimelineEvent({
    projectId: input.projectId,
    eventType: "ENTITY_ATTACHED",
    occurredAt: observed,
    summary: `Entity ${input.entityId} attached as ${input.role}`,
    sourceRefKind: "ENTITY",
    sourceRefId: input.entityId,
    payload: { role: input.role, attachReason: input.attachReason },
    actorUserId: input.actor?.userId ?? null,
    actorEmail: input.actor?.email ?? null,
  });
  return { projectEntityId: pe.id };
}

// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/liveIngestion/processSignal.ts
//  Phase MI-5 — Core: process a freshly-created MarketSignal /
//  RelationshipEdge / MarketLead through the resolver + aggregator.
//
//  Pattern matches MI-6 PR2 execute.ts but operates per-row rather than
//  in batches. Each call:
//    1. Loads the source row (returns "skipped" if not found).
//    2. (RelationshipEdge only) Resolves entities via MI-2 resolver and
//       writes the entity FKs + resolverVersion + resolverConfidence onto
//       the row.
//    3. Idempotency check: if a non-detached ProjectSignal for this
//       (sourceId, sourceKind) already exists, returns "already_processed".
//    4. Converts the row to a SignalInput via MI-6 PR2 signalSources.
//    5. Filters candidate Projects + builds ProjectContexts.
//    6. Calls detectProjectContinuation.
//    7. Applies the decision:
//         create_new          → createProjectAggregate(source="ingestion") + attach
//         attach_to_existing  → attachSignalToProject with score + factors
//         needs_review        → createProjectAggregate at PENDING_REVIEW with
//                              candidate list captured in TimelineEvent payload
//    8. Updates emergence probability (writes a snapshot).
//    9. Emits a single-line JSON audit + returns a structured IngestionResult.
//
//  Deterministic-first throughout. Same governance posture as MI-6 PR2 —
//  no auto-merge, no opaque inference, no destructive mutation.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import {
  resolveEntity,
  RESOLVER_VERSION,
  type EntityType,
} from "@/lib/services/entityResolver";
import {
  attachSignalToProject,
  createProjectAggregate,
  detectProjectContinuation,
  recordTimelineEvent,
  updateProjectProbability,
  AGGREGATOR_VERSION,
  type ContinuationDecision,
  type SignalInput,
} from "@/lib/services/projectAggregation";
import {
  buildProjectContext,
  fetchCandidateProjectIds,
  marketLeadToSignalInput,
  marketSignalToSignalInput,
  relationshipEdgeToSignalInput,
} from "@/lib/services/projectBackfill";
import { emitIngestionAudit } from "./audit";
import {
  INGESTION_VERSION,
  type IngestionAuditEntry,
  type IngestionProcessOptions,
  type IngestionResult,
  type IngestionSourceKind,
} from "./types";

// ── Shared decision applicator ───────────────────────────────────────────────

interface ApplyArgs {
  decision: ContinuationDecision;
  signal: SignalInput;
  sourceKind: IngestionSourceKind;
  sourceId: string;
  actor?: IngestionProcessOptions["actor"];
}

async function applyDecision(args: ApplyArgs): Promise<{
  projectId: string | null;
  projectSignalId: string | null;
  createdNewProject: boolean;
  attachScore: number | null;
  reason: string;
}> {
  const { decision, signal, sourceKind, sourceId, actor } = args;

  if (decision.kind === "create_new") {
    const { projectId } = await createProjectAggregate({
      workingTitle: signal.title?.trim() || titleFallback(signal),
      jurisdiction: signal.jurisdiction,
      source: `ingestion_${sourceKind.toLowerCase()}`,
      initialSignal: signal,
      actor: actor ? { userId: actor.userId, email: actor.email } : undefined,
    });
    return {
      projectId,
      projectSignalId: null,
      createdNewProject: true,
      attachScore: 1.0,
      reason: decision.reason,
    };
  }

  if (decision.kind === "attach_to_existing") {
    const ps = await attachSignalToProject({
      projectId: decision.project.candidateProjectId,
      signal,
      attachReason: decision.project.reasonLog.join(" + ") || decision.reason,
      attachScore: decision.project.score,
      factors: factorsToRecord(decision.project.factors),
      actor: actor ? { userId: actor.userId, email: actor.email } : undefined,
    });
    return {
      projectId: decision.project.candidateProjectId,
      projectSignalId: ps.projectSignalId,
      createdNewProject: false,
      attachScore: decision.project.score,
      reason: decision.reason,
    };
  }

  // needs_review: create a NEW project at PENDING_REVIEW with the candidate
  // list captured in a timeline event. Never auto-merge ambiguous projects.
  const candidates = decision.candidates;
  const { projectId } = await createProjectAggregate({
    workingTitle: signal.title?.trim() || titleFallback(signal),
    jurisdiction: signal.jurisdiction,
    source: `ingestion_${sourceKind.toLowerCase()}_pending`,
    initialSignal: signal,
    actor: actor ? { userId: actor.userId, email: actor.email } : undefined,
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
      `Live-ingestion created at PENDING_REVIEW with ${candidates.length} candidate(s) ` +
      `(best score ${candidates[0]?.score.toFixed(3) ?? "n/a"})`,
    payload: {
      reason: decision.reason,
      sourceKind,
      sourceId,
      candidates: candidates.map((c) => ({
        projectId: c.candidateProjectId,
        score: c.score,
        reasons: c.reasonLog,
      })),
    },
    actorUserId: actor?.userId ?? null,
    actorEmail: actor?.email ?? null,
  });
  return {
    projectId,
    projectSignalId: null,
    createdNewProject: true,
    attachScore: candidates[0]?.score ?? null,
    reason: decision.reason,
  };
}

function factorsToRecord(factors: object): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(factors)) {
    if (typeof v === "number") out[k] = Number(v.toFixed(4));
  }
  return out;
}

function titleFallback(signal: SignalInput): string {
  if (signal.address) return signal.address.slice(0, 120);
  if (signal.jurisdiction) return `${signal.jurisdiction} project (${signal.kind})`;
  return `Untitled ${signal.kind} ${signal.occurredAt.toISOString().slice(0, 10)}`;
}

// ── Idempotency check ────────────────────────────────────────────────────────

async function alreadyAttached(sourceKind: IngestionSourceKind, sourceId: string): Promise<string | null> {
  const where =
    sourceKind === "MARKET_SIGNAL"
      ? { sourceMarketSignalId: sourceId, detachedAt: null }
      : sourceKind === "RELATIONSHIP_EDGE"
        ? { sourceRelationshipEdgeId: sourceId, detachedAt: null }
        : { sourceMarketLeadId: sourceId, detachedAt: null };
  const hit = await prisma.projectSignal.findFirst({ where, select: { id: true } });
  return hit?.id ?? null;
}

// ── Result + audit builder ───────────────────────────────────────────────────

function buildResult(args: {
  ok: boolean;
  sourceKind: IngestionSourceKind;
  sourceId: string;
  decision: IngestionAuditEntry["decision"];
  projectId: string | null;
  projectSignalId: string | null;
  createdNewProject: boolean;
  attachScore: number | null;
  reason: string;
  actor?: IngestionProcessOptions["actor"];
  error?: string;
}): IngestionResult {
  const audit: IngestionAuditEntry = {
    timestamp: new Date().toISOString(),
    sourceKind: args.sourceKind,
    sourceId: args.sourceId,
    decision: args.decision,
    projectId: args.projectId,
    attachScore: args.attachScore,
    reason: args.reason,
    ingestionVersion: INGESTION_VERSION,
    resolverVersion: RESOLVER_VERSION,
    aggregatorVersion: AGGREGATOR_VERSION,
    actorUserId: args.actor?.userId ?? null,
    actorEmail: args.actor?.email ?? null,
  };
  emitIngestionAudit(audit);
  return {
    ok: args.ok,
    sourceKind: args.sourceKind,
    sourceId: args.sourceId,
    decision: args.decision,
    projectId: args.projectId,
    projectSignalId: args.projectSignalId,
    createdNewProject: args.createdNewProject,
    audit,
    ...(args.error ? { error: args.error } : {}),
  };
}

// ── Score signal against project graph ───────────────────────────────────────

async function scoreAndDecide(
  signal: SignalInput,
  opts: IngestionProcessOptions
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

// ── Type-normalization (matches MI-6 PR2 execute.ts) ────────────────────────

const TYPE_MAP: Record<string, EntityType> = {
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

function normalizeEntityType(raw: string): EntityType {
  if (!raw) return "Unknown";
  return TYPE_MAP[raw.toUpperCase().trim()] ?? "Unknown";
}

// ── Public entry points ──────────────────────────────────────────────────────

/**
 * Process a freshly-created RelationshipEdge. Resolves both entity names
 * via the MI-2 resolver, writes resolver attribution onto the row, then
 * routes the edge through the project aggregator.
 */
export async function processNewRelationshipEdge(
  edgeId: string,
  opts: IngestionProcessOptions = {}
): Promise<IngestionResult> {
  const edge = await prisma.relationshipEdge.findUnique({ where: { id: edgeId } });
  if (!edge) {
    return buildResult({
      ok: false,
      sourceKind: "RELATIONSHIP_EDGE",
      sourceId: edgeId,
      decision: "skipped",
      projectId: null,
      projectSignalId: null,
      createdNewProject: false,
      attachScore: null,
      reason: "edge not found",
      error: "RelationshipEdge not found",
      actor: opts.actor,
    });
  }

  const skipIfAttached = opts.skipIfAttached !== false;
  if (skipIfAttached) {
    const existing = await alreadyAttached("RELATIONSHIP_EDGE", edgeId);
    if (existing) {
      return buildResult({
        ok: true,
        sourceKind: "RELATIONSHIP_EDGE",
        sourceId: edgeId,
        decision: "already_processed",
        projectId: null,
        projectSignalId: existing,
        createdNewProject: false,
        attachScore: null,
        reason: `existing ProjectSignal ${existing}`,
        actor: opts.actor,
      });
    }
  }

  // Resolve entities if FKs aren't already populated. We respect operator
  // overrides: if fromEntityId/toEntityId is set already, we don't re-resolve.
  let fromEntityId = edge.fromEntityId;
  let toEntityId = edge.toEntityId;
  let resolverConfidence = edge.resolverConfidence;
  let resolverVersion = edge.resolverVersion;
  if (!fromEntityId || !toEntityId || !resolverVersion) {
    const fromType = normalizeEntityType(edge.fromType);
    const toType = normalizeEntityType(edge.toType);
    const [fromResult, toResult] = await Promise.all([
      fromEntityId ? null : resolveEntity(edge.fromName, fromType, { source: "ingestion_edge", create: true }),
      toEntityId ? null : resolveEntity(edge.toName, toType, { source: "ingestion_edge", create: true }),
    ]);
    if (fromResult?.entity) fromEntityId = fromResult.entity.id;
    if (toResult?.entity) toEntityId = toResult.entity.id;
    resolverConfidence = combineConfidence(
      fromResult?.match.confidence ?? edge.resolverConfidence ?? "NONE",
      toResult?.match.confidence ?? edge.resolverConfidence ?? "NONE"
    );
    resolverVersion = RESOLVER_VERSION;
    await prisma.relationshipEdge.update({
      where: { id: edgeId },
      data: { fromEntityId, toEntityId, resolverVersion, resolverConfidence },
    });
  }

  const refreshed = await prisma.relationshipEdge.findUnique({ where: { id: edgeId } });
  if (!refreshed) {
    return buildResult({
      ok: false,
      sourceKind: "RELATIONSHIP_EDGE",
      sourceId: edgeId,
      decision: "skipped",
      projectId: null,
      projectSignalId: null,
      createdNewProject: false,
      attachScore: null,
      reason: "edge vanished during processing",
      error: "RelationshipEdge vanished during processing",
      actor: opts.actor,
    });
  }
  const signal = relationshipEdgeToSignalInput(refreshed);
  const decision = await scoreAndDecide(signal, opts);
  const applied = await applyDecision({
    decision,
    signal,
    sourceKind: "RELATIONSHIP_EDGE",
    sourceId: edgeId,
    actor: opts.actor,
  });

  if (applied.projectId && !opts.skipProbability) {
    try {
      await updateProjectProbability({ projectId: applied.projectId, reason: "ingestion_accretion" });
    } catch (err) {
      console.warn("[live-ingestion] probability update failed:", err);
    }
  }

  return buildResult({
    ok: true,
    sourceKind: "RELATIONSHIP_EDGE",
    sourceId: edgeId,
    decision: decision.kind,
    projectId: applied.projectId,
    projectSignalId: applied.projectSignalId,
    createdNewProject: applied.createdNewProject,
    attachScore: applied.attachScore,
    reason: applied.reason,
    actor: opts.actor,
  });
}

/** Process a freshly-created MarketLead. No entity resolution (leads
 *  don't carry structured entity references); pure project-aggregator
 *  routing.
 */
export async function processNewMarketLead(
  leadId: string,
  opts: IngestionProcessOptions = {}
): Promise<IngestionResult> {
  const lead = await prisma.marketLead.findUnique({ where: { id: leadId } });
  if (!lead) {
    return buildResult({
      ok: false,
      sourceKind: "MARKET_LEAD",
      sourceId: leadId,
      decision: "skipped",
      projectId: null,
      projectSignalId: null,
      createdNewProject: false,
      attachScore: null,
      reason: "lead not found",
      error: "MarketLead not found",
      actor: opts.actor,
    });
  }
  const skipIfAttached = opts.skipIfAttached !== false;
  if (skipIfAttached) {
    const existing = await alreadyAttached("MARKET_LEAD", leadId);
    if (existing) {
      return buildResult({
        ok: true,
        sourceKind: "MARKET_LEAD",
        sourceId: leadId,
        decision: "already_processed",
        projectId: null,
        projectSignalId: existing,
        createdNewProject: false,
        attachScore: null,
        reason: `existing ProjectSignal ${existing}`,
        actor: opts.actor,
      });
    }
  }

  const signal = marketLeadToSignalInput(lead);
  const decision = await scoreAndDecide(signal, opts);
  const applied = await applyDecision({
    decision,
    signal,
    sourceKind: "MARKET_LEAD",
    sourceId: leadId,
    actor: opts.actor,
  });

  if (applied.projectId && !opts.skipProbability) {
    try {
      await updateProjectProbability({ projectId: applied.projectId, reason: "ingestion_accretion" });
    } catch (err) {
      console.warn("[live-ingestion] probability update failed:", err);
    }
  }

  return buildResult({
    ok: true,
    sourceKind: "MARKET_LEAD",
    sourceId: leadId,
    decision: decision.kind,
    projectId: applied.projectId,
    projectSignalId: applied.projectSignalId,
    createdNewProject: applied.createdNewProject,
    attachScore: applied.attachScore,
    reason: applied.reason,
    actor: opts.actor,
  });
}

/** Process a freshly-created MarketSignal. Routes through the project
 *  aggregator using headline + signal-type tag extraction (MI-6 PR2
 *  conservative pattern). Entity extraction from free-text headlines is
 *  deferred to a future phase.
 */
export async function processNewMarketSignal(
  signalRowId: string,
  opts: IngestionProcessOptions = {}
): Promise<IngestionResult> {
  const row = await prisma.marketSignal.findUnique({
    where: { id: signalRowId },
    select: {
      id: true,
      headline: true,
      signalType: true,
      signalSubtype: true,
      sourceDate: true,
      metadata: true,
      createdAt: true,
      lead: { select: { jurisdiction: true } },
      sourceDoc: { select: { jurisdiction: true } },
    },
  });
  if (!row) {
    return buildResult({
      ok: false,
      sourceKind: "MARKET_SIGNAL",
      sourceId: signalRowId,
      decision: "skipped",
      projectId: null,
      projectSignalId: null,
      createdNewProject: false,
      attachScore: null,
      reason: "signal not found",
      error: "MarketSignal not found",
      actor: opts.actor,
    });
  }
  const skipIfAttached = opts.skipIfAttached !== false;
  if (skipIfAttached) {
    const existing = await alreadyAttached("MARKET_SIGNAL", signalRowId);
    if (existing) {
      return buildResult({
        ok: true,
        sourceKind: "MARKET_SIGNAL",
        sourceId: signalRowId,
        decision: "already_processed",
        projectId: null,
        projectSignalId: existing,
        createdNewProject: false,
        attachScore: null,
        reason: `existing ProjectSignal ${existing}`,
        actor: opts.actor,
      });
    }
  }

  const signal = marketSignalToSignalInput({
    id: row.id,
    headline: row.headline,
    signalType: row.signalType,
    signalSubtype: row.signalSubtype,
    sourceDate: row.sourceDate,
    metadata: row.metadata,
    createdAt: row.createdAt,
    leadJurisdiction: row.lead?.jurisdiction ?? null,
    sourceDocJurisdiction: row.sourceDoc?.jurisdiction ?? null,
  });
  const decision = await scoreAndDecide(signal, opts);
  const applied = await applyDecision({
    decision,
    signal,
    sourceKind: "MARKET_SIGNAL",
    sourceId: signalRowId,
    actor: opts.actor,
  });

  if (applied.projectId && !opts.skipProbability) {
    try {
      await updateProjectProbability({ projectId: applied.projectId, reason: "ingestion_accretion" });
    } catch (err) {
      console.warn("[live-ingestion] probability update failed:", err);
    }
  }

  return buildResult({
    ok: true,
    sourceKind: "MARKET_SIGNAL",
    sourceId: signalRowId,
    decision: decision.kind,
    projectId: applied.projectId,
    projectSignalId: applied.projectSignalId,
    createdNewProject: applied.createdNewProject,
    attachScore: applied.attachScore,
    reason: applied.reason,
    actor: opts.actor,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function combineConfidence(a: string, b: string): string {
  const order = ["NONE", "LOW", "MEDIUM", "HIGH", "VERIFIED"];
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia < 0 || ib < 0) return "NONE";
  return order[Math.min(ia, ib)];
}

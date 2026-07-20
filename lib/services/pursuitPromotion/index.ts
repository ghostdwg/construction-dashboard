// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/pursuitPromotion/index.ts
//  Market Intelligence → Pursuit promotion — the canonical service.
//
//  This is the ONLY writer of the market→pursuit lifecycle link. The API route
//  is a thin shell over previewPromotion() / promoteToPursuit(); the UI never
//  touches Prisma.
//
//  ── PROVENANCE REPRESENTATION (no migration this sprint) ────────────────────
//
//  LEAD    → real FK. MarketLead.promotedToBidId / promotedAt already exist in
//            schema.prisma with `promotedBid Bid? @relation(...)` and an index
//            on promotedToBidId. Reverse lookup uses Bid.marketLeads.
//
//  PROJECT → no FK column exists on Project. The strongest correct no-migration
//            representation is a ProjectTimelineEvent row:
//                eventType     = "PROMOTED_TO_PURSUIT"
//                sourceRefKind = "BID"
//                sourceRefId   = String(bidId)
//            ProjectTimelineEvent is already the project's canonical history
//            surface (projectGovernance writes every operator action there) and
//            it carries an @@index([sourceRefId]), so Bid → Project reverse
//            lookup is indexed, not a table scan.
//
//  PROVENANCE_FUTURE_SCHEMA — deferred, requires a migration card:
//    · Project.promotedToBidId Int? + relation, mirroring MarketLead. Would let
//      the duplicate guard be a plain unique FK instead of the deterministic
//      primary key described below.
//    · Bid.estimatedValue Float? — the source's public estimated value has no
//      Bid column today, so it is surfaced in the preview as "stays on the
//      source" rather than silently dropped.
//    · Bid.sourceUrl String? — same reasoning for the public source URL.
//
//  ── DUPLICATE GUARD ─────────────────────────────────────────────────────────
//
//  Both guards are enforced by the DATABASE, not by a read-then-write race:
//
//  LEAD    → compare-and-swap: updateMany({ where: { id, promotedToBidId: null } }).
//            A loser sees count === 0.
//  PROJECT → deterministic primary key: the promotion's ProjectTimelineEvent id
//            is `promotion:<projectId>`, so a second concurrent create violates
//            the PK and throws. (ProjectTimelineEvent.id is a String with a
//            cuid() default — supplying it explicitly is legal and turns "one
//            promotion per project" into a real DB constraint with no migration.)
//
//  Either way the loser's transaction rolls back — including its Bid insert, so
//  a race can never leave an orphan draft — and the caller then re-reads and
//  receives the winner's bid with reused: true. Retries are idempotent.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/auth-helpers";
import {
  buildAuditEnvelope,
  emitAuditEnvelopeStdout,
  persistAuditEnvelope,
} from "@/lib/observability/audit";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";
import {
  leadSourceContext,
  mapLeadToDraft,
  mapProjectToDraft,
  notCarriedFields,
  projectSourceContext,
  type LeadMappingSource,
  type ProjectMappingSource,
} from "./mapping";
import type {
  PromotionActor,
  PromotionPreview,
  PromotionResult,
  PromotionSourceContext,
  PromotionSourceKind,
  PursuitDraftFields,
} from "./types";

// ── Eligibility ───────────────────────────────────────────────────────────────

/** MarketLead.status values a promotion may start from. */
export const PROMOTABLE_LEAD_STATUSES = ["NEW", "REVIEWING", "QUALIFIED", "PURSUING"] as const;

/** Project review/lifecycle states that BLOCK promotion. */
export const BLOCKING_PROJECT_REVIEW_STATUSES = ["REJECTED", "MERGED"] as const;
export const BLOCKING_PROJECT_LIFECYCLE_STATES = ["ABANDONED", "COMPLETED"] as const;

/** Terminal status written onto a MarketLead once promoted. */
export const PROMOTED_LEAD_STATUS = "PROMOTED";

export const PROMOTION_TIMELINE_EVENT_TYPE = "PROMOTED_TO_PURSUIT";
export const PROMOTION_TIMELINE_SOURCE_REF_KIND = "BID";

/** Deterministic ProjectTimelineEvent PK — this IS the project duplicate guard. */
export function projectPromotionEventId(projectId: string): string {
  return `promotion:${projectId}`;
}

export function isLeadStatusPromotable(status: string): boolean {
  return (PROMOTABLE_LEAD_STATUSES as readonly string[]).includes(status);
}

export function isProjectPromotable(project: {
  reviewStatus: string;
  lifecycleState: string;
}): boolean {
  return (
    !(BLOCKING_PROJECT_REVIEW_STATUSES as readonly string[]).includes(project.reviewStatus) &&
    !(BLOCKING_PROJECT_LIFECYCLE_STATES as readonly string[]).includes(project.lifecycleState)
  );
}

// ── Authorization ─────────────────────────────────────────────────────────────

/**
 * Promotion creates a draft pursuit, so it is a pursuit-phase action: admin or
 * estimator only. A PM owns awarded construction work and has no business
 * opening new pursuits. Mirrors canAccessPhase(user, "BID", "draft").
 */
export function canPromote(actor: { role: string }): boolean {
  return actor.role === ROLES.ADMIN || actor.role === ROLES.ESTIMATOR;
}

/** Bid-scope visibility, matching assertBidAccess semantics. */
function canSeeBid(actor: PromotionActor, bid: { createdById: string | null }): boolean {
  return actor.role === ROLES.ADMIN || bid.createdById === actor.id;
}

// ── Internal read shapes ──────────────────────────────────────────────────────

const LEAD_SELECT = {
  id: true,
  title: true,
  status: true,
  location: true,
  jurisdiction: true,
  projectType: true,
  estimatedValue: true,
  sourceUrl: true,
  sourceDocId: true,
  promotedToBidId: true,
} as const;

const PROJECT_SELECT = {
  id: true,
  workingTitle: true,
  jurisdiction: true,
  projectType: true,
  estimatedValue: true,
  estimatedSqft: true,
  source: true,
  reviewStatus: true,
  lifecycleState: true,
} as const;

type LeadRow = LeadMappingSource & { status: string; promotedToBidId: number | null };
type ProjectRow = ProjectMappingSource & { reviewStatus: string; lifecycleState: string };

/** Sentinel thrown inside a transaction when another writer won the guard. */
class PromotionRaceLost extends Error {
  constructor() {
    super("promotion-race-lost");
    this.name = "PromotionRaceLost";
  }
}

function isRaceLost(err: unknown): boolean {
  if (err instanceof PromotionRaceLost) return true;
  // Prisma unique-constraint violation from the deterministic timeline PK.
  const code = (err as { code?: string } | null)?.code;
  return code === "P2002";
}

// ── Existing-promotion lookup ─────────────────────────────────────────────────

async function findExistingBidId(
  kind: PromotionSourceKind,
  sourceId: string
): Promise<number | null> {
  if (kind === "LEAD") {
    const lead = await prisma.marketLead.findUnique({
      where: { id: sourceId },
      select: { promotedToBidId: true },
    });
    return lead?.promotedToBidId ?? null;
  }
  const event = await prisma.projectTimelineEvent.findUnique({
    where: { id: projectPromotionEventId(sourceId) },
    select: { sourceRefId: true },
  });
  if (!event?.sourceRefId) return null;
  const parsed = Number.parseInt(event.sourceRefId, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Resolve an existing promotion into a caller-visible outcome. Out-of-scope
 * pursuits are reported as already_promoted WITHOUT the bid id — the caller
 * learns the source is taken, never who owns it or what it is.
 */
async function resolveExisting(
  actor: PromotionActor,
  bidId: number
): Promise<{ visible: true; bidId: number } | { visible: false }> {
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true, createdById: true },
  });
  // A dangling pointer (bid hard-deleted) is treated as not-visible rather than
  // resurrected — the source stays promoted; an operator must intervene.
  if (!bid) return { visible: false };
  return canSeeBid(actor, bid) ? { visible: true, bidId: bid.id } : { visible: false };
}

// ── Preview ───────────────────────────────────────────────────────────────────

function emptyPreview(
  kind: PromotionSourceKind,
  sourceId: string
): PromotionPreview {
  const source: PromotionSourceContext = {
    sourceKind: kind,
    sourceId,
    sourceTitle: "",
    sourceUrl: null,
    sourceDocId: null,
    estimatedValue: null,
    jurisdiction: null,
  };
  return {
    eligible: false,
    reason: "not_found",
    existingBidId: null,
    promotedOutOfScope: false,
    draft: { projectName: "", location: null, buildingType: null, approxSqft: null },
    source,
    notCarried: [],
  };
}

/**
 * Server-authoritative preview of what a promotion would write. The UI renders
 * this rather than computing its own mapping, so the confirm dialog can never
 * disagree with what the service actually does.
 */
export async function previewPromotion(
  actor: PromotionActor,
  kind: PromotionSourceKind,
  sourceId: string
): Promise<PromotionPreview> {
  if (!canPromote(actor)) {
    return { ...emptyPreview(kind, sourceId), reason: "forbidden" };
  }

  let draft: PursuitDraftFields;
  let source: PromotionSourceContext;
  let statusEligible: boolean;
  let existingBidId: number | null;

  if (kind === "LEAD") {
    const lead = (await prisma.marketLead.findUnique({
      where: { id: sourceId },
      select: LEAD_SELECT,
    })) as LeadRow | null;
    if (!lead) return emptyPreview(kind, sourceId);
    draft = mapLeadToDraft(lead);
    source = leadSourceContext(lead);
    statusEligible = isLeadStatusPromotable(lead.status);
    existingBidId = lead.promotedToBidId;
  } else {
    const project = (await prisma.project.findUnique({
      where: { id: sourceId },
      select: PROJECT_SELECT,
    })) as ProjectRow | null;
    if (!project) return emptyPreview(kind, sourceId);
    draft = mapProjectToDraft(project);
    source = projectSourceContext(project);
    statusEligible = isProjectPromotable(project);
    existingBidId = await findExistingBidId("PROJECT", sourceId);
  }

  const notCarried = notCarriedFields(source);

  if (existingBidId != null) {
    const existing = await resolveExisting(actor, existingBidId);
    return {
      eligible: false,
      reason: "already_promoted",
      existingBidId: existing.visible ? existing.bidId : null,
      promotedOutOfScope: !existing.visible,
      draft,
      source,
      notCarried,
    };
  }

  return {
    eligible: statusEligible,
    reason: statusEligible ? null : "ineligible_status",
    existingBidId: null,
    promotedOutOfScope: false,
    draft,
    source,
    notCarried,
  };
}

// ── Audit ─────────────────────────────────────────────────────────────────────

/**
 * Build the promotion audit envelope. IDs, kinds and field NAMES only — never
 * source text, never mapped values beyond the pursuit's own title.
 */
function buildPromotionEnvelope(args: {
  actor: PromotionActor;
  source: PromotionSourceContext;
  bidId: number;
  reused: boolean;
}): AuditEnvelope {
  return buildAuditEnvelope({
    category: "pursuit_promotion",
    action: args.reused ? "promote_to_pursuit_reused" : "promote_to_pursuit",
    severity: "NOTICE",
    decision: args.reused ? "REUSED_EXISTING_PURSUIT" : "CREATED_DRAFT_PURSUIT",
    subject: { kind: args.source.sourceKind, id: args.source.sourceId },
    actor: { kind: "operator", userId: args.actor.id, email: args.actor.email ?? null },
    payload: {
      sourceKind: args.source.sourceKind,
      sourceId: args.source.sourceId,
      sourceDocId: args.source.sourceDocId,
      bidId: args.bidId,
      reused: args.reused,
      provenance:
        args.source.sourceKind === "LEAD"
          ? "MarketLead.promotedToBidId"
          : "ProjectTimelineEvent.PROMOTED_TO_PURSUIT",
      carriedFields: ["projectName", "location", "buildingType", "approxSqft"],
    },
  });
}

/** Reused-path audit. Persisted so retries are as reconstructable as creates. */
async function auditReuse(
  actor: PromotionActor,
  source: PromotionSourceContext,
  bidId: number
): Promise<void> {
  const envelope = buildPromotionEnvelope({ actor, source, bidId, reused: true });
  try {
    await persistAuditEnvelope(prisma, envelope);
  } finally {
    emitAuditEnvelopeStdout(envelope);
  }
}

// ── Promotion ─────────────────────────────────────────────────────────────────

/**
 * Promote a market source into exactly one draft pursuit.
 *
 * Idempotent: repeated calls (and concurrent losers) return the already-created
 * bid with reused: true instead of creating a second pursuit.
 */
export async function promoteToPursuit(
  actor: PromotionActor,
  kind: PromotionSourceKind,
  sourceId: string
): Promise<PromotionResult> {
  if (!canPromote(actor)) {
    return {
      ok: false,
      error: "forbidden",
      message: "Promoting to a pursuit requires the estimator or admin role.",
    };
  }
  if (typeof sourceId !== "string" || sourceId.trim().length === 0) {
    return { ok: false, error: "invalid_source_id", message: "sourceId is required." };
  }

  try {
    return kind === "LEAD"
      ? await promoteLead(actor, sourceId)
      : await promoteProject(actor, sourceId);
  } catch (err) {
    if (!isRaceLost(err)) throw err;
    // Another writer won. Our transaction (including its Bid insert) rolled
    // back; re-read and hand back the winner's pursuit.
    return afterRaceLost(actor, kind, sourceId);
  }
}

async function afterRaceLost(
  actor: PromotionActor,
  kind: PromotionSourceKind,
  sourceId: string
): Promise<PromotionResult> {
  const existingBidId = await findExistingBidId(kind, sourceId);
  if (existingBidId == null) {
    // Guard fired but no promotion is readable — refuse rather than retry into
    // a possible second create.
    return {
      ok: false,
      error: "internal_error",
      message: "Promotion conflicted but no existing pursuit could be read. Retry.",
    };
  }
  return duplicateOutcome(actor, kind, sourceId, existingBidId);
}

async function duplicateOutcome(
  actor: PromotionActor,
  kind: PromotionSourceKind,
  sourceId: string,
  existingBidId: number,
  source?: PromotionSourceContext
): Promise<PromotionResult> {
  const existing = await resolveExisting(actor, existingBidId);
  if (!existing.visible) {
    return {
      ok: false,
      error: "already_promoted",
      message: "This source has already been promoted to a pursuit you cannot access.",
    };
  }
  if (source) await auditReuse(actor, source, existing.bidId);
  return { ok: true, bidId: existing.bidId, reused: true, sourceKind: kind, sourceId };
}

function draftBidData(actor: PromotionActor, draft: PursuitDraftFields) {
  return {
    projectName: draft.projectName,
    location: draft.location,
    buildingType: draft.buildingType,
    approxSqft: draft.approxSqft,
    // Existing lifecycle convention (app/api/bids/route.ts): a pursuit starts
    // as a draft BID. Ownership is the caller — this is what scopes the new
    // pursuit for every downstream bid-scoped route.
    status: "draft",
    workflowType: "BID",
    createdById: actor.id,
  };
}

async function promoteLead(
  actor: PromotionActor,
  sourceId: string
): Promise<PromotionResult> {
  const lead = (await prisma.marketLead.findUnique({
    where: { id: sourceId },
    select: LEAD_SELECT,
  })) as LeadRow | null;
  if (!lead) {
    return { ok: false, error: "not_found", message: "Market lead not found." };
  }

  const source = leadSourceContext(lead);

  if (lead.promotedToBidId != null) {
    return duplicateOutcome(actor, "LEAD", sourceId, lead.promotedToBidId, source);
  }
  if (!isLeadStatusPromotable(lead.status)) {
    return {
      ok: false,
      error: "ineligible_status",
      message: `A lead with status ${lead.status} cannot be promoted.`,
      status: lead.status,
    };
  }

  const promotedAt = new Date();
  const { bidId, envelope } = await prisma.$transaction(async (tx) => {
    const bid = await tx.bid.create({
      data: draftBidData(actor, mapLeadToDraft(lead)),
      select: { id: true },
    });

    // Compare-and-swap: only the writer that sees promotedToBidId === null wins.
    const swapped = await tx.marketLead.updateMany({
      where: { id: sourceId, promotedToBidId: null },
      data: {
        promotedToBidId: bid.id,
        promotedAt,
        status: PROMOTED_LEAD_STATUS,
      },
    });
    if (swapped.count === 0) throw new PromotionRaceLost();

    // Fail-closed audit: a failed audit write rolls back the whole promotion.
    const env = buildPromotionEnvelope({ actor, source, bidId: bid.id, reused: false });
    await persistAuditEnvelope(tx, env);

    return { bidId: bid.id, envelope: env };
  });

  emitAuditEnvelopeStdout(envelope);
  return { ok: true, bidId, reused: false, sourceKind: "LEAD", sourceId };
}

async function promoteProject(
  actor: PromotionActor,
  sourceId: string
): Promise<PromotionResult> {
  const project = (await prisma.project.findUnique({
    where: { id: sourceId },
    select: PROJECT_SELECT,
  })) as ProjectRow | null;
  if (!project) {
    return { ok: false, error: "not_found", message: "Market project not found." };
  }

  const source = projectSourceContext(project);

  const existingBidId = await findExistingBidId("PROJECT", sourceId);
  if (existingBidId != null) {
    return duplicateOutcome(actor, "PROJECT", sourceId, existingBidId, source);
  }
  if (!isProjectPromotable(project)) {
    return {
      ok: false,
      error: "ineligible_status",
      message: `A project in ${project.reviewStatus}/${project.lifecycleState} cannot be promoted.`,
      status: `${project.reviewStatus}/${project.lifecycleState}`,
    };
  }

  const occurredAt = new Date();
  const { bidId, envelope } = await prisma.$transaction(async (tx) => {
    const bid = await tx.bid.create({
      data: draftBidData(actor, mapProjectToDraft(project)),
      select: { id: true },
    });

    // Deterministic PK — the DB-enforced duplicate guard. A concurrent loser
    // violates the primary key here and rolls back, bid insert included.
    await tx.projectTimelineEvent.create({
      data: {
        id: projectPromotionEventId(sourceId),
        projectId: sourceId,
        eventType: PROMOTION_TIMELINE_EVENT_TYPE,
        occurredAt,
        summary: `Promoted to pursuit #${bid.id}`,
        sourceRefKind: PROMOTION_TIMELINE_SOURCE_REF_KIND,
        sourceRefId: String(bid.id),
        actorUserId: actor.id,
        actorEmail: actor.email ?? null,
        payloadJson: JSON.stringify({
          bidId: bid.id,
          carriedFields: ["projectName", "location", "buildingType", "approxSqft"],
        }),
      },
    });

    const env = buildPromotionEnvelope({ actor, source, bidId: bid.id, reused: false });
    await persistAuditEnvelope(tx, env);

    return { bidId: bid.id, envelope: env };
  });

  emitAuditEnvelopeStdout(envelope);
  return { ok: true, bidId, reused: false, sourceKind: "PROJECT", sourceId };
}

// ── Reverse lookup (pursuit → origin) ─────────────────────────────────────────

export type PursuitOrigin = {
  sourceKind: PromotionSourceKind;
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string | null;
  sourceDocId: string | null;
  promotedAt: Date | null;
  actorUserId: string | null;
  actorEmail: string | null;
};

/**
 * Where did this pursuit come from? Returns null for pursuits created directly.
 *
 * Only public-source market facts cross back into the pursuit view, and nothing
 * bid-side is read into the market wing — the two surfaces stay mutually
 * understandable without either leaking into the other.
 */
export async function getPursuitOrigin(bidId: number): Promise<PursuitOrigin | null> {
  const lead = await prisma.marketLead.findFirst({
    where: { promotedToBidId: bidId },
    select: {
      id: true,
      title: true,
      sourceUrl: true,
      sourceDocId: true,
      promotedAt: true,
    },
  });
  if (lead) {
    const audit = await findPromotionActor("LEAD", lead.id);
    return {
      sourceKind: "LEAD",
      sourceId: lead.id,
      sourceTitle: lead.title,
      sourceUrl: lead.sourceUrl,
      sourceDocId: lead.sourceDocId,
      promotedAt: lead.promotedAt,
      actorUserId: audit?.actorUserId ?? null,
      actorEmail: audit?.actorEmail ?? null,
    };
  }

  const event = await prisma.projectTimelineEvent.findFirst({
    where: {
      eventType: PROMOTION_TIMELINE_EVENT_TYPE,
      sourceRefKind: PROMOTION_TIMELINE_SOURCE_REF_KIND,
      sourceRefId: String(bidId),
    },
    select: {
      projectId: true,
      occurredAt: true,
      actorUserId: true,
      actorEmail: true,
      project: { select: { workingTitle: true } },
    },
  });
  if (!event) return null;

  return {
    sourceKind: "PROJECT",
    sourceId: event.projectId,
    sourceTitle: event.project?.workingTitle ?? "(untitled project)",
    sourceUrl: null,
    sourceDocId: null,
    promotedAt: event.occurredAt,
    actorUserId: event.actorUserId,
    actorEmail: event.actorEmail,
  };
}

async function findPromotionActor(
  kind: PromotionSourceKind,
  sourceId: string
): Promise<{ actorUserId: string | null; actorEmail: string | null } | null> {
  return prisma.auditEvent.findFirst({
    where: {
      category: "pursuit_promotion",
      action: "promote_to_pursuit",
      subjectKind: kind,
      subjectId: sourceId,
    },
    orderBy: { emittedAt: "asc" },
    select: { actorUserId: true, actorEmail: true },
  });
}

/** Full promotion audit trail for a source — powers the history rendering. */
export async function getPromotionHistory(
  kind: PromotionSourceKind,
  sourceId: string
): Promise<
  { action: string; decision: string | null; actorEmail: string | null; emittedAt: Date }[]
> {
  return prisma.auditEvent.findMany({
    where: { category: "pursuit_promotion", subjectKind: kind, subjectId: sourceId },
    orderBy: { emittedAt: "asc" },
    select: { action: true, decision: true, actorEmail: true, emittedAt: true },
    take: 50,
  });
}

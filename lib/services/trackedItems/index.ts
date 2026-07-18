// lib/services/trackedItems/index.ts
//
// Module OPS1 (Slice 1) — the tracked-item register service. One shared
// spine for OAC action items, field/JSO report items, warranty/closeout/
// training/O&M items, testing/inspection, and attic stock — NOT five
// separate builders. See prisma/schema.prisma "Module OPS1" and
// ./fsm.ts for the human-only status authority.
//
// This module NEVER: calls a provider, calls Procore, sends email/
// notifications, auto-assigns, auto-closes, destructively mutates
// MeetingActionItem rows, or backfills historical rows. Every mutation here
// is the direct result of an authenticated user action in the tracked-items
// routes, and consequential mutations emit a DB-persisted "register_action"
// AuditEvent in the same transaction (fail-closed). Stdout telemetry is
// emitted only after commit and carries no confidential domain text.

import { prisma } from "@/lib/prisma";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";
import {
  emitOperationsAuditPostCommit,
  writeOperationsAuditTx,
} from "@/lib/services/operationsAudit";
import {
  isTrackedItemKind,
  isTrackedItemStatus,
  validateTransition,
  TRACKED_ITEM_PRIORITIES,
  type TrackedItemStatus,
} from "./fsm";
import { TRACKED_ITEM_SOURCE_KIND } from "./sourceKinds";

export type { TrackedItemKind, TrackedItemStatus } from "./fsm";

const MAX_TITLE_LENGTH = 300;

export interface Actor {
  id?: string | null;
  name?: string | null;
  email?: string | null;
}

function actorLabel(actor: Actor | null | undefined): string | null {
  const label = actor?.email?.trim() || actor?.name?.trim() || actor?.id?.trim();
  return label || null;
}

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function auditTx(
  tx: PrismaTx,
  action: string,
  bidId: number,
  subjectId: string,
  actor: Actor | null | undefined,
  decision: string,
  payload: Record<string, unknown>
): Promise<AuditEnvelope> {
  return writeOperationsAuditTx(tx, {
    action,
    decision,
    subjectKind: "TrackedItem",
    subjectId: Number(subjectId),
    actor: actor ?? null,
    payload: { scope: "bid", bidId, ...payload },
  });
}

// ── List / filter ────────────────────────────────────────────────────────────

export interface TrackedItemFilters {
  kind?: string;
  status?: string;
  assigneeName?: string;
  dueBefore?: Date;
}

export async function listTrackedItems(bidId: number, filters: TrackedItemFilters = {}) {
  return prisma.trackedItem.findMany({
    where: {
      bidId,
      ...(filters.kind && isTrackedItemKind(filters.kind) ? { kind: filters.kind } : {}),
      ...(filters.status && isTrackedItemStatus(filters.status)
        ? { status: filters.status }
        : {}),
      ...(filters.assigneeName ? { assigneeName: filters.assigneeName } : {}),
      ...(filters.dueBefore ? { dueDate: { lte: filters.dueBefore } } : {}),
    },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    include: {
      _count: {
        select: { comments: true, attachments: true, supportingObservations: true },
      },
    },
  });
}

/** Phase 1B — which of these items carry ≥1 disposition record on a citing
 *  observation. One indexed query per list page; feeds
 *  deriveConsultantBadge() (badge is computed at read time, never stored). */
export async function itemIdsWithDispositions(
  bidId: number,
  itemIds: number[]
): Promise<Set<number>> {
  if (itemIds.length === 0) return new Set();
  const rows = await prisma.consultantDispositionRecord.findMany({
    where: { bidId, observation: { registerItemId: { in: itemIds } } },
    select: { observation: { select: { registerItemId: true } } },
  });
  return new Set(
    rows
      .map((r) => r.observation.registerItemId)
      .filter((v): v is number => v != null)
  );
}

export async function getTrackedItem(bidId: number, itemId: number) {
  return prisma.trackedItem.findFirst({
    where: { id: itemId, bidId },
    include: {
      comments: { orderBy: { createdAt: "asc" } },
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });
}

// ── Create (manual) ──────────────────────────────────────────────────────────

export interface CreateTrackedItemInput {
  kind: string;
  title: string;
  description?: string | null;
  priority?: string | null;
  assigneeName?: string | null;
  assigneeEmail?: string | null;
  dueDate?: Date | null;
  evidenceExcerpt?: string | null;
  sourceLocator?: string | null;
}

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string };

export async function createTrackedItem(
  bidId: number,
  input: CreateTrackedItemInput,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  if (!isTrackedItemKind(input.kind)) {
    return { ok: false, error: `Unknown kind: ${input.kind}` };
  }
  const title = input.title?.trim();
  if (!title) return { ok: false, error: "title is required" };
  const priority = input.priority ?? "MEDIUM";
  if (!(TRACKED_ITEM_PRIORITIES as readonly string[]).includes(priority)) {
    return { ok: false, error: `Unknown priority: ${priority}` };
  }

  let envelope: AuditEnvelope | null = null;
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.trackedItem.create({
      data: {
        bidId,
        kind: input.kind,
        title: title.slice(0, MAX_TITLE_LENGTH),
        description: input.description?.trim() || null,
        priority,
        assigneeName: input.assigneeName?.trim() || null,
        assigneeEmail: input.assigneeEmail?.trim() || null,
        dueDate: input.dueDate ?? null,
        sourceKind: TRACKED_ITEM_SOURCE_KIND.MANUAL,
        evidenceExcerpt: input.evidenceExcerpt?.trim() || null,
        sourceLocator: input.sourceLocator?.trim() || null,
        extractionMethod: "manual",
        citationVerified: false,
      },
      select: { id: true },
    });
    envelope = await auditTx(tx, "tracked_item_create", bidId, String(row.id), actor, "created", {
      kind: input.kind,
      sourceKind: TRACKED_ITEM_SOURCE_KIND.MANUAL,
    });
    return row;
  });
  emitOperationsAuditPostCommit(envelope);

  return { ok: true, value: created };
}

// ── OAC bridge: promote an existing MeetingActionItem ───────────────────────
//
// Human-chosen, one item at a time — never bulk/auto promotion. The
// MeetingActionItem row is READ ONLY here: it stays exactly as the meeting
// pipeline wrote it and remains the source evidence; the unique
// sourceMeetingActionItemId column (plus a pre-check for a friendly error)
// prevents promoting the same action item twice.

export async function promoteMeetingActionItem(
  bidId: number,
  meetingActionItemId: number,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const source = await prisma.meetingActionItem.findFirst({
    where: { id: meetingActionItemId, bidId },
  });
  if (!source) return { ok: false, error: "Meeting action item not found for this bid" };

  const existing = await prisma.trackedItem.findFirst({
    where: { sourceMeetingActionItemId: meetingActionItemId },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: false,
      error: `Already tracked as item #${existing.id} — an action item can only be promoted once`,
    };
  }

  try {
    let envelope: AuditEnvelope | null = null;
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.trackedItem.create({
        data: {
          bidId,
          kind: "OAC_ACTION",
          title: source.description.slice(0, MAX_TITLE_LENGTH),
          description: source.notes?.trim() || null,
          priority: source.priority,
          assigneeName: source.assignedToName?.trim() || null,
          dueDate: source.dueDate ?? null,
          carriedFromDate: source.carriedFromDate ?? null,
          sourceKind: TRACKED_ITEM_SOURCE_KIND.MEETING_ACTION_ITEM,
          sourceMeetingId: source.meetingId ?? null,
          sourceMeetingActionItemId: source.id,
          evidenceExcerpt: source.sourceText?.trim() || null,
          sourceLocator: null,
          extractionMethod: source.source === "meeting" ? "meeting_analysis" : "manual",
          citationVerified: false,
        },
        select: { id: true },
      });
      envelope = await auditTx(
        tx,
        "tracked_item_promote",
        bidId,
        String(row.id),
        actor,
        "promoted_from_meeting_action_item",
        {
          meetingActionItemId: source.id,
          meetingId: source.meetingId,
          extractionMethod: source.source === "meeting" ? "meeting_analysis" : "manual",
        },
      );
      return row;
    });
    emitOperationsAuditPostCommit(envelope);
    return { ok: true, value: created };
  } catch (err) {
    // Unique-constraint race (two promotions of the same action item at
    // once): surface the same friendly duplicate error, never a 500.
    if (
      err &&
      typeof err === "object" &&
      (err as { code?: string }).code === "P2002"
    ) {
      return {
        ok: false,
        error: "Already tracked — an action item can only be promoted once",
      };
    }
    throw err;
  }
}

// ── Field Report bridge (Slice 2): create an item FROM a report ─────────────
//
// HUMAN-TRIGGERED only — never fired by upload/parse. Unlike the OAC
// promotion (which copies an existing action item), this creates a fresh
// item whose content the human typed, citing the report as its source. A
// report may source many items (no uniqueness), and deleting the report
// SetNulls the citation without touching the item.

export interface CreateItemFromFieldReportInput {
  title: string;
  description?: string | null;
  priority?: string | null;
  assigneeName?: string | null;
  dueDate?: Date | null;
  /** Optional human-typed excerpt from the report (V0 has no OCR/text). */
  evidenceExcerpt?: string | null;
  /** Optional page/line hint, e.g. "p.2, safety section". */
  sourceLocator?: string | null;
}

export async function createItemFromFieldReport(
  bidId: number,
  fieldReportId: number,
  input: CreateItemFromFieldReportInput,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  // Tenancy: the report must belong to THIS bid — a cross-bid report can
  // never source an item.
  const report = await prisma.fieldReport.findFirst({
    where: { id: fieldReportId, bidId },
    select: { id: true },
  });
  if (!report) return { ok: false, error: "Field report not found for this bid" };

  const title = input.title?.trim();
  if (!title) return { ok: false, error: "title is required" };
  const priority = input.priority ?? "MEDIUM";
  if (!(TRACKED_ITEM_PRIORITIES as readonly string[]).includes(priority)) {
    return { ok: false, error: `Unknown priority: ${priority}` };
  }

  let envelope: AuditEnvelope | null = null;
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.trackedItem.create({
      data: {
        bidId,
        kind: "FIELD_ITEM",
        title: title.slice(0, MAX_TITLE_LENGTH),
        description: input.description?.trim() || null,
        priority,
        assigneeName: input.assigneeName?.trim() || null,
        dueDate: input.dueDate ?? null,
        sourceKind: TRACKED_ITEM_SOURCE_KIND.FIELD_REPORT,
        sourceFieldReportId: fieldReportId,
        evidenceExcerpt: input.evidenceExcerpt?.trim() || null,
        sourceLocator: input.sourceLocator?.trim() || null,
        extractionMethod: "manual",
        citationVerified: false,
      },
      select: { id: true },
    });
    envelope = await auditTx(
      tx,
      "tracked_item_create",
      bidId,
      String(row.id),
      actor,
      "created_from_field_report",
      { kind: "FIELD_ITEM", sourceKind: TRACKED_ITEM_SOURCE_KIND.FIELD_REPORT, fieldReportId },
    );
    return row;
  });
  emitOperationsAuditPostCommit(envelope);
  return { ok: true, value: created };
}

// ── Update (non-status fields) ───────────────────────────────────────────────

export interface UpdateTrackedItemInput {
  title?: string;
  description?: string | null;
  priority?: string;
  assigneeName?: string | null;
  assigneeEmail?: string | null;
  dueDate?: Date | null;
}

export async function updateTrackedItem(
  bidId: number,
  itemId: number,
  patch: UpdateTrackedItemInput,
  actor: Actor = {}
): Promise<ServiceResult<{ id: number }>> {
  if (patch.title !== undefined && !patch.title.trim()) {
    return { ok: false, error: "title cannot be empty" };
  }
  if (
    patch.priority !== undefined &&
    !(TRACKED_ITEM_PRIORITIES as readonly string[]).includes(patch.priority)
  ) {
    return { ok: false, error: `Unknown priority: ${patch.priority}` };
  }
  const item = await prisma.trackedItem.findFirst({
    where: { id: itemId, bidId },
    select: { id: true },
  });
  if (!item) return { ok: false, error: "Not found" };

  let envelope: AuditEnvelope | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.trackedItem.update({
      where: { id: itemId },
      data: {
        ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, MAX_TITLE_LENGTH) } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description?.trim() || null }
          : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.assigneeName !== undefined
          ? { assigneeName: patch.assigneeName?.trim() || null }
          : {}),
        ...(patch.assigneeEmail !== undefined
          ? { assigneeEmail: patch.assigneeEmail?.trim() || null }
          : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
      },
    });
    envelope = await auditTx(tx, "tracked_item_update", bidId, String(itemId), actor, "updated", {
      changedFields: Object.keys(patch).sort(),
    });
  });
  emitOperationsAuditPostCommit(envelope);

  return { ok: true, value: { id: itemId } };
}

// ── Status transitions (FSM-validated, human-only) ─────────────────────────

export async function transitionTrackedItem(
  bidId: number,
  itemId: number,
  to: string,
  actor: Actor,
  options: { waivedReason?: string | null; note?: string | null } = {}
): Promise<ServiceResult<{ id: number; status: TrackedItemStatus }>> {
  const item = await prisma.trackedItem.findFirst({
    where: { id: itemId, bidId },
    select: { id: true, status: true },
  });
  if (!item) return { ok: false, error: "Not found" };
  if (!isTrackedItemStatus(to)) return { ok: false, error: `Unknown status: ${to}` };

  // Capture the pre-transition status by VALUE before any update — never
  // re-read it afterwards (the audit line below must record the true
  // from-state even if the row object is shared/mutated by the ORM layer).
  const from = item.status as TrackedItemStatus;

  const result = validateTransition({
    from,
    to,
    actor: actorLabel(actor),
    waivedReason: options.waivedReason ?? null,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const note = options.note?.trim();
  let envelope: AuditEnvelope | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.trackedItem.update({
      where: { id: itemId },
      data: result.updates,
    });
    if (note) {
      await tx.trackedItemComment.create({
        data: {
          trackedItemId: itemId,
          authorName: actor.name?.trim() || null,
          authorEmail: actor.email?.trim() || null,
          body: note,
        },
      });
    }
    envelope = await auditTx(
      tx,
      "tracked_item_transition",
      bidId,
      String(itemId),
      actor,
      `${from}->${to}`,
      {
        from,
        to,
        waivedReasonProvided: to === "WAIVED" && Boolean(options.waivedReason?.trim()),
        noteAdded: Boolean(note),
      },
    );
  });
  emitOperationsAuditPostCommit(envelope);

  return { ok: true, value: { id: itemId, status: to } };
}

// ── Comments (append-only in V1) ────────────────────────────────────────────

export async function addComment(
  bidId: number,
  itemId: number,
  actor: Actor,
  body: string
): Promise<ServiceResult<{ id: number }>> {
  const trimmed = body?.trim();
  if (!trimmed) return { ok: false, error: "Comment body is required" };

  const item = await prisma.trackedItem.findFirst({
    where: { id: itemId, bidId },
    select: { id: true },
  });
  if (!item) return { ok: false, error: "Not found" };

  let envelope: AuditEnvelope | null = null;
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.trackedItemComment.create({
      data: {
        trackedItemId: itemId,
        authorName: actor.name?.trim() || null,
        authorEmail: actor.email?.trim() || null,
        body: trimmed,
      },
      select: { id: true },
    });
    envelope = await auditTx(
      tx,
      "tracked_item_comment",
      bidId,
      String(itemId),
      actor,
      "comment_added",
      { commentId: row.id, bodyLength: trimmed.length },
    );
    return row;
  });
  emitOperationsAuditPostCommit(envelope);
  return { ok: true, value: created };
}

export async function listComments(bidId: number, itemId: number) {
  const item = await prisma.trackedItem.findFirst({
    where: { id: itemId, bidId },
    select: { id: true },
  });
  if (!item) return null;
  return prisma.trackedItemComment.findMany({
    where: { trackedItemId: itemId },
    orderBy: { createdAt: "asc" },
  });
}

// ── Attachments (metadata; bytes handled by the route via BlobStore) ───────

/** Bid-scoped existence probe — used by the attachment route to enforce
 *  tenancy BEFORE any blob byte is written. */
export async function trackedItemExists(bidId: number, itemId: number): Promise<boolean> {
  const item = await prisma.trackedItem.findFirst({
    where: { id: itemId, bidId },
    select: { id: true },
  });
  return item !== null;
}

export interface AttachmentMetaInput {
  storageKey: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  kind: "photo" | "document";
  caption?: string | null;
}

export async function recordAttachment(
  bidId: number,
  itemId: number,
  actor: Actor,
  meta: AttachmentMetaInput
): Promise<ServiceResult<{ id: number }>> {
  const item = await prisma.trackedItem.findFirst({
    where: { id: itemId, bidId },
    select: { id: true },
  });
  if (!item) return { ok: false, error: "Not found" };

  let envelope: AuditEnvelope | null = null;
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.trackedItemAttachment.create({
      data: {
        trackedItemId: itemId,
        storageKey: meta.storageKey,
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        byteSize: meta.byteSize,
        kind: meta.kind,
        caption: meta.caption?.trim() || null,
        createdBy: actorLabel(actor),
      },
      select: { id: true },
    });
    envelope = await auditTx(
      tx,
      "tracked_item_attachment",
      bidId,
      String(itemId),
      actor,
      "attachment_added",
      {
        attachmentId: row.id,
        kind: meta.kind,
        mimeType: meta.mimeType,
        byteSize: meta.byteSize,
        captionLength: meta.caption?.trim().length ?? 0,
      },
    );
    return row;
  });
  emitOperationsAuditPostCommit(envelope);

  return { ok: true, value: created };
}

export async function listAttachments(bidId: number, itemId: number) {
  const item = await prisma.trackedItem.findFirst({
    where: { id: itemId, bidId },
    select: { id: true },
  });
  if (!item) return null;
  return prisma.trackedItemAttachment.findMany({
    where: { trackedItemId: itemId },
    orderBy: { createdAt: "asc" },
  });
}

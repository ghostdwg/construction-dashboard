// lib/services/meetingRegister/register.ts
//
// Module R2-B1 — Meeting Register entries: list, manual create, normalized
// edit, human disposition, coverage. Register entries are DURABLE — no
// delete path exists at any layer; every state change appends a
// MeetingRegisterEntryRevision row. rawSourceText is frozen at creation.
// Every accountability-relevant mutation writes its AuditEvent row inside
// the same transaction (fail-closed) and emits telemetry only after commit.

import { prisma } from "@/lib/prisma";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";
import { emitRegisterAuditPostCommit, writeRegisterAuditTx } from "./txAudit";
import {
  historyMaterializationError,
  withMeetingHistoryMaterialization,
} from "./retention";
import {
  type Actor,
  type RegisterDisposition,
  type RegisterEntryType,
  type ServiceResult,
  EXTRACTED_ORIGINS,
  SUPERSEDED_STATE,
  actorLabel,
  bound,
  isRegisterDisposition,
  isRegisterEntryType,
} from "./types";

export async function findEntry(bidId: number, meetingId: number, entryId: number) {
  return prisma.meetingRegisterEntry.findFirst({
    where: { id: entryId, meetingId, bidId },
  });
}

/**
 * Provenance guard for a manually supplied segment reference (release-
 * blocker 3): the segment must exist, belong to THIS meeting, and that
 * meeting must belong to THIS bid (the route's requireBidAccess has already
 * bound bidId to the caller). One uniform error for nonexistent,
 * cross-meeting and cross-bid ids — a probe learns nothing about foreign
 * segments.
 */
async function validateSegmentProvenance(
  bidId: number,
  meetingId: number,
  segmentId: number
): Promise<boolean> {
  if (!Number.isInteger(segmentId) || segmentId <= 0) return false;
  const segment = await prisma.meetingTranscriptSegment.findFirst({
    where: { id: segmentId, meetingId, bidId },
    select: { id: true },
  });
  return segment != null;
}

export type RegisterFilters = {
  entryType?: string;
  reviewState?: string;
  /** Superseded entries are history — hidden unless explicitly requested. */
  includeSuperseded?: boolean;
};

export async function listEntries(
  bidId: number,
  meetingId: number,
  filters: RegisterFilters = {}
) {
  return prisma.meetingRegisterEntry.findMany({
    where: {
      meetingId,
      bidId,
      ...(filters.entryType ? { entryType: filters.entryType } : {}),
      ...(filters.reviewState
        ? { reviewState: filters.reviewState }
        : filters.includeSuperseded
          ? {}
          : { reviewState: { not: SUPERSEDED_STATE } }),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      linkedTrackedItem: { select: { id: true, title: true, status: true, kind: true } },
      relatedPriorEntry: {
        select: { id: true, meetingId: true, normalizedText: true, entryType: true },
      },
      supersededByEntry: { select: { id: true, entryType: true } },
    },
  });
}

export type ManualEntryInput = {
  entryType: string;
  normalizedText: string;
  rawSourceText?: string;
  agendaTopic?: string;
  speakerLabel?: string;
  speakerName?: string;
  responsibleParty?: string;
  dueDate?: string; // ISO date
  segmentId?: number;
  relatedPriorEntryId?: number;
  participants?: string[];
};

/** Manual entries are human-authored — they land CONFIRMED (rule 11 applies to extracted entries). */
export async function createManualEntry(
  bidId: number,
  meetingId: number,
  input: ManualEntryInput,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const createdBy = actorLabel(actor);
  if (!createdBy) return { ok: false, error: "A session actor is required" };
  if (!isRegisterEntryType(input.entryType)) {
    return { ok: false, error: `Invalid entryType ${input.entryType}` };
  }
  const normalizedText = input.normalizedText?.trim().slice(0, 4000);
  if (!normalizedText) return { ok: false, error: "normalizedText is required" };

  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, bidId },
    select: { id: true },
  });
  if (!meeting) return { ok: false, error: "Not found" };

  // Release-blocker 3 — a manually supplied segmentId must belong to this
  // meeting and this bid; cross-meeting/cross-bid provenance is impossible.
  if (input.segmentId !== undefined && input.segmentId !== null) {
    const valid = await validateSegmentProvenance(bidId, meetingId, input.segmentId);
    if (!valid) return { ok: false, error: "Segment not found" };
  }

  if (input.relatedPriorEntryId) {
    const prior = await prisma.meetingRegisterEntry.findFirst({
      where: { id: input.relatedPriorEntryId, bidId },
      select: { id: true },
    });
    if (!prior) return { ok: false, error: "relatedPriorEntryId not found in this project" };
  }

  const dueDate =
    input.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)
      ? new Date(`${input.dueDate}T00:00:00.000Z`)
      : null;

  let envelope: AuditEnvelope | null = null;
  const committed = await withMeetingHistoryMaterialization(bidId, meetingId, async (tx) => {
    const created = await tx.meetingRegisterEntry.create({
      data: {
        meetingId,
        bidId,
        entryType: input.entryType as RegisterEntryType,
        agendaTopic: bound(input.agendaTopic, 200),
        rawSourceText: (input.rawSourceText?.trim() || normalizedText).slice(0, 4000),
        normalizedText,
        speakerLabel: bound(input.speakerLabel, 100),
        speakerName: bound(input.speakerName, 200),
        segmentId: input.segmentId ?? null,
        participantsJson: JSON.stringify(
          Array.isArray(input.participants)
            ? input.participants.map((p) => String(p).slice(0, 200)).slice(0, 50)
            : []
        ),
        responsibleParty: bound(input.responsibleParty, 200),
        dueDate,
        origin: "manual",
        reviewState: "CONFIRMED",
        dispositionBy: createdBy,
        dispositionAt: new Date(),
        relatedPriorEntryId: input.relatedPriorEntryId ?? null,
        createdBy,
      },
    });
    const revision = await tx.meetingRegisterEntryRevision.create({
      data: {
        entryId: created.id,
        bidId,
        changeType: "CREATED",
        toReviewState: "CONFIRMED",
        detailJson: JSON.stringify({ origin: "manual", entryType: input.entryType }),
        actor: createdBy,
      },
    });
    envelope = await writeRegisterAuditTx(tx, {
      action: "register_entry_created",
      decision: "created",
      subjectKind: "MeetingRegisterEntry",
      subjectId: created.id,
      actor,
      payload: {
        bidId,
        meetingId,
        registerEntryId: created.id,
        revisionId: revision.id,
        entryType: input.entryType,
        origin: "manual",
        segmentId: input.segmentId ?? null,
      },
    });
    return created;
  });
  if (!committed.ok) {
    return {
      ok: false,
      error: historyMaterializationError(committed.reason),
    };
  }
  emitRegisterAuditPostCommit(envelope);
  return { ok: true, value: { id: committed.value.id } };
}

export type EditEntryInput = {
  normalizedText?: string;
  agendaTopic?: string;
  responsibleParty?: string;
  dueDate?: string | null;
  relatedPriorEntryId?: number | null;
};

/** Edit normalized fields only — rawSourceText is frozen forever. */
export async function editEntry(
  bidId: number,
  meetingId: number,
  entryId: number,
  input: EditEntryInput,
  actor: Actor
): Promise<ServiceResult<{ id: number }>> {
  const editor = actorLabel(actor);
  if (!editor) return { ok: false, error: "A session actor is required to edit" };
  const entry = await findEntry(bidId, meetingId, entryId);
  if (!entry) return { ok: false, error: "Not found" };
  if (entry.reviewState === SUPERSEDED_STATE) {
    return { ok: false, error: "Superseded entries are historical and cannot be edited" };
  }

  const data: Record<string, unknown> = {};
  const changed: Record<string, boolean> = {};
  if (input.normalizedText !== undefined) {
    const t = input.normalizedText.trim().slice(0, 4000);
    if (!t) return { ok: false, error: "normalizedText cannot be empty" };
    data.normalizedText = t;
    changed.normalizedText = true;
  }
  if (input.agendaTopic !== undefined) {
    data.agendaTopic = bound(input.agendaTopic, 200);
    changed.agendaTopic = true;
  }
  if (input.responsibleParty !== undefined) {
    data.responsibleParty = bound(input.responsibleParty, 200);
    changed.responsibleParty = true;
  }
  if (input.dueDate !== undefined) {
    if (input.dueDate === null) {
      data.dueDate = null;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
      data.dueDate = new Date(`${input.dueDate}T00:00:00.000Z`);
    } else {
      return { ok: false, error: "dueDate must be YYYY-MM-DD or null" };
    }
    changed.dueDate = true;
  }
  if (input.relatedPriorEntryId !== undefined) {
    if (input.relatedPriorEntryId !== null) {
      const prior = await prisma.meetingRegisterEntry.findFirst({
        where: { id: input.relatedPriorEntryId, bidId },
        select: { id: true },
      });
      if (!prior) return { ok: false, error: "relatedPriorEntryId not found in this project" };
    }
    data.relatedPriorEntryId = input.relatedPriorEntryId;
    changed.relatedPriorEntryId = true;
  }
  if (Object.keys(data).length === 0) return { ok: false, error: "No editable fields supplied" };

  let envelope: AuditEnvelope | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.meetingRegisterEntry.update({ where: { id: entry.id }, data });
    const revision = await tx.meetingRegisterEntryRevision.create({
      data: {
        entryId: entry.id,
        bidId,
        changeType: "EDIT",
        fromReviewState: entry.reviewState,
        toReviewState: entry.reviewState,
        detailJson: JSON.stringify(changed),
        actor: editor,
      },
    });
    envelope = await writeRegisterAuditTx(tx, {
      action: "register_entry_edited",
      decision: "edited",
      subjectKind: "MeetingRegisterEntry",
      subjectId: entry.id,
      actor,
      payload: {
        bidId,
        meetingId,
        registerEntryId: entry.id,
        revisionId: revision.id,
        fields: Object.keys(changed),
      },
    });
  });
  emitRegisterAuditPostCommit(envelope);
  return { ok: true, value: { id: entry.id } };
}

export type DispositionInput = {
  disposition: string;
  reason?: string;
  /** MERGED / DUPLICATE: the surviving entry this one folds into */
  targetEntryId?: number;
  /** CORRECTED: the corrected normalized wording */
  correctedText?: string;
};

export async function dispositionEntry(
  bidId: number,
  meetingId: number,
  entryId: number,
  input: DispositionInput,
  actor: Actor
): Promise<ServiceResult<{ id: number; reviewState: RegisterDisposition }>> {
  const disposedBy = actorLabel(actor);
  if (!disposedBy) return { ok: false, error: "A session actor is required to disposition" };
  if (!isRegisterDisposition(input.disposition)) {
    return { ok: false, error: `Invalid disposition ${input.disposition}` };
  }
  const disposition = input.disposition;
  if (disposition === "PROMOTED_TO_OPERATIONS") {
    return { ok: false, error: "Use the promote or link endpoint for operations promotion" };
  }

  const entry = await findEntry(bidId, meetingId, entryId);
  if (!entry) return { ok: false, error: "Not found" };
  if (entry.reviewState === "PROMOTED_TO_OPERATIONS") {
    return { ok: false, error: "Promoted entries cannot be re-dispositioned" };
  }
  if (entry.reviewState === SUPERSEDED_STATE) {
    return { ok: false, error: "Superseded entries are historical and cannot be dispositioned" };
  }

  const reason = bound(input.reason, 500);
  if (disposition === "DISMISSED_WITH_REASON" && !reason) {
    return { ok: false, error: "A reason is required to dismiss" };
  }

  let targetEntryId: number | null = null;
  if (disposition === "MERGED" || disposition === "DUPLICATE") {
    if (!input.targetEntryId) {
      return { ok: false, error: `${disposition} requires targetEntryId` };
    }
    if (input.targetEntryId === entryId) {
      return { ok: false, error: "An entry cannot merge into itself" };
    }
    const target = await prisma.meetingRegisterEntry.findFirst({
      where: { id: input.targetEntryId, bidId },
      select: { id: true },
    });
    if (!target) return { ok: false, error: "targetEntryId not found in this project" };
    targetEntryId = target.id;
  }

  let correctedText: string | null = null;
  if (disposition === "CORRECTED") {
    correctedText = input.correctedText?.trim().slice(0, 4000) || null;
    if (!correctedText) return { ok: false, error: "CORRECTED requires correctedText" };
  }

  let envelope: AuditEnvelope | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.meetingRegisterEntry.update({
      where: { id: entry.id },
      data: {
        reviewState: disposition,
        dispositionReason: reason,
        dispositionBy: disposedBy,
        dispositionAt: new Date(),
        ...(targetEntryId ? { mergedIntoEntryId: targetEntryId } : {}),
        ...(correctedText ? { normalizedText: correctedText } : {}),
      },
    });
    const revision = await tx.meetingRegisterEntryRevision.create({
      data: {
        entryId: entry.id,
        bidId,
        changeType: "DISPOSITION",
        fromReviewState: entry.reviewState,
        toReviewState: disposition,
        detailJson: JSON.stringify({
          ...(targetEntryId ? { targetEntryId } : {}),
          ...(correctedText ? { normalizedText: true } : {}),
        }),
        actor: disposedBy,
        reason,
      },
    });
    envelope = await writeRegisterAuditTx(tx, {
      action: "register_entry_dispositioned",
      decision: disposition.toLowerCase(),
      subjectKind: "MeetingRegisterEntry",
      subjectId: entry.id,
      actor,
      payload: {
        bidId,
        meetingId,
        registerEntryId: entry.id,
        revisionId: revision.id,
        from: entry.reviewState,
        to: disposition,
        ...(targetEntryId ? { targetEntryId } : {}),
        hasReason: Boolean(reason),
        sourceExtractionRunId: entry.extractionRunId,
      },
    });
  });
  emitRegisterAuditPostCommit(envelope);
  return { ok: true, value: { id: entry.id, reviewState: disposition } };
}

export type RegisterCoverage = {
  total: number;
  extracted: number;
  pendingExtracted: number;
  /** rerun-superseded entries — history, excluded from the review gate */
  superseded: number;
  byReviewState: Record<string, number>;
  byEntryType: Record<string, number>;
  /** R2 rule 11 — false while any extracted entry is undispositioned */
  fullyReviewed: boolean;
};

export async function getCoverage(
  bidId: number,
  meetingId: number
): Promise<RegisterCoverage> {
  const entries = await prisma.meetingRegisterEntry.findMany({
    where: { meetingId, bidId },
    select: { reviewState: true, entryType: true, origin: true },
  });
  const byReviewState: Record<string, number> = {};
  const byEntryType: Record<string, number> = {};
  let extracted = 0;
  let pendingExtracted = 0;
  let superseded = 0;
  for (const e of entries) {
    byReviewState[e.reviewState] = (byReviewState[e.reviewState] ?? 0) + 1;
    if (e.reviewState === SUPERSEDED_STATE) {
      superseded++;
      continue; // history — not part of the active register or review gate
    }
    byEntryType[e.entryType] = (byEntryType[e.entryType] ?? 0) + 1;
    const isExtracted = (EXTRACTED_ORIGINS as readonly string[]).includes(e.origin);
    if (isExtracted) {
      extracted++;
      if (e.reviewState === "PENDING") pendingExtracted++;
    }
  }
  return {
    total: entries.length - superseded,
    extracted,
    pendingExtracted,
    superseded,
    byReviewState,
    byEntryType,
    fullyReviewed: pendingExtracted === 0,
  };
}

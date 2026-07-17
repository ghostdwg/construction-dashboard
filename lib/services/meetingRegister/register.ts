// lib/services/meetingRegister/register.ts
//
// Module R2-B1 — Meeting Register entries: list, manual create, normalized
// edit, human disposition, coverage. Register entries are DURABLE — no
// delete path exists at any layer; every state change appends a
// MeetingRegisterEntryRevision row. rawSourceText is frozen at creation.

import { prisma } from "@/lib/prisma";
import { emitAuditEvent } from "@/lib/observability/audit";
import {
  type Actor,
  type RegisterDisposition,
  type RegisterEntryType,
  type ServiceResult,
  EXTRACTED_ORIGINS,
  actorLabel,
  bound,
  isRegisterDisposition,
  isRegisterEntryType,
} from "./types";

async function audit(
  action: string,
  bidId: number,
  entryId: number,
  actor: Actor,
  decision: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await emitAuditEvent({
      category: "register_action",
      action,
      severity: "NOTICE",
      decision,
      subject: { kind: "MeetingRegisterEntry", id: String(entryId) },
      actor: { kind: "operator", userId: null, email: actor?.email ?? null },
      // ids/counts only — never entry text.
      payload: { bidId, ...payload },
    });
  } catch (err) {
    console.error(
      "[meetingRegister] audit emit failed (action continues):",
      err instanceof Error ? err.message : err
    );
  }
}

export async function findEntry(bidId: number, meetingId: number, entryId: number) {
  return prisma.meetingRegisterEntry.findFirst({
    where: { id: entryId, meetingId, bidId },
  });
}

export type RegisterFilters = {
  entryType?: string;
  reviewState?: string;
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
      ...(filters.reviewState ? { reviewState: filters.reviewState } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      linkedTrackedItem: { select: { id: true, title: true, status: true, kind: true } },
      relatedPriorEntry: {
        select: { id: true, meetingId: true, normalizedText: true, entryType: true },
      },
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

  const entry = await prisma.$transaction(async (tx) => {
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
    await tx.meetingRegisterEntryRevision.create({
      data: {
        entryId: created.id,
        bidId,
        changeType: "CREATED",
        toReviewState: "CONFIRMED",
        detailJson: JSON.stringify({ origin: "manual", entryType: input.entryType }),
        actor: createdBy,
      },
    });
    return created;
  });

  await audit("register_entry_created", bidId, entry.id, actor, "created", {
    meetingId,
    entryType: input.entryType,
    origin: "manual",
  });
  return { ok: true, value: { id: entry.id } };
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

  await prisma.$transaction(async (tx) => {
    await tx.meetingRegisterEntry.update({ where: { id: entry.id }, data });
    await tx.meetingRegisterEntryRevision.create({
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
  });
  await audit("register_entry_edited", bidId, entry.id, actor, "edited", {
    meetingId,
    fields: Object.keys(changed),
  });
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
    await tx.meetingRegisterEntryRevision.create({
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
  });
  await audit("register_entry_dispositioned", bidId, entry.id, actor, disposition.toLowerCase(), {
    meetingId,
    from: entry.reviewState,
    to: disposition,
    hasReason: Boolean(reason),
  });
  return { ok: true, value: { id: entry.id, reviewState: disposition } };
}

export type RegisterCoverage = {
  total: number;
  extracted: number;
  pendingExtracted: number;
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
  for (const e of entries) {
    byReviewState[e.reviewState] = (byReviewState[e.reviewState] ?? 0) + 1;
    byEntryType[e.entryType] = (byEntryType[e.entryType] ?? 0) + 1;
    const isExtracted = (EXTRACTED_ORIGINS as readonly string[]).includes(e.origin);
    if (isExtracted) {
      extracted++;
      if (e.reviewState === "PENDING") pendingExtracted++;
    }
  }
  return {
    total: entries.length,
    extracted,
    pendingExtracted,
    byReviewState,
    byEntryType,
    fullyReviewed: pendingExtracted === 0,
  };
}

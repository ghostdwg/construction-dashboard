// lib/services/meetingRegister/corrections.ts
//
// Module R2-B1 — audited diarization + transcript corrections.
//
// Every operation: (1) mutates ONLY the current* overlay columns on
// MeetingTranscriptSegment (original* columns and Meeting.rawTranscript are
// never touched), (2) appends one immutable MeetingTranscriptCorrection row
// with author/reason/bounded before-after values and the ids of derived
// objects whose attribution overlapped the corrected span, and (3) rebuilds
// the derived display transcript so a subsequent extraction rerun sees the
// corrections (R2 rules 5–7). A session actor is REQUIRED for every op.

import { prisma } from "@/lib/prisma";
import { emitAuditEvent } from "@/lib/observability/audit";
import { rebuildDisplayTranscript } from "./segments";
import {
  type Actor,
  type CorrectionType,
  type ServiceResult,
  actorLabel,
  bound,
} from "./types";

export type CorrectionInput = {
  correctionType: CorrectionType;
  segmentId?: number;
  /** RENAME_SPEAKER / REASSIGN_* / MERGE_SPEAKERS / MARK_UNKNOWN source label */
  fromSpeakerLabel?: string;
  /** target label (reassign/merge) or new display name (rename) */
  toValue?: string;
  /** EDIT_TEXT replacement wording */
  newText?: string;
  /** SPLIT_SEGMENT: character offset in currentText where the split occurs */
  splitOffset?: number;
  /** SPLIT_SEGMENT: speaker label for the second half (defaults to original) */
  secondSpeakerLabel?: string;
  reason?: string;
};

export type AffectedDerived = {
  registerEntryIds: number[];
  actionItemIds: number[];
  commitmentIds: number[];
  designChangeIds: number[];
};

async function computeAffectedDerived(
  meetingId: number,
  opts: { speakerLabel?: string | null; segmentId?: number | null }
): Promise<AffectedDerived> {
  const bySpeaker = opts.speakerLabel
    ? { speakerLabel: opts.speakerLabel }
    : undefined;

  const [entries, commitments, designChanges] = await Promise.all([
    prisma.meetingRegisterEntry.findMany({
      where: {
        meetingId,
        OR: [
          ...(bySpeaker ? [bySpeaker] : []),
          ...(opts.segmentId ? [{ segmentId: opts.segmentId }] : []),
        ],
      },
      select: { id: true, linkedActionItemId: true },
    }),
    bySpeaker
      ? prisma.meetingCommitment.findMany({
          where: { meetingId, ...bySpeaker },
          select: { id: true },
        })
      : Promise.resolve([]),
    bySpeaker
      ? prisma.designIntentChange.findMany({
          where: { meetingId, ...bySpeaker },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    registerEntryIds: entries.map((e) => e.id),
    actionItemIds: entries
      .map((e) => e.linkedActionItemId)
      .filter((id): id is number => id != null),
    commitmentIds: commitments.map((c) => c.id),
    designChangeIds: designChanges.map((d) => d.id),
  };
}

async function audit(
  action: string,
  bidId: number,
  meetingId: number,
  correctionId: number,
  actor: Actor,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await emitAuditEvent({
      category: "register_action",
      action,
      severity: "NOTICE",
      decision: "corrected",
      subject: { kind: "MeetingTranscriptCorrection", id: String(correctionId) },
      actor: { kind: "operator", userId: null, email: actor?.email ?? null },
      // ids/counts only — never transcript text.
      payload: { bidId, meetingId, ...payload },
    });
  } catch (err) {
    console.error(
      "[meetingRegister/corrections] audit emit failed (action continues):",
      err instanceof Error ? err.message : err
    );
  }
}

async function findMeeting(bidId: number, meetingId: number) {
  return prisma.meeting.findFirst({
    where: { id: meetingId, bidId },
    select: { id: true },
  });
}

export async function applyCorrection(
  bidId: number,
  meetingId: number,
  input: CorrectionInput,
  actor: Actor
): Promise<ServiceResult<{ correctionId: number; affectedSegmentCount: number; affected: AffectedDerived }>> {
  const correctedBy = actorLabel(actor);
  if (!correctedBy) return { ok: false, error: "A session actor is required to correct" };

  const meeting = await findMeeting(bidId, meetingId);
  if (!meeting) return { ok: false, error: "Not found" };

  const reason = bound(input.reason, 500);

  switch (input.correctionType) {
    case "RENAME_SPEAKER":
      return renameSpeaker(bidId, meetingId, input, correctedBy, reason, actor);
    case "REASSIGN_SEGMENT":
      return reassignSegment(bidId, meetingId, input, correctedBy, reason, actor);
    case "REASSIGN_ALL_MATCHING":
      return reassignAllMatching(bidId, meetingId, input, correctedBy, reason, actor);
    case "MERGE_SPEAKERS":
      return mergeSpeakers(bidId, meetingId, input, correctedBy, reason, actor);
    case "SPLIT_SEGMENT":
      return splitSegment(bidId, meetingId, input, correctedBy, reason, actor);
    case "MARK_UNKNOWN":
      return markUnknown(bidId, meetingId, input, correctedBy, reason, actor);
    case "EDIT_TEXT":
      return editText(bidId, meetingId, input, correctedBy, reason, actor);
    default:
      return { ok: false, error: `Unknown correction type` };
  }
}

type OpResult = ServiceResult<{
  correctionId: number;
  affectedSegmentCount: number;
  affected: AffectedDerived;
}>;

async function record(
  bidId: number,
  meetingId: number,
  input: {
    correctionType: CorrectionType;
    segmentId?: number | null;
    fromValue?: string | null;
    toValue?: string | null;
  },
  affectedSegmentCount: number,
  affected: AffectedDerived,
  correctedBy: string,
  reason: string | null,
  actor: Actor
): Promise<OpResult> {
  const correction = await prisma.meetingTranscriptCorrection.create({
    data: {
      meetingId,
      bidId,
      correctionType: input.correctionType,
      segmentId: input.segmentId ?? null,
      fromValue: bound(input.fromValue, 500),
      toValue: bound(input.toValue, 500),
      affectedSegmentCount,
      affectedDerivedJson: JSON.stringify(affected),
      reason,
      correctedBy,
    },
  });
  await rebuildDisplayTranscript(bidId, meetingId);
  await audit("transcript_corrected", bidId, meetingId, correction.id, actor, {
    correctionType: input.correctionType,
    affectedSegmentCount,
    affectedRegisterEntries: affected.registerEntryIds.length,
  });
  return {
    ok: true,
    value: { correctionId: correction.id, affectedSegmentCount, affected },
  };
}

async function getSegment(meetingId: number, bidId: number, segmentId: number | undefined) {
  if (!segmentId) return null;
  return prisma.meetingTranscriptSegment.findFirst({
    where: { id: segmentId, meetingId, bidId, isActive: true },
  });
}

async function renameSpeaker(
  bidId: number,
  meetingId: number,
  input: CorrectionInput,
  correctedBy: string,
  reason: string | null,
  actor: Actor
): Promise<OpResult> {
  const label = input.fromSpeakerLabel?.trim();
  const newName = input.toValue?.trim();
  if (!label || !newName) return { ok: false, error: "fromSpeakerLabel and toValue are required" };

  const participant = await prisma.meetingParticipant.findFirst({
    where: { meetingId, speakerLabel: label },
  });
  if (participant) {
    await prisma.meetingParticipant.update({
      where: { id: participant.id },
      data: { name: newName },
    });
  } else {
    await prisma.meetingParticipant.create({
      data: { meetingId, name: newName, speakerLabel: label },
    });
  }
  const affected = await computeAffectedDerived(meetingId, { speakerLabel: label });
  // Update the register entries' display name (attribution correction).
  if (affected.registerEntryIds.length > 0) {
    await prisma.meetingRegisterEntry.updateMany({
      where: { id: { in: affected.registerEntryIds }, speakerLabel: label },
      data: { speakerName: newName },
    });
  }
  return record(
    bidId,
    meetingId,
    { correctionType: "RENAME_SPEAKER", fromValue: label, toValue: newName },
    0,
    affected,
    correctedBy,
    reason,
    actor
  );
}

async function reassignSegment(
  bidId: number,
  meetingId: number,
  input: CorrectionInput,
  correctedBy: string,
  reason: string | null,
  actor: Actor
): Promise<OpResult> {
  const toLabel = input.toValue?.trim();
  if (!toLabel) return { ok: false, error: "toValue (target speaker label) is required" };
  const segment = await getSegment(meetingId, bidId, input.segmentId);
  if (!segment) return { ok: false, error: "Segment not found" };

  const participant = await prisma.meetingParticipant.findFirst({
    where: { meetingId, speakerLabel: toLabel },
    select: { id: true },
  });
  await prisma.meetingTranscriptSegment.update({
    where: { id: segment.id },
    data: {
      currentSpeakerLabel: toLabel,
      participantId: participant?.id ?? null,
      isUnknownSpeaker: false,
    },
  });
  const affected = await computeAffectedDerived(meetingId, {
    speakerLabel: segment.currentSpeakerLabel,
    segmentId: segment.id,
  });
  return record(
    bidId,
    meetingId,
    {
      correctionType: "REASSIGN_SEGMENT",
      segmentId: segment.id,
      fromValue: segment.currentSpeakerLabel,
      toValue: toLabel,
    },
    1,
    affected,
    correctedBy,
    reason,
    actor
  );
}

async function reassignAllMatching(
  bidId: number,
  meetingId: number,
  input: CorrectionInput,
  correctedBy: string,
  reason: string | null,
  actor: Actor
): Promise<OpResult> {
  const fromLabel = input.fromSpeakerLabel?.trim();
  const toLabel = input.toValue?.trim();
  if (!fromLabel || !toLabel) {
    return { ok: false, error: "fromSpeakerLabel and toValue are required" };
  }
  const participant = await prisma.meetingParticipant.findFirst({
    where: { meetingId, speakerLabel: toLabel },
    select: { id: true },
  });
  const affected = await computeAffectedDerived(meetingId, { speakerLabel: fromLabel });
  const updated = await prisma.meetingTranscriptSegment.updateMany({
    where: { meetingId, bidId, isActive: true, currentSpeakerLabel: fromLabel },
    data: {
      currentSpeakerLabel: toLabel,
      participantId: participant?.id ?? null,
      isUnknownSpeaker: false,
    },
  });
  return record(
    bidId,
    meetingId,
    { correctionType: "REASSIGN_ALL_MATCHING", fromValue: fromLabel, toValue: toLabel },
    updated.count,
    affected,
    correctedBy,
    reason,
    actor
  );
}

async function mergeSpeakers(
  bidId: number,
  meetingId: number,
  input: CorrectionInput,
  correctedBy: string,
  reason: string | null,
  actor: Actor
): Promise<OpResult> {
  const fromLabel = input.fromSpeakerLabel?.trim();
  const intoLabel = input.toValue?.trim();
  if (!fromLabel || !intoLabel) {
    return { ok: false, error: "fromSpeakerLabel and toValue are required" };
  }
  if (fromLabel === intoLabel) return { ok: false, error: "Cannot merge a speaker into itself" };

  const intoParticipant = await prisma.meetingParticipant.findFirst({
    where: { meetingId, speakerLabel: intoLabel },
    select: { id: true },
  });
  const affected = await computeAffectedDerived(meetingId, { speakerLabel: fromLabel });
  const updated = await prisma.meetingTranscriptSegment.updateMany({
    where: { meetingId, bidId, isActive: true, currentSpeakerLabel: fromLabel },
    data: {
      currentSpeakerLabel: intoLabel,
      participantId: intoParticipant?.id ?? null,
      isUnknownSpeaker: false,
    },
  });
  return record(
    bidId,
    meetingId,
    { correctionType: "MERGE_SPEAKERS", fromValue: fromLabel, toValue: intoLabel },
    updated.count,
    affected,
    correctedBy,
    reason,
    actor
  );
}

async function splitSegment(
  bidId: number,
  meetingId: number,
  input: CorrectionInput,
  correctedBy: string,
  reason: string | null,
  actor: Actor
): Promise<OpResult> {
  const segment = await getSegment(meetingId, bidId, input.segmentId);
  if (!segment) return { ok: false, error: "Segment not found" };
  const offset = input.splitOffset ?? 0;
  if (
    !Number.isInteger(offset) ||
    offset <= 0 ||
    offset >= segment.currentText.length
  ) {
    // The current transcript structure permits a split only at an interior
    // character offset of one segment's wording.
    return { ok: false, error: "splitOffset must fall inside the segment text" };
  }
  const firstText = segment.currentText.slice(0, offset).trim();
  const secondText = segment.currentText.slice(offset).trim();
  if (!firstText || !secondText) {
    return { ok: false, error: "Both halves of a split must contain text" };
  }
  const secondLabel = input.secondSpeakerLabel?.trim() || segment.currentSpeakerLabel;

  const next = await prisma.meetingTranscriptSegment.findFirst({
    where: { meetingId, bidId, isActive: true, sortKey: { gt: segment.sortKey } },
    orderBy: { sortKey: "asc" },
    select: { sortKey: true },
  });
  const upperBound = next?.sortKey ?? segment.sortKey + 1;
  const midKey = segment.sortKey + (upperBound - segment.sortKey) / 2;

  const secondParticipant = secondLabel
    ? await prisma.meetingParticipant.findFirst({
        where: { meetingId, speakerLabel: secondLabel },
        select: { id: true },
      })
    : null;

  await prisma.$transaction(async (tx) => {
    // Original row is deactivated, NEVER deleted — citations keep resolving
    // and originalText/rawTranscript remain the immutable record.
    await tx.meetingTranscriptSegment.update({
      where: { id: segment.id },
      data: { isActive: false },
    });
    await tx.meetingTranscriptSegment.create({
      data: {
        meetingId,
        bidId,
        segmentIndex: segment.segmentIndex,
        sortKey: segment.sortKey,
        startSec: segment.startSec,
        endSec: segment.endSec,
        originalSpeakerLabel: segment.originalSpeakerLabel,
        originalText: segment.originalText,
        currentSpeakerLabel: segment.currentSpeakerLabel,
        currentText: firstText,
        splitFromSegmentId: segment.id,
        participantId: segment.participantId,
      },
    });
    await tx.meetingTranscriptSegment.create({
      data: {
        meetingId,
        bidId,
        segmentIndex: segment.segmentIndex,
        sortKey: midKey,
        startSec: segment.startSec,
        endSec: segment.endSec,
        originalSpeakerLabel: segment.originalSpeakerLabel,
        originalText: segment.originalText,
        currentSpeakerLabel: secondLabel,
        currentText: secondText,
        splitFromSegmentId: segment.id,
        participantId: secondParticipant?.id ?? null,
      },
    });
  });

  const affected = await computeAffectedDerived(meetingId, {
    speakerLabel: segment.currentSpeakerLabel,
    segmentId: segment.id,
  });
  return record(
    bidId,
    meetingId,
    {
      correctionType: "SPLIT_SEGMENT",
      segmentId: segment.id,
      fromValue: segment.currentText,
      toValue: `${firstText} || ${secondText}`,
    },
    1,
    affected,
    correctedBy,
    reason,
    actor
  );
}

async function markUnknown(
  bidId: number,
  meetingId: number,
  input: CorrectionInput,
  correctedBy: string,
  reason: string | null,
  actor: Actor
): Promise<OpResult> {
  if (input.segmentId) {
    const segment = await getSegment(meetingId, bidId, input.segmentId);
    if (!segment) return { ok: false, error: "Segment not found" };
    await prisma.meetingTranscriptSegment.update({
      where: { id: segment.id },
      data: { isUnknownSpeaker: true, participantId: null },
    });
    const affected = await computeAffectedDerived(meetingId, { segmentId: segment.id });
    return record(
      bidId,
      meetingId,
      {
        correctionType: "MARK_UNKNOWN",
        segmentId: segment.id,
        fromValue: segment.currentSpeakerLabel,
        toValue: "[UNKNOWN]",
      },
      1,
      affected,
      correctedBy,
      reason,
      actor
    );
  }
  const label = input.fromSpeakerLabel?.trim();
  if (!label) return { ok: false, error: "segmentId or fromSpeakerLabel is required" };
  const affected = await computeAffectedDerived(meetingId, { speakerLabel: label });
  const updated = await prisma.meetingTranscriptSegment.updateMany({
    where: { meetingId, bidId, isActive: true, currentSpeakerLabel: label },
    data: { isUnknownSpeaker: true, participantId: null },
  });
  return record(
    bidId,
    meetingId,
    { correctionType: "MARK_UNKNOWN", fromValue: label, toValue: "[UNKNOWN]" },
    updated.count,
    affected,
    correctedBy,
    reason,
    actor
  );
}

async function editText(
  bidId: number,
  meetingId: number,
  input: CorrectionInput,
  correctedBy: string,
  reason: string | null,
  actor: Actor
): Promise<OpResult> {
  const newText = input.newText?.trim();
  if (!newText) return { ok: false, error: "newText is required" };
  const segment = await getSegment(meetingId, bidId, input.segmentId);
  if (!segment) return { ok: false, error: "Segment not found" };

  await prisma.meetingTranscriptSegment.update({
    where: { id: segment.id },
    data: { currentText: newText },
  });
  const affected = await computeAffectedDerived(meetingId, { segmentId: segment.id });
  return record(
    bidId,
    meetingId,
    {
      correctionType: "EDIT_TEXT",
      segmentId: segment.id,
      fromValue: segment.currentText,
      toValue: newText,
    },
    1,
    affected,
    correctedBy,
    reason,
    actor
  );
}

export async function listCorrections(bidId: number, meetingId: number) {
  return prisma.meetingTranscriptCorrection.findMany({
    where: { meetingId, bidId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

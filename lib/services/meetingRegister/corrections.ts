// lib/services/meetingRegister/corrections.ts
//
// Module R2-B1 — audited diarization + transcript corrections.
//
// Every operation runs as ONE database transaction that contains ALL of:
//   (1) the overlay mutation (current* columns only — original* columns and
//       Meeting.rawTranscript are never touched),
//   (2) the append-only MeetingTranscriptCorrection history row (author /
//       reason / bounded before-after values / affected derived ids),
//   (3) the derived display-transcript rebuild (so a later extraction rerun
//       sees the corrections — R2 rules 5–7), and
//   (4) the mandatory AuditEvent row (GroundWorX audit policy — fail-closed).
// If ANY of those writes fails, the whole correction rolls back: no
// correction can exist without its history record, and no history record
// can claim a correction that did not occur. Stdout telemetry is emitted
// only after commit. A session actor is REQUIRED for every op.

import { prisma } from "@/lib/prisma";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";
import { rebuildDisplayTranscript } from "./segments";
import { emitRegisterAuditPostCommit, writeRegisterAuditTx } from "./txAudit";
import {
  type Actor,
  type CorrectionType,
  type ServiceResult,
  actorLabel,
  bound,
} from "./types";

type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

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

async function findMeeting(bidId: number, meetingId: number) {
  return prisma.meeting.findFirst({
    where: { id: meetingId, bidId },
    select: { id: true },
  });
}

type OpResult = ServiceResult<{
  correctionId: number;
  affectedSegmentCount: number;
  affected: AffectedDerived;
}>;

type CorrectionRecord = {
  correctionType: CorrectionType;
  segmentId?: number | null;
  fromValue?: string | null;
  toValue?: string | null;
};

/**
 * Run one correction atomically: the op's mutations, the append-only
 * correction row, the derived display-transcript rebuild and the mandatory
 * AuditEvent row all commit together or not at all.
 */
async function commitCorrection(args: {
  bidId: number;
  meetingId: number;
  record: CorrectionRecord;
  affected: AffectedDerived;
  correctedBy: string;
  reason: string | null;
  actor: Actor;
  /** Perform the overlay mutations; returns the affected segment count. */
  mutate: (tx: PrismaTx) => Promise<number>;
}): Promise<OpResult> {
  const { bidId, meetingId, record, affected, correctedBy, reason, actor } = args;
  let envelope: AuditEnvelope | null = null;
  const result = await prisma.$transaction(async (tx) => {
    const affectedSegmentCount = await args.mutate(tx);
    const correction = await tx.meetingTranscriptCorrection.create({
      data: {
        meetingId,
        bidId,
        correctionType: record.correctionType,
        segmentId: record.segmentId ?? null,
        fromValue: bound(record.fromValue, 500),
        toValue: bound(record.toValue, 500),
        affectedSegmentCount,
        affectedDerivedJson: JSON.stringify(affected),
        reason,
        correctedBy,
      },
    });
    await rebuildDisplayTranscript(bidId, meetingId, tx);
    envelope = await writeRegisterAuditTx(tx, {
      action: "transcript_corrected",
      decision: "corrected",
      subjectKind: "MeetingTranscriptCorrection",
      subjectId: correction.id,
      actor,
      // ids/counts only — never transcript text.
      payload: {
        bidId,
        meetingId,
        correctionId: correction.id,
        correctionType: record.correctionType,
        segmentId: record.segmentId ?? null,
        affectedSegmentCount,
        affectedRegisterEntries: affected.registerEntryIds.length,
      },
    });
    return { correctionId: correction.id, affectedSegmentCount };
  });
  emitRegisterAuditPostCommit(envelope);
  return { ok: true, value: { ...result, affected } };
}

export async function applyCorrection(
  bidId: number,
  meetingId: number,
  input: CorrectionInput,
  actor: Actor
): Promise<OpResult> {
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
    select: { id: true },
  });
  const affected = await computeAffectedDerived(meetingId, { speakerLabel: label });

  return commitCorrection({
    bidId,
    meetingId,
    record: { correctionType: "RENAME_SPEAKER", fromValue: label, toValue: newName },
    affected,
    correctedBy,
    reason,
    actor,
    mutate: async (tx) => {
      if (participant) {
        await tx.meetingParticipant.update({
          where: { id: participant.id },
          data: { name: newName },
        });
      } else {
        await tx.meetingParticipant.create({
          data: { meetingId, name: newName, speakerLabel: label },
        });
      }
      // Update the register entries' display name (attribution correction).
      if (affected.registerEntryIds.length > 0) {
        await tx.meetingRegisterEntry.updateMany({
          where: { id: { in: affected.registerEntryIds }, speakerLabel: label },
          data: { speakerName: newName },
        });
      }
      return 0;
    },
  });
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
  const affected = await computeAffectedDerived(meetingId, {
    speakerLabel: segment.currentSpeakerLabel,
    segmentId: segment.id,
  });

  return commitCorrection({
    bidId,
    meetingId,
    record: {
      correctionType: "REASSIGN_SEGMENT",
      segmentId: segment.id,
      fromValue: segment.currentSpeakerLabel,
      toValue: toLabel,
    },
    affected,
    correctedBy,
    reason,
    actor,
    mutate: async (tx) => {
      await tx.meetingTranscriptSegment.update({
        where: { id: segment.id },
        data: {
          currentSpeakerLabel: toLabel,
          participantId: participant?.id ?? null,
          isUnknownSpeaker: false,
        },
      });
      return 1;
    },
  });
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

  return commitCorrection({
    bidId,
    meetingId,
    record: {
      correctionType: "REASSIGN_ALL_MATCHING",
      fromValue: fromLabel,
      toValue: toLabel,
    },
    affected,
    correctedBy,
    reason,
    actor,
    mutate: async (tx) => {
      const updated = await tx.meetingTranscriptSegment.updateMany({
        where: { meetingId, bidId, isActive: true, currentSpeakerLabel: fromLabel },
        data: {
          currentSpeakerLabel: toLabel,
          participantId: participant?.id ?? null,
          isUnknownSpeaker: false,
        },
      });
      return updated.count;
    },
  });
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

  return commitCorrection({
    bidId,
    meetingId,
    record: { correctionType: "MERGE_SPEAKERS", fromValue: fromLabel, toValue: intoLabel },
    affected,
    correctedBy,
    reason,
    actor,
    mutate: async (tx) => {
      const updated = await tx.meetingTranscriptSegment.updateMany({
        where: { meetingId, bidId, isActive: true, currentSpeakerLabel: fromLabel },
        data: {
          currentSpeakerLabel: intoLabel,
          participantId: intoParticipant?.id ?? null,
          isUnknownSpeaker: false,
        },
      });
      return updated.count;
    },
  });
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

  const affected = await computeAffectedDerived(meetingId, {
    speakerLabel: segment.currentSpeakerLabel,
    segmentId: segment.id,
  });

  return commitCorrection({
    bidId,
    meetingId,
    record: {
      correctionType: "SPLIT_SEGMENT",
      segmentId: segment.id,
      fromValue: segment.currentText,
      toValue: `${firstText} || ${secondText}`,
    },
    affected,
    correctedBy,
    reason,
    actor,
    mutate: async (tx) => {
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
      return 1;
    },
  });
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
    const affected = await computeAffectedDerived(meetingId, { segmentId: segment.id });
    return commitCorrection({
      bidId,
      meetingId,
      record: {
        correctionType: "MARK_UNKNOWN",
        segmentId: segment.id,
        fromValue: segment.currentSpeakerLabel,
        toValue: "[UNKNOWN]",
      },
      affected,
      correctedBy,
      reason,
      actor,
      mutate: async (tx) => {
        await tx.meetingTranscriptSegment.update({
          where: { id: segment.id },
          data: { isUnknownSpeaker: true, participantId: null },
        });
        return 1;
      },
    });
  }
  const label = input.fromSpeakerLabel?.trim();
  if (!label) return { ok: false, error: "segmentId or fromSpeakerLabel is required" };
  const affected = await computeAffectedDerived(meetingId, { speakerLabel: label });
  return commitCorrection({
    bidId,
    meetingId,
    record: { correctionType: "MARK_UNKNOWN", fromValue: label, toValue: "[UNKNOWN]" },
    affected,
    correctedBy,
    reason,
    actor,
    mutate: async (tx) => {
      const updated = await tx.meetingTranscriptSegment.updateMany({
        where: { meetingId, bidId, isActive: true, currentSpeakerLabel: label },
        data: { isUnknownSpeaker: true, participantId: null },
      });
      return updated.count;
    },
  });
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

  const affected = await computeAffectedDerived(meetingId, { segmentId: segment.id });
  return commitCorrection({
    bidId,
    meetingId,
    record: {
      correctionType: "EDIT_TEXT",
      segmentId: segment.id,
      fromValue: segment.currentText,
      toValue: newText,
    },
    affected,
    correctedBy,
    reason,
    actor,
    mutate: async (tx) => {
      await tx.meetingTranscriptSegment.update({
        where: { id: segment.id },
        data: { currentText: newText },
      });
      return 1;
    },
  });
}

export async function listCorrections(bidId: number, meetingId: number) {
  return prisma.meetingTranscriptCorrection.findMany({
    where: { meetingId, bidId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

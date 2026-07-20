// lib/services/meetingRegister/minutes.ts
//
// Module R2-B1 — minutes publication and amendment (R2 rule 9).
//
// Draft minutes = the live Meeting analysis fields + current register
// state. PUBLISH freezes a snapshot into MeetingMinutesRevision (immutable
// at every layer — see lib/prisma.ts extension). Publication is gated on
// the fully-reviewed rule: no undispositioned extracted register entries.
// AMEND appends revision n+1 with a required reason; prior revisions are
// never edited or deleted.

import { prisma } from "@/lib/prisma";
import type { AuditEnvelope } from "@/lib/observability/taxonomy";
import { getCoverage } from "./register";
import { emitRegisterAuditPostCommit, writeRegisterAuditTx } from "./txAudit";
import {
  historyMaterializationError,
  withMeetingHistoryMaterialization,
} from "./retention";
import { SUPERSEDED_STATE, actorLabel, type Actor, type ServiceResult } from "./types";

export async function listRevisions(bidId: number, meetingId: number) {
  return prisma.meetingMinutesRevision.findMany({
    where: { meetingId, bidId },
    orderBy: { revisionIndex: "desc" },
    select: {
      id: true,
      revisionIndex: true,
      publishedBy: true,
      publishedAt: true,
      amendmentReason: true,
      supersedesRevisionId: true,
      contentJson: true,
    },
  });
}

function parseJsonArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function publishMinutes(
  bidId: number,
  meetingId: number,
  input: { amendmentReason?: string },
  actor: Actor
): Promise<ServiceResult<{ revisionId: number; revisionIndex: number }>> {
  const publishedBy = actorLabel(actor);
  if (!publishedBy) return { ok: false, error: "A session actor is required to publish" };

  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, bidId },
    select: {
      id: true,
      title: true,
      meetingDate: true,
      summary: true,
      keyDecisions: true,
      openIssues: true,
      redFlags: true,
      analysisVersion: true,
      reviewStatus: true,
    },
  });
  if (!meeting) return { ok: false, error: "Not found" };

  // R2 rule 11 gate — a meeting cannot become fully reviewed (and its
  // minutes cannot publish) while extracted entries are undispositioned.
  const coverage = await getCoverage(bidId, meetingId);
  if (!coverage.fullyReviewed) {
    return {
      ok: false,
      error: `Cannot publish: ${coverage.pendingExtracted} extracted register ${
        coverage.pendingExtracted === 1 ? "entry is" : "entries are"
      } undispositioned`,
    };
  }

  const prior = await prisma.meetingMinutesRevision.findFirst({
    where: { meetingId, bidId },
    orderBy: { revisionIndex: "desc" },
    select: { id: true, revisionIndex: true },
  });
  const revisionIndex = prior ? prior.revisionIndex + 1 : 0;
  const amendmentReason = input.amendmentReason?.trim().slice(0, 500) || null;
  if (revisionIndex > 0 && !amendmentReason) {
    return { ok: false, error: "An amendment reason is required to republish minutes" };
  }

  const [entries, participants, correctionCount, supersededCount] = await Promise.all([
    prisma.meetingRegisterEntry.findMany({
      // Superseded entries are rerun history, not meeting content — the
      // published record reflects the active register (their count is
      // snapshotted below so provenance stays visible).
      where: { meetingId, bidId, reviewState: { not: SUPERSEDED_STATE } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        entryType: true,
        reviewState: true,
        normalizedText: true,
        sourceCitation: true,
        speakerName: true,
        responsibleParty: true,
        dueDate: true,
        linkedTrackedItemId: true,
      },
    }),
    prisma.meetingParticipant.findMany({
      where: { meetingId, isActive: true },
      select: { name: true, role: true, company: true, speakerLabel: true },
    }),
    prisma.meetingTranscriptCorrection.count({ where: { meetingId, bidId } }),
    prisma.meetingRegisterEntry.count({
      where: { meetingId, bidId, reviewState: SUPERSEDED_STATE },
    }),
  ]);

  const contentJson = JSON.stringify({
    title: meeting.title,
    meetingDate: meeting.meetingDate,
    summary: meeting.summary ?? "",
    keyDecisions: parseJsonArray(meeting.keyDecisions),
    openIssues: parseJsonArray(meeting.openIssues),
    redFlags: parseJsonArray(meeting.redFlags),
    participants,
    registerEntries: entries,
    correctionCount,
    supersededEntryCount: supersededCount,
    analysisVersion: meeting.analysisVersion,
  });

  let envelope: AuditEnvelope | null = null;
  const committed = await withMeetingHistoryMaterialization(bidId, meetingId, async (tx) => {
    const created = await tx.meetingMinutesRevision.create({
      data: {
        meetingId,
        bidId,
        revisionIndex,
        contentJson,
        publishedBy,
        amendmentReason,
        supersedesRevisionId: prior?.id ?? null,
      },
    });
    await tx.meeting.update({
      where: { id: meetingId },
      data: { reviewStatus: "PUBLISHED", publishedAt: new Date() },
    });
    envelope = await writeRegisterAuditTx(tx, {
      action: revisionIndex === 0 ? "minutes_published" : "minutes_amended",
      decision: revisionIndex === 0 ? "published" : "amended",
      subjectKind: "MeetingMinutesRevision",
      subjectId: created.id,
      actor,
      payload: {
        bidId,
        meetingId,
        revisionId: created.id,
        revisionIndex,
        supersedesRevisionId: prior?.id ?? null,
        entryCount: entries.length,
        correctionCount,
        hasAmendmentReason: Boolean(amendmentReason),
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
  return { ok: true, value: { revisionId: committed.value.id, revisionIndex } };
}

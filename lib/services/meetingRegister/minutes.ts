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
import { emitAuditEvent } from "@/lib/observability/audit";
import { getCoverage } from "./register";
import { actorLabel, type Actor, type ServiceResult } from "./types";

async function audit(
  action: string,
  bidId: number,
  revisionId: number,
  actor: Actor,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await emitAuditEvent({
      category: "register_action",
      action,
      severity: "NOTICE",
      decision: "published",
      subject: { kind: "MeetingMinutesRevision", id: String(revisionId) },
      actor: { kind: "operator", userId: null, email: actor?.email ?? null },
      payload: { bidId, ...payload },
    });
  } catch (err) {
    console.error(
      "[meetingRegister/minutes] audit emit failed (action continues):",
      err instanceof Error ? err.message : err
    );
  }
}

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

  const [entries, participants, correctionCount] = await Promise.all([
    prisma.meetingRegisterEntry.findMany({
      where: { meetingId, bidId },
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
      where: { meetingId },
      select: { name: true, role: true, company: true, speakerLabel: true },
    }),
    prisma.meetingTranscriptCorrection.count({ where: { meetingId, bidId } }),
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
    analysisVersion: meeting.analysisVersion,
  });

  const revision = await prisma.$transaction(async (tx) => {
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
    return created;
  });

  await audit(
    revisionIndex === 0 ? "minutes_published" : "minutes_amended",
    bidId,
    revision.id,
    actor,
    {
      meetingId,
      revisionIndex,
      entryCount: entries.length,
      correctionCount,
      hasAmendmentReason: Boolean(amendmentReason),
    }
  );
  return { ok: true, value: { revisionId: revision.id, revisionIndex } };
}

// GET    /api/bids/[id]/meetings/[meetingId]
//   Returns full meeting detail including participants, transcript,
//   summary, key decisions, risks, follow-up items.
//
// PATCH  /api/bids/[id]/meetings/[meetingId]
//   Update editable fields: title, meetingDate, meetingType, location,
//   status, transcript (manual entry), summary.
//
// DELETE /api/bids/[id]/meetings/[meetingId]
//   Deletes meeting and all related participants + action items (cascade).

import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { Prisma } from "@prisma/client";
import path from "node:path";
import {
  deleteMeetingWithoutHistory,
  DURABLE_HISTORY_CONFLICT,
  FROZEN_TRANSCRIPT_CONFLICT,
  withMutableMeetingTranscript,
} from "@/lib/services/meetingRegister/retention";
import {
  emitRegisterAuditPostCommit,
  writeRegisterAuditTx,
} from "@/lib/services/meetingRegister/txAudit";
import { deleteMeetingStorageIfUnreferenced } from "@/lib/services/storage/referenceSafety";

const VALID_TYPES = new Set([
  "GENERAL", "OAC", "SUBCONTRACTOR", "PRECONSTRUCTION", "SAFETY", "KICKOFF",
]);
const VALID_STATUSES = new Set([
  "PENDING", "UPLOADING", "TRANSCRIBING", "AWAITING_NAMES", "ANALYZING", "READY", "FAILED",
]);
const VALID_REVIEW_STATUSES = new Set(["DRAFT", "IN_REVIEW", "PUBLISHED"]);

const safeArr = (raw: string | null): unknown[] => {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const meeting = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    include: {
      participants: {
        where: { isActive: true },
        include: { projectContact: { select: { id: true, name: true, role: true } } },
        orderBy: { id: "asc" },
      },
      actionItems: {
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({
    id: meeting.id,
    bidId: meeting.bidId,
    title: meeting.title,
    meetingDate: meeting.meetingDate.toISOString(),
    meetingType: meeting.meetingType,
    location: meeting.location,
    status: meeting.status,
    audioFileName: meeting.audioFileName,
    durationSeconds: meeting.durationSeconds,
    transcriptionSource: meeting.transcriptionSource,
    transcriptionJobId: meeting.transcriptionJobId,
    transcript: meeting.transcript,
    summary: meeting.summary,
    keyDecisions: safeArr(meeting.keyDecisions),
    openIssues: safeArr(meeting.openIssues),
    redFlags: safeArr(meeting.redFlags),
    analysisVersion: meeting.analysisVersion,
    reviewStatus: meeting.reviewStatus,
    processingMode: meeting.processingMode,
    speakerMapping: meeting.speakerMapping ?? null,
    uploadedAt: meeting.uploadedAt?.toISOString() ?? null,
    analyzedAt: meeting.analyzedAt?.toISOString() ?? null,
    createdAt: meeting.createdAt.toISOString(),
    updatedAt: meeting.updatedAt.toISOString(),
    participants: meeting.participants.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      company: p.company,
      speakerLabel: p.speakerLabel,
      projectContactId: p.projectContactId,
      projectContact: p.projectContact,
      confidence: p.confidence,
      isGcTeam: p.isGcTeam,
      speakerType: p.speakerType,
    })),
    actionItems: meeting.actionItems.map((a) => ({
      id: a.id,
      meetingId: a.meetingId,
      description: a.description,
      assignedToId: a.assignedToId,
      assignedToName: a.assignedToName,
      dueDate: a.dueDate?.toISOString() ?? null,
      priority: a.priority,
      status: a.status,
      sourceText: a.sourceText,
      closedAt: a.closedAt?.toISOString() ?? null,
      notes: a.notes,
      isGcTask: a.isGcTask,
      carriedFromDate: a.carriedFromDate,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const body = (await request.json()) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  const transcript = body.transcript;

  if (body.title !== undefined) data.title = String(body.title).trim();
  if (body.location !== undefined) data.location = body.location ? String(body.location).trim() : null;
  if (body.meetingDate !== undefined) {
    const d = new Date(String(body.meetingDate));
    if (!isNaN(d.getTime())) data.meetingDate = d;
  }
  if (body.meetingType !== undefined) {
    const t = String(body.meetingType).toUpperCase();
    if (VALID_TYPES.has(t)) data.meetingType = t;
  }
  if (body.status !== undefined) {
    const s = String(body.status).toUpperCase();
    if (VALID_STATUSES.has(s)) data.status = s;
  }
  if (body.transcriptionJobId !== undefined)
    data.transcriptionJobId = body.transcriptionJobId ?? null;
  if (body.reviewStatus !== undefined) {
    const rs = String(body.reviewStatus).toUpperCase();
    if (VALID_REVIEW_STATUSES.has(rs)) data.reviewStatus = rs;
  }
  if (transcript !== undefined) {
    if (typeof transcript !== "string" || !transcript.trim()) {
      return Response.json(
        { error: "Manual transcript initialization requires non-empty transcript text" },
        { status: 400 },
      );
    }
    data.transcript = transcript;
  }
  if (body.summary !== undefined) data.summary = body.summary ?? null;

  if (transcript !== undefined) {
    const guarded = await withMutableMeetingTranscript(bidId, mId, async (tx) => {
      const existing = await tx.meeting.findFirst({
        where: { id: mId, bidId },
        select: {
          id: true,
          transcript: true,
          status: true,
          analysisVersion: true,
          analyzedAt: true,
          reviewStatus: true,
        },
      });
      if (!existing) return { kind: "not-found" as const };
      const explicitPreAnalysisState =
        (existing.status === "PENDING" || existing.status === "FAILED") &&
        existing.analysisVersion === 0 &&
        existing.analyzedAt === null &&
        existing.reviewStatus === "DRAFT" &&
        !existing.transcript;
      if (!explicitPreAnalysisState) {
        return { kind: "conflict" as const };
      }

      await tx.meeting.update({ where: { id: mId }, data });
      const audit = await writeRegisterAuditTx(tx, {
        action: "meeting.transcript_initialized",
        decision: "committed",
        subjectKind: "Meeting",
        subjectId: mId,
        actor: access.user,
        payload: {
          bidId,
          transcriptLength: transcript.length,
          changedFields: Object.keys(data).sort(),
        },
      });
      return { kind: "committed" as const, audit };
    });
    if (!guarded.ok) {
      if (guarded.reason === "not-found") {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      return Response.json({ error: FROZEN_TRANSCRIPT_CONFLICT }, { status: 409 });
    }
    const outcome = guarded.value;
    if (outcome.kind === "not-found") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (outcome.kind === "conflict") {
      return Response.json(
        {
          error:
            "Whole-transcript mutation is locked after materialization or analysis. Use audited segment corrections.",
        },
        { status: 409 },
      );
    }
    emitRegisterAuditPostCommit(outcome.audit);
    return Response.json({ ok: true });
  }

  // Status/job controls are transcript-source controls: after durable
  // materialization they must not be used to re-arm a poll-based overwrite.
  if ("status" in data || "transcriptionJobId" in data) {
    const guarded = await withMutableMeetingTranscript(bidId, mId, async (tx) => {
      await tx.meeting.update({ where: { id: mId }, data });
      return writeRegisterAuditTx(tx, {
        action: "meeting.transcription_state_updated",
        decision: "committed",
        subjectKind: "Meeting",
        subjectId: mId,
        actor: access.user,
        payload: { bidId, changedFields: Object.keys(data).sort() },
      });
    });
    if (!guarded.ok) {
      return Response.json(
        {
          error: guarded.reason === "not-found" ? "Not found" : FROZEN_TRANSCRIPT_CONFLICT,
        },
        { status: guarded.reason === "not-found" ? 404 : 409 },
      );
    }
    emitRegisterAuditPostCommit(guarded.value);
    return Response.json({ ok: true });
  }

  const existing = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    select: { id: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  await prisma.meeting.update({ where: { id: mId }, data });
  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  try {
    const result = await deleteMeetingWithoutHistory(bidId, mId);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    const mediaRef =
      result.audioStorageKey ??
      (result.audioFileName
        ? path.join(
            process.cwd(),
            "uploads",
            "meetings",
            String(mId),
            result.audioFileName,
          )
        : null);
    if (mediaRef) {
      await deleteMeetingStorageIfUnreferenced(mediaRef, bidId, mId).catch((err) => {
        console.error("[meetings/delete] unreferenced media cleanup failed:", err);
      });
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return Response.json({ error: DURABLE_HISTORY_CONFLICT }, { status: 409 });
    }
    throw error;
  }
}

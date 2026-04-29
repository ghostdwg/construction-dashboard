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

  const meeting = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    include: {
      participants: {
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

  const existing = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    select: { id: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json()) as Record<string, unknown>;
  const data: Record<string, unknown> = {};

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
  if (body.transcript !== undefined) data.transcript = body.transcript ?? null;
  if (body.summary !== undefined) data.summary = body.summary ?? null;

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

  const existing = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    select: { id: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  await prisma.meeting.delete({ where: { id: mId } });
  return Response.json({ ok: true });
}

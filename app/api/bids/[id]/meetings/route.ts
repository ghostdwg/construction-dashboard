// GET  /api/bids/[id]/meetings
//   Returns all meetings for the bid with participant counts and open action
//   item counts. Sorted by meetingDate desc.
//
// POST /api/bids/[id]/meetings
//   Create a new meeting. Body: { title, meetingDate, meetingType?, location? }

import { prisma } from "@/lib/prisma";

const VALID_TYPES = new Set([
  "GENERAL", "OAC", "SUBCONTRACTOR", "PRECONSTRUCTION", "SAFETY", "KICKOFF",
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const meetings = await prisma.meeting.findMany({
    where: { bidId },
    include: {
      _count: { select: { participants: true, actionItems: true } },
      actionItems: { where: { status: "OPEN" }, select: { id: true } },
    },
    orderBy: { meetingDate: "desc" },
  });

  return Response.json({
    meetings: meetings.map((m) => ({
      id: m.id,
      title: m.title,
      meetingDate: m.meetingDate.toISOString(),
      meetingType: m.meetingType,
      location: m.location,
      status: m.status,
      audioFileName: m.audioFileName,
      durationSeconds: m.durationSeconds,
      transcriptionSource: m.transcriptionSource,
      hasSummary: !!m.summary,
      participantCount: m._count.participants,
      actionItemCount: m._count.actionItems,
      openActionItemCount: m.actionItems.length,
      uploadedAt: m.uploadedAt?.toISOString() ?? null,
      analyzedAt: m.analyzedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const body = (await request.json()) as {
    title?: string;
    meetingDate?: string;
    meetingType?: string;
    location?: string;
  };

  if (!body.title?.trim())
    return Response.json({ error: "title is required" }, { status: 400 });
  if (!body.meetingDate)
    return Response.json({ error: "meetingDate is required" }, { status: 400 });

  const meetingDate = new Date(body.meetingDate);
  if (isNaN(meetingDate.getTime()))
    return Response.json({ error: "Invalid meetingDate" }, { status: 400 });

  const meetingType = body.meetingType?.toUpperCase() ?? "GENERAL";
  if (!VALID_TYPES.has(meetingType))
    return Response.json({ error: "Invalid meetingType" }, { status: 400 });

  const meeting = await prisma.meeting.create({
    data: {
      bidId,
      title: body.title.trim(),
      meetingDate,
      meetingType,
      location: body.location?.trim() || null,
      status: "PENDING",
    },
  });

  return Response.json({ ok: true, id: meeting.id });
}

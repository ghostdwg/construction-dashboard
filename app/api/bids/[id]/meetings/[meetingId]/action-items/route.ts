// GET  /api/bids/[id]/meetings/[meetingId]/action-items
//   Returns all action items for the meeting.
//
// POST /api/bids/[id]/meetings/[meetingId]/action-items
//   Manually create an action item. Body: { description, assignedToName?,
//   dueDate?, priority?, notes? }

import { prisma } from "@/lib/prisma";

const VALID_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const items = await prisma.meetingActionItem.findMany({
    where: { meetingId: mId, bidId },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });

  return Response.json({
    actionItems: items.map((a) => ({
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
      createdAt: a.createdAt.toISOString(),
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const bidId = parseInt(id, 10);
  const mId = parseInt(meetingId, 10);
  if (isNaN(bidId) || isNaN(mId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const meeting = await prisma.meeting.findFirst({
    where: { id: mId, bidId },
    select: { id: true },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json()) as {
    description?: string;
    assignedToName?: string | null;
    assignedToId?: number | null;
    dueDate?: string | null;
    priority?: string;
    notes?: string | null;
  };

  if (!body.description?.trim())
    return Response.json({ error: "description is required" }, { status: 400 });

  const priority = (body.priority ?? "MEDIUM").toUpperCase();
  if (!VALID_PRIORITIES.has(priority))
    return Response.json({ error: "Invalid priority" }, { status: 400 });

  const item = await prisma.meetingActionItem.create({
    data: {
      bidId,
      meetingId: mId,
      description: body.description.trim(),
      assignedToName: body.assignedToName?.trim() || null,
      assignedToId: body.assignedToId ?? null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      priority,
      status: "OPEN",
      notes: body.notes?.trim() || null,
    },
  });

  return Response.json({ ok: true, id: item.id });
}

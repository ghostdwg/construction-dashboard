// GET /api/bids/[id]/action-items
// Returns all open and in-progress action items across all meetings for a bid.
// Includes meeting context (title, type, date). Sorted by priority then due date.

import { prisma } from "@/lib/prisma";

const PRIORITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const items = await prisma.meetingActionItem.findMany({
    where: {
      bidId,
      status: { in: ["OPEN", "IN_PROGRESS"] },
    },
    include: {
      meeting: {
        select: { id: true, title: true, meetingDate: true, meetingType: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const sorted = items.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.getTime() - b.dueDate.getTime();
  });

  return Response.json({
    actionItems: sorted.map((item) => ({
      id: item.id,
      meetingId: item.meetingId,
      meetingTitle: item.meeting?.title ?? null,
      meetingType: item.meeting?.meetingType ?? null,
      meetingDate: item.meeting?.meetingDate?.toISOString() ?? null,
      description: item.description,
      assignedToName: item.assignedToName,
      dueDate: item.dueDate?.toISOString() ?? null,
      priority: item.priority,
      status: item.status,
      notes: item.notes,
      createdAt: item.createdAt.toISOString(),
    })),
    total: sorted.length,
  });
}

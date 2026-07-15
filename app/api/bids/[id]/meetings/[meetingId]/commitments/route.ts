// Module OPS7 — list one meeting's commitments. PROPOSED first, then OPEN
// (derived-overdue flagged), FULFILLED, DISMISSED. requireBidAccess +
// cross-project 404, matching every meeting route.

import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { isOverdue } from "@/lib/services/meetings/commitments";

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
    select: { id: true },
  });
  if (!meeting) return Response.json({ error: "Not found" }, { status: 404 });

  const rows = await prisma.meetingCommitment.findMany({
    where: { meetingId: mId, bidId },
    orderBy: { createdAt: "asc" },
    include: {
      linkedActionItem: { select: { id: true, description: true, status: true } },
    },
  });

  const order = { PROPOSED: 0, OPEN: 1, FULFILLED: 2, DISMISSED: 3 } as Record<string, number>;
  rows.sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4) || a.id - b.id);

  return Response.json({
    commitments: rows.map((c) => ({ ...c, overdue: isOverdue(c) })),
  });
}

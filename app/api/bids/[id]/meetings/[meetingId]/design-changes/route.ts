// Module OPS5 — Design Log: list one meeting's design intent changes.
//
// GET …/meetings/[meetingId]/design-changes
//
// PROPOSED first (awaiting human review), then CONFIRMED/DISMISSED,
// chronological within each. Rows are written only by the analyze
// pass (PROPOSED) — confirmation/dismissal happens on the [dcId] routes.

import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";

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

  const rows = await prisma.designIntentChange.findMany({
    where: { meetingId: mId, bidId },
    orderBy: { createdAt: "asc" },
    include: {
      linkedItem: { select: { id: true, title: true, status: true } },
    },
  });

  // Review ordering: PROPOSED first, then CONFIRMED, then DISMISSED.
  const order = { PROPOSED: 0, CONFIRMED: 1, DISMISSED: 2 } as Record<string, number>;
  rows.sort((a, b) => (order[a.state] ?? 3) - (order[b.state] ?? 3) || a.id - b.id);

  return Response.json({ designChanges: rows });
}

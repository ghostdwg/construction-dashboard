// Module OPS7 — bid-wide commitment tracker (cross-meeting). Overdue
// first (derived: OPEN && dueDate < now), then by due date. Read-only.

import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { isOverdue } from "@/lib/services/meetings/commitments";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const rows = await prisma.meetingCommitment.findMany({
    where: { bidId },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    include: {
      meeting: { select: { id: true, title: true, meetingDate: true } },
      linkedActionItem: { select: { id: true, status: true } },
    },
  });

  const withOverdue = rows.map((c) => ({ ...c, overdue: isOverdue(c) }));
  withOverdue.sort((a, b) => Number(b.overdue) - Number(a.overdue));

  const counts = {
    proposed: rows.filter((c) => c.status === "PROPOSED").length,
    open: rows.filter((c) => c.status === "OPEN").length,
    overdue: withOverdue.filter((c) => c.overdue).length,
    fulfilled: rows.filter((c) => c.status === "FULFILLED").length,
    dismissed: rows.filter((c) => c.status === "DISMISSED").length,
  };

  return Response.json({ commitments: withOverdue, counts });
}

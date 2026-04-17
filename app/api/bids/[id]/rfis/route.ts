// GET /api/bids/[id]/rfis
//
// Tier F F3 — Return stored RFI items for this bid.
// RFIs are populated by POST /api/bids/[id]/procore-pull/rfis.
// Returns an empty array if no pull has been run yet.

import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid bid id" }, { status: 400 });

  const rfis = await prisma.rfiItem.findMany({
    where: { bidId },
    orderBy: [{ status: "asc" }, { number: "asc" }],
    select: {
      id: true,
      procoreRfiId: true,
      number: true,
      title: true,
      question: true,
      answer: true,
      status: true,
      priority: true,
      assigneeName: true,
      dueDate: true,
      syncedAt: true,
    },
  });

  return Response.json({ rfis });
}

import { prisma } from "@/lib/prisma";

// GET /api/bids/[id]/submission
// Returns the BidSubmission record for the bid, or { submission: null }.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const submission = await prisma.bidSubmission.findUnique({
    where: { bidId },
  });

  return Response.json({ submission: submission ?? null });
}

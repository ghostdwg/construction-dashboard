import { prisma } from "@/lib/prisma";
import { captureBidSnapshot } from "@/lib/services/bid/captureBidSnapshot";

// POST /api/bids/[id]/submit
// Captures full bid snapshot and creates BidSubmission record.
// Updates Bid.status to "submitted".

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true, status: true, submission: { select: { id: true } } },
  });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  if (bid.submission) {
    return Response.json({ error: "Bid already submitted" }, { status: 409 });
  }

  const body = await request.json().catch(() => ({})) as {
    ourBidAmount?: number;
    submittedBy?: string;
    notes?: string;
  };

  let snapshot;
  try {
    snapshot = await captureBidSnapshot(bidId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Failed to capture snapshot: ${message}` }, { status: 500 });
  }

  const submission = await prisma.bidSubmission.create({
    data: {
      bidId,
      submittedBy: body.submittedBy?.trim() || null,
      ourBidAmount: typeof body.ourBidAmount === "number" ? body.ourBidAmount : null,
      notes: body.notes?.trim() || null,
      briefSnapshot: snapshot.brief ? JSON.stringify(snapshot.brief) : null,
      questionSnapshot: JSON.stringify(snapshot.questions),
      complianceSnapshot: snapshot.compliance ? JSON.stringify(snapshot.compliance) : null,
      spreadSnapshot: JSON.stringify(snapshot.spread),
      intelligenceSnapshot: JSON.stringify(snapshot.intelligence),
    },
  });

  await prisma.bid.update({
    where: { id: bidId },
    data: { status: "submitted" },
  });

  return Response.json({ submission, snapshot });
}

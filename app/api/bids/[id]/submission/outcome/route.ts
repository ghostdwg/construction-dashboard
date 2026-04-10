import { prisma } from "@/lib/prisma";

// PATCH /api/bids/[id]/submission/outcome
// Updates outcome fields on BidSubmission.
// Cascades Bid.status change based on outcome.

const VALID_OUTCOMES = ["won", "lost", "withdrawn", "no_decision"] as const;
const VALID_LOST_REASONS = ["price", "scope", "schedule", "relationship", "other"] as const;

type Outcome = (typeof VALID_OUTCOMES)[number];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const submission = await prisma.bidSubmission.findUnique({
    where: { bidId },
    select: { id: true },
  });
  if (!submission) {
    return Response.json({ error: "No submission found for this bid" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({})) as {
    outcome?: string;
    winningBidAmount?: number;
    ourRank?: number;
    totalBidders?: number;
    lostReason?: string;
    lostReasonNote?: string;
    lessonsLearned?: string;
    outcomeNotes?: string;
  };

  if (body.outcome !== undefined && !(VALID_OUTCOMES as readonly string[]).includes(body.outcome)) {
    return Response.json(
      { error: `outcome must be one of: ${VALID_OUTCOMES.join(", ")}` },
      { status: 400 }
    );
  }
  if (body.lostReason !== undefined && body.lostReason !== "" && !(VALID_LOST_REASONS as readonly string[]).includes(body.lostReason)) {
    return Response.json(
      { error: `lostReason must be one of: ${VALID_LOST_REASONS.join(", ")}` },
      { status: 400 }
    );
  }

  const data: Record<string, unknown> = {};
  if (body.outcome !== undefined) {
    data.outcome = body.outcome;
    data.outcomeAt = new Date();
  }
  if (body.winningBidAmount !== undefined) data.winningBidAmount = body.winningBidAmount;
  if (body.ourRank !== undefined) data.ourRank = body.ourRank;
  if (body.totalBidders !== undefined) data.totalBidders = body.totalBidders;
  if (body.lostReason !== undefined) data.lostReason = body.lostReason || null;
  if (body.lostReasonNote !== undefined) data.lostReasonNote = body.lostReasonNote || null;
  if (body.lessonsLearned !== undefined) data.lessonsLearned = body.lessonsLearned || null;
  if (body.outcomeNotes !== undefined) data.outcomeNotes = body.outcomeNotes || null;

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.bidSubmission.update({
    where: { bidId },
    data,
  });

  // Cascade Bid.status based on outcome
  if (body.outcome) {
    const outcomeToStatus: Record<Outcome, string> = {
      won: "awarded",
      lost: "lost",
      withdrawn: "cancelled",
      no_decision: "submitted",
    };
    const newStatus = outcomeToStatus[body.outcome as Outcome];
    if (newStatus) {
      await prisma.bid.update({
        where: { id: bidId },
        data: { status: newStatus },
      });
    }
  }

  // Compute derived fields
  const bidAccuracy = updated.ourBidAmount && updated.winningBidAmount
    ? Math.round(((updated.ourBidAmount - updated.winningBidAmount) / updated.winningBidAmount) * 1000) / 10
    : null;

  return Response.json({ submission: updated, derived: { bidAccuracyPercent: bidAccuracy } });
}

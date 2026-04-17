// GET /api/bids/[id]/procore-export
//
// Returns a readiness summary: how many rows are available for each export
// category (vendors, budget trade lines, budget GC lines, contacts).
// Consumed by ProcoreTab to show status cards before downloading.

import { prisma } from "@/lib/prisma";

type GcLine = { label: string; costCode: string; amount: number };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid bid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { id: true, budgetGcLines: true },
  });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  const [inviteCount, awardedCount, tradeCount, submittalCount, contactCount, scheduleActivityCount] =
    await Promise.all([
      // Unique invited subs
      prisma.bidInviteSelection.findMany({
        where: { bidId },
        select: { subcontractorId: true },
        distinct: ["subcontractorId"],
      }).then((r) => r.length),

      // Awarded subs (BuyoutItem with subcontractorId)
      prisma.buyoutItem.count({
        where: { bidId, subcontractorId: { not: null } },
      }),

      // Trade lines
      prisma.bidTrade.count({ where: { bidId } }),

      // Submitted submittals (not just draft)
      prisma.submittalItem.count({ where: { bidId } }),

      // Project contacts
      prisma.projectContact.count({ where: { bidId } }),

      // Schedule V2 activities
      prisma.scheduleActivityV2.count({ where: { schedule: { bidId } } }),
    ]);

  // Deduplicated vendor count (invited ∪ awarded)
  const vendorCount = Math.max(inviteCount, awardedCount);

  let gcLineCount = 0;
  if (bid.budgetGcLines) {
    try {
      const parsed = JSON.parse(bid.budgetGcLines) as GcLine[];
      if (Array.isArray(parsed)) gcLineCount = parsed.length;
    } catch {
      // ignore
    }
  }

  return Response.json({
    vendors: vendorCount,
    budgetTradeLines: tradeCount,
    budgetGcLines: gcLineCount,
    submittals: submittalCount,
    contacts: contactCount,
    scheduleActivities: scheduleActivityCount,
  });
}

import { prisma } from "@/lib/prisma";
import { matchSectionThreeState } from "@/lib/documents/specParser";

// POST /api/bids/[id]/specbook/rematch
// Re-runs three-state CSI matching on all existing sections without re-uploading.
// Call this after trades are added/removed from the bid.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const specBook = await prisma.specBook.findFirst({
    where: { bidId },
    orderBy: { uploadedAt: "desc" },
    include: { sections: true },
  });
  if (!specBook) return Response.json({ error: "No spec book found for this bid" }, { status: 404 });

  const [allTrades, bidTrades] = await Promise.all([
    prisma.trade.findMany({ select: { id: true, csiCode: true } }),
    prisma.bidTrade.findMany({ where: { bidId }, select: { tradeId: true } }),
  ]);
  const bidTradeIds = new Set(bidTrades.map((bt) => bt.tradeId));

  // Update each section individually (SQLite has no bulk conditional update)
  let covered = 0;
  let missingFromBid = 0;
  for (const section of specBook.sections) {
    const { tradeId, matchedTradeId } = matchSectionThreeState(
      section.csiNumber,
      allTrades,
      bidTradeIds
    );
    const changed =
      tradeId !== section.tradeId || matchedTradeId !== section.matchedTradeId;
    if (changed) {
      await prisma.specSection.update({
        where: { id: section.id },
        data: { tradeId, matchedTradeId, covered: tradeId !== null },
      });
    }
    if (tradeId !== null) covered++;
    else if (matchedTradeId !== null) missingFromBid++;
  }

  return Response.json({
    total: specBook.sections.length,
    covered,
    missingFromBid,
    unknown: specBook.sections.length - covered - missingFromBid,
  });
}

import { prisma } from "@/lib/prisma";
import { matchSectionToTrade } from "@/lib/documents/specParser";

// POST /api/bids/[id]/specbook/rematch
// Re-runs CSI-to-trade matching on all existing sections without re-uploading.
// Useful after trades are added/changed or the matching logic is updated.
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

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    include: { bidTrades: { include: { trade: { select: { id: true, csiCode: true } } } } },
  });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  const trades = bid.bidTrades.map((bt) => bt.trade);

  // Update each section individually (SQLite has no bulk conditional update)
  let matched = 0;
  for (const section of specBook.sections) {
    const tradeId = matchSectionToTrade(section.csiNumber, trades);
    if (tradeId !== section.tradeId) {
      await prisma.specSection.update({
        where: { id: section.id },
        data: { tradeId, covered: tradeId !== null },
      });
    }
    if (tradeId !== null) matched++;
  }

  return Response.json({
    total: specBook.sections.length,
    matched,
    gaps: specBook.sections.length - matched,
  });
}

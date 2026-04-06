import { prisma } from "@/lib/prisma";

// POST /api/bids/[id]/drawings/rematch
// Re-applies three-state logic to all existing DrawingSheet records.
// Call after bid trades change (e.g. after "Add to Bid" from Documents tab).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const drawingUpload = await prisma.drawingUpload.findFirst({
    where: { bidId },
    orderBy: { uploadedAt: "desc" },
    include: { sheets: true },
  });
  if (!drawingUpload) return Response.json({ matched: 0, total: 0 });

  const bidTrades = await prisma.bidTrade.findMany({
    where: { bidId },
    select: { tradeId: true },
  });
  const bidTradeIds = new Set(bidTrades.map((bt) => bt.tradeId));

  let covered = 0;
  for (const sheet of drawingUpload.sheets) {
    // The "dictionary trade" is whichever of tradeId/matchedTradeId is set
    const dictTradeId = sheet.tradeId ?? sheet.matchedTradeId;
    if (dictTradeId === null) continue;

    const onBid = bidTradeIds.has(dictTradeId);
    const newTradeId = onBid ? dictTradeId : null;
    const newMatchedTradeId = onBid ? null : dictTradeId;

    if (newTradeId !== sheet.tradeId || newMatchedTradeId !== sheet.matchedTradeId) {
      await prisma.drawingSheet.update({
        where: { id: sheet.id },
        data: { tradeId: newTradeId, matchedTradeId: newMatchedTradeId },
      });
    }
    if (onBid) covered++;
  }

  return Response.json({
    total: drawingUpload.sheets.length,
    covered,
    missing: drawingUpload.sheets.length - covered,
  });
}

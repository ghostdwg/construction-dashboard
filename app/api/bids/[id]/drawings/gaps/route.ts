import { prisma } from "@/lib/prisma";

// GET /api/bids/[id]/drawings/gaps
// Returns the most recent DrawingUpload and its coverage summary,
// split into three states per (discipline, trade) record:
//   covered       — tradeId set (trade is on bid)
//   missing       — matchedTradeId set (trade in dictionary, not on bid)
//   unknown       — both null (no dictionary match — shouldn't occur given fixed mapping)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const drawingUpload = await prisma.drawingUpload.findFirst({
    where: { bidId },
    orderBy: { uploadedAt: "desc" },
    include: {
      sheets: {
        orderBy: [{ discipline: "asc" }, { sheetNumber: "asc" }],
        include: {
          trade: { select: { id: true, name: true } },
          matchedTrade: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!drawingUpload) return Response.json(null);

  const toRow = (s: (typeof drawingUpload.sheets)[number]) => ({
    id: s.id,
    sheetNumber: s.sheetNumber,
    sheetTitle: s.sheetTitle,
    discipline: s.discipline,
    tradeId: s.tradeId,
    trade: s.trade,
    matchedTradeId: s.matchedTradeId,
    matchedTrade: s.matchedTrade,
  });

  const covered = drawingUpload.sheets.filter((s) => s.tradeId !== null).map(toRow);
  const missing = drawingUpload.sheets
    .filter((s) => s.tradeId === null && s.matchedTradeId !== null)
    .map(toRow);

  return Response.json({
    drawingUpload: {
      id: drawingUpload.id,
      fileName: drawingUpload.fileName,
      status: drawingUpload.status,
      uploadedAt: drawingUpload.uploadedAt,
    },
    total: drawingUpload.sheets.length,
    coveredCount: covered.length,
    missingCount: missing.length,
    covered,
    missing,
  });
}

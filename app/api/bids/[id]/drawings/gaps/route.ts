import { prisma } from "@/lib/prisma";

// GET /api/bids/[id]/drawings/gaps
// Returns ALL drawing uploads for this bid (fullset or per-discipline) and
// their combined coverage summary, split into three states per record:
//   covered       — tradeId set (trade is on bid)
//   missing       — matchedTradeId set (trade in dictionary, not on bid)
//   unknown       — both null
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const drawingUploads = await prisma.drawingUpload.findMany({
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

  if (drawingUploads.length === 0) return Response.json(null);

  type SheetRow = {
    id: number;
    sheetNumber: string;
    sheetTitle: string | null;
    discipline: string | null;
    tradeId: number | null;
    trade: { id: number; name: string } | null;
    matchedTradeId: number | null;
    matchedTrade: { id: number; name: string } | null;
    uploadDiscipline: string;
  };

  // Flatten all sheets across uploads, tagging each with its upload discipline
  const allSheets: SheetRow[] = [];
  for (const upload of drawingUploads) {
    for (const s of upload.sheets) {
      allSheets.push({
        id: s.id,
        sheetNumber: s.sheetNumber,
        sheetTitle: s.sheetTitle,
        discipline: s.discipline,
        tradeId: s.tradeId,
        trade: s.trade,
        matchedTradeId: s.matchedTradeId,
        matchedTrade: s.matchedTrade,
        uploadDiscipline: upload.discipline,
      });
    }
  }

  const covered = allSheets.filter((s) => s.tradeId !== null);
  const missing = allSheets.filter((s) => s.tradeId === null && s.matchedTradeId !== null);

  // Build per-upload summaries
  const uploads = drawingUploads.map((u) => ({
    id: u.id,
    fileName: u.fileName,
    status: u.status,
    discipline: u.discipline,
    uploadedAt: u.uploadedAt,
    sheetCount: u.sheets.length,
  }));

  return Response.json({
    // Legacy single-upload shape (for backward compat with existing UI)
    drawingUpload: uploads[0]
      ? {
          id: uploads[0].id,
          fileName: uploads[0].fileName,
          status: uploads[0].status,
          uploadedAt: uploads[0].uploadedAt,
        }
      : null,
    // New multi-upload shape
    uploads,
    total: allSheets.length,
    coveredCount: covered.length,
    missingCount: missing.length,
    covered,
    missing,
  });
}

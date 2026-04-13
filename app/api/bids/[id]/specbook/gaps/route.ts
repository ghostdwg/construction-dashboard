import { prisma } from "@/lib/prisma";

// GET /api/bids/[id]/specbook/gaps
// Returns the most recent SpecBook and sections split into three states:
//   covered       — tradeId set (trade is on bid)
//   missingFromBid — matchedTradeId set, tradeId null (known trade, not on bid)
//   unknown       — both null (no trade in dictionary matches)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const specBook = await prisma.specBook.findFirst({
    where: { bidId },
    orderBy: { uploadedAt: "desc" },
    include: {
      sections: {
        orderBy: { csiNumber: "asc" },
        include: {
          trade: { select: { id: true, name: true } },
          matchedTrade: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!specBook) return Response.json(null);

  const total = specBook.sections.length;
  const coveredSections = specBook.sections.filter((s) => s.tradeId !== null);
  const missingSections = specBook.sections.filter(
    (s) => s.tradeId === null && s.matchedTradeId !== null
  );
  const unknownSections = specBook.sections.filter(
    (s) => s.tradeId === null && s.matchedTradeId === null
  );

  const toRow = (s: (typeof specBook.sections)[number]) => ({
    id: s.id,
    csiNumber: s.csiNumber,
    csiTitle: s.csiTitle,
    tradeId: s.tradeId,
    trade: s.trade,
    matchedTradeId: s.matchedTradeId,
    matchedTrade: s.matchedTrade,
    source: s.source,
    aiExtractions: s.aiExtractions ? JSON.parse(s.aiExtractions) : null,
  });

  // AI analysis summary
  const analyzedSections = specBook.sections.filter((s) => s.aiExtractions);
  const severityCounts: Record<string, number> = {};
  for (const s of analyzedSections) {
    try {
      const ai = JSON.parse(s.aiExtractions!);
      const sev = (ai.severity || "INFO").toUpperCase();
      severityCounts[sev] = (severityCounts[sev] || 0) + 1;
    } catch { /* skip */ }
  }

  return Response.json({
    specBook: {
      id: specBook.id,
      fileName: specBook.fileName,
      status: specBook.status,
      uploadedAt: specBook.uploadedAt,
    },
    total,
    coveredCount: coveredSections.length,
    missingCount: missingSections.length,
    unknownCount: unknownSections.length,
    covered: coveredSections.map(toRow),
    missing: missingSections.map(toRow),
    unknown: unknownSections.map(toRow),
    aiAnalysis: analyzedSections.length > 0 ? {
      sectionsAnalyzed: analyzedSections.length,
      severity: severityCounts,
    } : null,
  });
}

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

  // Filter out junk sections (boring logs, soil data from geotech reports)
  // Valid MasterFormat 2004+ divisions: 01-14, 21-28, 31-35, 40-49
  const VALID_DIVISIONS = new Set([
    "01","02","03","04","05","06","07","08","09","10","11","12","13","14",
    "21","22","23","25","26","27","28",
    "31","32","33","34","35",
    "40","41","42","43","44","45","46","47","48","49",
  ]);
  const JUNK_TITLE_PATTERNS = /^(CL |CH |SC |SP |OH |DD |DATE COMPLETED|BORING|ELEVATION|\d+\s+\d+\s+\d+\s+\d)/i;

  const validSections = specBook.sections.filter((s) => {
    const div = s.csiNumber.replace(/\s+/g, "").slice(0, 2);
    if (!VALID_DIVISIONS.has(div)) return false;
    if (JUNK_TITLE_PATTERNS.test(s.csiTitle)) return false;
    return true;
  });

  const total = validSections.length;
  const coveredSections = validSections.filter((s) => s.tradeId !== null);
  const missingSections = validSections.filter(
    (s) => s.tradeId === null && s.matchedTradeId !== null
  );
  const unknownSections = validSections.filter(
    (s) => s.tradeId === null && s.matchedTradeId === null
  );

  // Clean up merged TOC titles — find earliest truncation point
  function cleanTitle(raw: string): string {
    const cutPatterns = [
      /\s+\d{2}\s*\d{2}\s*\d{2,4}[\s.,-]/,  // embedded CSI number
      /\.\s+[A-Z0-9]/,                        // sentence boundary
      /,\s+all of which/i,                    // ", all of which..."
      /\s+PART\s+\d/i,                        // "PART 1"
      /\s+\d+\.\s/,                           // numbered list "2. "
      /\s+for\s+(duct|additional|info)/i,     // "for duct liner..."
      /\s+HVAC\s*$/i,                           // trailing "HVAC"
      /\bGeneral\s+HVAC/i,                      // "Fire Protection General HVAC"
    ];

    let earliest = raw.length;
    for (const pat of cutPatterns) {
      const m = raw.match(pat);
      if (m?.index && m.index > 3 && m.index < earliest) {
        earliest = m.index;
      }
    }

    return raw.slice(0, Math.min(earliest, 60)).trim().replace(/[\s,.;:-]+$/, "");
  }

  const toRow = (s: (typeof validSections)[number]) => ({
    id: s.id,
    csiNumber: s.csiNumber,
    csiTitle: s.source === "split_pdf" ? s.csiTitle : cleanTitle(s.csiTitle),
    csiCanonicalTitle: s.csiCanonicalTitle,
    tradeId: s.tradeId,
    trade: s.trade,
    matchedTradeId: s.matchedTradeId,
    matchedTrade: s.matchedTrade,
    source: s.source,
    aiExtractions: s.aiExtractions ? JSON.parse(s.aiExtractions) : null,
    pdfFileName: s.pdfFileName,
    pageStart: s.pageStart,
    pageEnd: s.pageEnd,
    pageCount: s.pageCount,
    hasPdf: s.pdfPath !== null,
  });

  // AI analysis summary
  const analyzedSections = validSections.filter((s) => s.aiExtractions);
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

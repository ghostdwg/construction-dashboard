import { prisma } from "@/lib/prisma";
import { parseProcoreCsv } from "@/lib/services/import/parseProcoreCsv";
import { matchTradeNames } from "@/lib/services/import/matchTradeName";

// POST /api/subcontractors/import
// Body: multipart/form-data with `file` field (CSV)
// Returns parsed preview with dedup status and trade match status.
// Does NOT persist anything — call /commit to save.

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return Response.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file field is required" }, { status: 400 });
  }

  const text = await file.text();
  const parseResult = parseProcoreCsv(text);

  if (parseResult.rows.length === 0) {
    return Response.json({
      error: "No valid rows found in CSV",
      detectedFormat: parseResult.detectedFormat,
      columnMap: parseResult.columnMap,
    }, { status: 422 });
  }

  // Load full trade dictionary for matching
  const allTrades = await prisma.trade.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Collect all unique source trade names across all rows
  const allSourceTrades = Array.from(
    new Set(parseResult.rows.flatMap((r) => r.trades))
  );
  const tradeMatches = matchTradeNames(allSourceTrades, allTrades);
  const tradeMatchMap = new Map(tradeMatches.map((m) => [m.source, m]));

  // Dedup check — load existing subs by procoreVendorId and by company name
  const procoreIds = parseResult.rows
    .map((r) => r.procoreVendorId)
    .filter((id): id is string => !!id);

  const existing = await prisma.subcontractor.findMany({
    where: {
      OR: [
        ...(procoreIds.length > 0 ? [{ procoreVendorId: { in: procoreIds } }] : []),
        { company: { in: parseResult.rows.map((r) => r.company) } },
      ],
    },
    select: { id: true, company: true, procoreVendorId: true },
  });

  const byProcoreId = new Map(
    existing.filter((s) => s.procoreVendorId).map((s) => [s.procoreVendorId!, s])
  );
  const byCompanyName = new Map(
    existing.map((s) => [s.company.toLowerCase().trim(), s])
  );

  // Build preview rows
  const preview = parseResult.rows.map((row) => {
    // Match against existing
    let conflictWith: { id: number; company: string } | null = null;
    if (row.procoreVendorId && byProcoreId.has(row.procoreVendorId)) {
      const e = byProcoreId.get(row.procoreVendorId)!;
      conflictWith = { id: e.id, company: e.company };
    } else if (byCompanyName.has(row.company.toLowerCase().trim())) {
      const e = byCompanyName.get(row.company.toLowerCase().trim())!;
      conflictWith = { id: e.id, company: e.company };
    }

    // Resolve trades for this row
    const resolvedTrades = row.trades.map((t) => {
      const match = tradeMatchMap.get(t);
      return {
        source: t,
        tradeId: match?.matched?.id ?? null,
        matchedName: match?.matched?.name ?? null,
        confidence: match?.confidence ?? "none",
      };
    });

    return {
      ...row,
      conflictWith,
      action: conflictWith ? "skip" : "create",  // default action — UI may change
      isPreferred: false,                         // default — UI sets per row
      resolvedTrades,
    };
  });

  // Summary stats
  const conflictCount = preview.filter((p) => p.conflictWith).length;
  const newCount = preview.length - conflictCount;
  const unmatchedTrades = tradeMatches.filter((m) => m.confidence === "none").map((m) => m.source);
  const fuzzyTrades = tradeMatches.filter((m) => m.confidence === "fuzzy");

  return Response.json({
    detectedFormat: parseResult.detectedFormat,
    totalRows: parseResult.totalRows,
    validRows: parseResult.validRows,
    skippedRows: parseResult.skippedRows,
    columnMap: parseResult.columnMap,
    summary: {
      newCount,
      conflictCount,
      unmatchedTradeCount: unmatchedTrades.length,
      fuzzyTradeCount: fuzzyTrades.length,
    },
    unmatchedTrades,
    fuzzyTrades: fuzzyTrades.map((m) => ({ source: m.source, matched: m.matched?.name })),
    preview,
  });
}

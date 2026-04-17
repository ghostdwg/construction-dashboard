// GET /api/bids/[id]/closeout
//
// Phase 5H-4 — Closeout Checklist from Spec Intelligence
//
// Reads every SpecSection.aiExtractions for this bid's spec book and
// flattens the closeout[] array from each section into a unified checklist.
// No new DB model — data is derived from the AI analysis done in Phase 5A/5B.
// Read-only; source of truth is the spec text + AI pass.
//
// Response shape:
//   { items: CloseoutRow[], stats: CloseoutStats }
//
// Each CloseoutRow:
//   specSectionId, csiNumber, csiTitle, type, description,
//   quantity, timing, severity, tradeId, tradeName

import { prisma } from "@/lib/prisma";

// ── Types ──────────────────────────────────────────────────────────────────

type AiCloseout = {
  type?: string;
  description?: string;
  quantity?: string;
  timing?: string;
};

type AiExtraction = {
  closeout?: AiCloseout[];
  severity?: string;
};

export type CloseoutRow = {
  specSectionId: number;
  csiNumber: string;
  csiTitle: string;
  type:
    | "RECORD_DRAWINGS"
    | "ATTIC_STOCK"
    | "MANUALS"
    | "KEYS"
    | "CERTIFICATIONS"
    | "BALANCING"
    | "COMMISSIONING"
    | "FINAL_CLEAN"
    | "OTHER";
  description: string | null;
  quantity: string | null;
  timing: string | null;
  severity: string | null;
  tradeId: number | null;
  tradeName: string | null;
};

export type CloseoutStats = {
  total: number;
  sectionsWithCloseout: number;
  byType: Record<string, number>;
};

const CLOSEOUT_TYPES = new Set([
  "RECORD_DRAWINGS",
  "ATTIC_STOCK",
  "MANUALS",
  "KEYS",
  "CERTIFICATIONS",
  "BALANCING",
  "COMMISSIONING",
  "FINAL_CLEAN",
]);

function normalizeType(raw: string | undefined): CloseoutRow["type"] {
  if (!raw) return "OTHER";
  const upper = raw.trim().toUpperCase();
  if (upper.includes("RECORD") || upper.includes("AS-BUILT") || upper.includes("AS BUILT")) return "RECORD_DRAWINGS";
  if (upper.includes("ATTIC") || upper.includes("EXTRA MATERIAL") || upper.includes("SPARE")) return "ATTIC_STOCK";
  if (upper.includes("MANUAL") || upper.includes("O&M") || upper.includes("OPERATION")) return "MANUALS";
  if (upper.includes("KEY") || upper.includes("LOCK") || upper.includes("ACCESS CARD")) return "KEYS";
  if (upper.includes("CERTIF") || upper.includes("TEST REPORT") || upper.includes("CERTIFICATE")) return "CERTIFICATIONS";
  if (upper.includes("BALANC") || upper.includes("TAB ") || upper.includes("AIR BALANCE")) return "BALANCING";
  if (upper.includes("COMMISSION") || upper.includes("STARTUP") || upper.includes("START-UP")) return "COMMISSIONING";
  if (upper.includes("CLEAN") || upper.includes("FINAL CLEAN")) return "FINAL_CLEAN";
  return (CLOSEOUT_TYPES.has(upper) ? upper : "OTHER") as CloseoutRow["type"];
}

// ── Handler ────────────────────────────────────────────────────────────────

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid bid id" }, { status: 400 });

  // Find the most recent analyzed spec book
  const specBook = await prisma.specBook.findFirst({
    where: { bidId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
    select: { id: true },
  });

  if (!specBook) {
    return Response.json({
      items: [],
      stats: { total: 0, sectionsWithCloseout: 0, byType: {} },
    });
  }

  const sections = await prisma.specSection.findMany({
    where: {
      specBookId: specBook.id,
      aiExtractions: { not: null },
    },
    select: {
      id: true,
      csiNumber: true,
      csiTitle: true,
      csiCanonicalTitle: true,
      aiExtractions: true,
      tradeId: true,
      matchedTradeId: true,
      trade: { select: { name: true } },
      matchedTrade: { select: { name: true } },
    },
    orderBy: { csiNumber: "asc" },
  });

  const items: CloseoutRow[] = [];
  let sectionsWithCloseout = 0;

  for (const section of sections) {
    if (!section.aiExtractions) continue;

    let extraction: AiExtraction;
    try {
      extraction = JSON.parse(section.aiExtractions) as AiExtraction;
    } catch {
      continue;
    }

    const closeoutList = Array.isArray(extraction.closeout) ? extraction.closeout : [];
    if (closeoutList.length === 0) continue;

    sectionsWithCloseout++;

    const displayTitle = section.csiCanonicalTitle ?? section.csiTitle;
    const tradeId = section.tradeId ?? section.matchedTradeId ?? null;
    const tradeName = section.trade?.name ?? section.matchedTrade?.name ?? null;
    const severity = extraction.severity ?? null;

    for (const c of closeoutList) {
      const description = c.description?.trim() || null;
      if (!description) continue; // skip empty entries

      items.push({
        specSectionId: section.id,
        csiNumber: section.csiNumber,
        csiTitle: displayTitle,
        type: normalizeType(c.type),
        description,
        quantity: c.quantity?.trim() || null,
        timing: c.timing?.trim() || null,
        severity,
        tradeId,
        tradeName,
      });
    }
  }

  const byType: Record<string, number> = {};
  for (const item of items) {
    byType[item.type] = (byType[item.type] ?? 0) + 1;
  }

  return Response.json({
    items,
    stats: {
      total: items.length,
      sectionsWithCloseout,
      byType,
    },
  });
}

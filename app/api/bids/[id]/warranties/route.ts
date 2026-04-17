// GET /api/bids/[id]/warranties
//
// Phase 5H (near-term) — Warranty Register from Spec Intelligence
//
// Reads every SpecSection.aiExtractions for this bid's spec book and
// flattens the warranty[] array from each section into a unified register.
// No new DB model — data is derived from the AI analysis already done in
// Phase 5A/5B. Read-only; the source of truth is the spec text + AI pass.
//
// Response shape:
//   { warranties: WarrantyRow[], stats: WarrantyStats }
//
// Each WarrantyRow:
//   specSectionId, csiNumber, csiTitle, duration, type, scope, severity, tradeId, tradeName

import { prisma } from "@/lib/prisma";

// ── Types ──────────────────────────────────────────────────────────────────

type AiWarranty = {
  duration?: string;
  type?: string;      // MANUFACTURER | INSTALLER | SYSTEM
  scope?: string;
};

type AiExtraction = {
  warranty?: AiWarranty[];
  severity?: string;
};

export type WarrantyRow = {
  specSectionId: number;
  csiNumber: string;
  csiTitle: string;
  duration: string | null;
  type: "MANUFACTURER" | "INSTALLER" | "SYSTEM" | "OTHER";
  scope: string | null;
  severity: string | null;
  tradeId: number | null;
  tradeName: string | null;
};

export type WarrantyStats = {
  total: number;
  sectionsWithWarranties: number;
  byType: Record<string, number>;
};

const WARRANTY_TYPES = new Set(["MANUFACTURER", "INSTALLER", "SYSTEM"]);

function normalizeType(raw: string | undefined): WarrantyRow["type"] {
  if (!raw) return "OTHER";
  const upper = raw.trim().toUpperCase();
  return (WARRANTY_TYPES.has(upper) ? upper : "OTHER") as WarrantyRow["type"];
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

  // Find the most recent spec book for this bid that has been analyzed
  const specBook = await prisma.specBook.findFirst({
    where: { bidId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
    select: { id: true },
  });

  if (!specBook) {
    return Response.json({ warranties: [], stats: { total: 0, sectionsWithWarranties: 0, byType: {} } });
  }

  // Load all sections with AI extractions
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

  const warranties: WarrantyRow[] = [];
  let sectionsWithWarranties = 0;

  for (const section of sections) {
    if (!section.aiExtractions) continue;

    let extraction: AiExtraction;
    try {
      extraction = JSON.parse(section.aiExtractions) as AiExtraction;
    } catch {
      continue;
    }

    const warrantyList = Array.isArray(extraction.warranty) ? extraction.warranty : [];
    if (warrantyList.length === 0) continue;

    sectionsWithWarranties++;

    // Use the CSI canonical title if available (enriched from MasterFormat 2020)
    const displayTitle = section.csiCanonicalTitle ?? section.csiTitle;
    const tradeId = section.tradeId ?? section.matchedTradeId ?? null;
    const tradeName = section.trade?.name ?? section.matchedTrade?.name ?? null;
    const severity = (extraction.severity ?? null);

    for (const w of warrantyList) {
      const scope = w.scope?.trim() || null;
      const duration = w.duration?.trim() || null;
      if (!scope && !duration) continue; // skip empty entries

      warranties.push({
        specSectionId: section.id,
        csiNumber: section.csiNumber,
        csiTitle: displayTitle,
        duration,
        type: normalizeType(w.type),
        scope,
        severity,
        tradeId,
        tradeName,
      });
    }
  }

  // Stats
  const byType: Record<string, number> = {};
  for (const w of warranties) {
    byType[w.type] = (byType[w.type] ?? 0) + 1;
  }

  return Response.json({
    warranties,
    stats: {
      total: warranties.length,
      sectionsWithWarranties,
      byType,
    },
  });
}

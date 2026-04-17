// GET /api/bids/[id]/inspections
//
// Phase 5H-3 — Inspections Register from Spec Intelligence
//
// Reads every SpecSection.aiExtractions for this bid's spec book and
// flattens the inspections[] array from each section into a unified register.
// No new DB model — data is derived from the AI analysis done in Phase 5A/5B.
// Read-only; source of truth is the spec text + AI pass.
//
// Response shape:
//   { inspections: InspectionRow[], stats: InspectionStats }
//
// Each InspectionRow:
//   specSectionId, csiNumber, csiTitle, type, activity, standard,
//   frequency, timing, who, acceptanceCriteria, severity, tradeId, tradeName

import { prisma } from "@/lib/prisma";

// ── Types ──────────────────────────────────────────────────────────────────

type AiInspection = {
  type?: string;
  activity?: string;
  standard?: string;
  frequency?: string;
  timing?: string;
  who?: string;
  acceptance_criteria?: string;
};

type AiExtraction = {
  inspections?: AiInspection[];
  severity?: string;
};

export type InspectionRow = {
  specSectionId: number;
  csiNumber: string;
  csiTitle: string;
  type: "SPECIAL" | "THIRD_PARTY" | "OWNER_WITNESS" | "CONTRACTOR_QC" | "AHJ" | "OTHER";
  activity: string | null;
  standard: string | null;
  frequency: string | null;
  timing: string | null;
  who: string | null;
  acceptanceCriteria: string | null;
  severity: string | null;
  tradeId: number | null;
  tradeName: string | null;
};

export type InspectionStats = {
  total: number;
  sectionsWithInspections: number;
  byType: Record<string, number>;
};

const INSPECTION_TYPES = new Set(["SPECIAL", "THIRD_PARTY", "OWNER_WITNESS", "CONTRACTOR_QC", "AHJ"]);

function normalizeType(raw: string | undefined): InspectionRow["type"] {
  if (!raw) return "OTHER";
  const upper = raw.trim().toUpperCase();
  if (upper.includes("SPECIAL")) return "SPECIAL";
  if (upper.includes("THIRD") || upper.includes("INDEPENDENT") || upper.includes("TESTING LAB")) return "THIRD_PARTY";
  if (upper.includes("OWNER") || upper.includes("WITNESS")) return "OWNER_WITNESS";
  if (upper.includes("CONTRACTOR") || upper.includes("SELF") || upper.includes("QC")) return "CONTRACTOR_QC";
  if (upper.includes("AHJ") || upper.includes("AUTHORITY") || upper.includes("BUILDING OFFICIAL")) return "AHJ";
  return (INSPECTION_TYPES.has(upper) ? upper : "OTHER") as InspectionRow["type"];
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
      inspections: [],
      stats: { total: 0, sectionsWithInspections: 0, byType: {} },
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

  const inspections: InspectionRow[] = [];
  let sectionsWithInspections = 0;

  for (const section of sections) {
    if (!section.aiExtractions) continue;

    let extraction: AiExtraction;
    try {
      extraction = JSON.parse(section.aiExtractions) as AiExtraction;
    } catch {
      continue;
    }

    const inspectionList = Array.isArray(extraction.inspections) ? extraction.inspections : [];
    if (inspectionList.length === 0) continue;

    sectionsWithInspections++;

    const displayTitle = section.csiCanonicalTitle ?? section.csiTitle;
    const tradeId = section.tradeId ?? section.matchedTradeId ?? null;
    const tradeName = section.trade?.name ?? section.matchedTrade?.name ?? null;
    const severity = extraction.severity ?? null;

    for (const insp of inspectionList) {
      const activity = insp.activity?.trim() || null;
      if (!activity) continue; // skip entries with no activity description

      inspections.push({
        specSectionId: section.id,
        csiNumber: section.csiNumber,
        csiTitle: displayTitle,
        type: normalizeType(insp.type),
        activity,
        standard: insp.standard?.trim() || null,
        frequency: insp.frequency?.trim() || null,
        timing: insp.timing?.trim() || null,
        who: insp.who?.trim() || null,
        acceptanceCriteria: insp.acceptance_criteria?.trim() || null,
        severity,
        tradeId,
        tradeName,
      });
    }
  }

  const byType: Record<string, number> = {};
  for (const insp of inspections) {
    byType[insp.type] = (byType[insp.type] ?? 0) + 1;
  }

  return Response.json({
    inspections,
    stats: {
      total: inspections.length,
      sectionsWithInspections,
      byType,
    },
  });
}

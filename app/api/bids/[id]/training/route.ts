// GET /api/bids/[id]/training
//
// Phase 5H-2 — Training Register from Spec Intelligence
//
// Reads every SpecSection.aiExtractions for this bid's spec book and
// flattens the training[] array from each section into a unified register.
// No new DB model — data is derived from the AI analysis already done in
// Phase 5A/5B. Read-only; source of truth is the spec text + AI pass.
//
// Response shape:
//   { trainings: TrainingRow[], stats: TrainingStats }
//
// Each TrainingRow:
//   specSectionId, csiNumber, csiTitle, audience, topic, requirement,
//   duration, timing, severity, tradeId, tradeName

import { prisma } from "@/lib/prisma";

// ── Types ──────────────────────────────────────────────────────────────────

type AiTraining = {
  audience?: string;
  topic?: string;
  requirement?: string;
  duration?: string;
  timing?: string;
};

type AiExtraction = {
  training?: AiTraining[];
  severity?: string;
};

export type TrainingRow = {
  specSectionId: number;
  csiNumber: string;
  csiTitle: string;
  audience: "OWNER" | "MAINTENANCE" | "OPERATIONS" | "EMERGENCY" | "OTHER";
  topic: string | null;
  requirement: string | null;
  duration: string | null;
  timing: string | null;
  severity: string | null;
  tradeId: number | null;
  tradeName: string | null;
};

export type TrainingStats = {
  total: number;
  sectionsWithTraining: number;
  byAudience: Record<string, number>;
};

const AUDIENCE_TYPES = new Set(["OWNER", "MAINTENANCE", "OPERATIONS", "EMERGENCY"]);

function normalizeAudience(raw: string | undefined): TrainingRow["audience"] {
  if (!raw) return "OTHER";
  const upper = raw.trim().toUpperCase();
  // Fuzzy matches for common variants
  if (upper.includes("OWNER")) return "OWNER";
  if (upper.includes("MAINTENANCE") || upper.includes("FACILITY")) return "MAINTENANCE";
  if (upper.includes("OPERATION")) return "OPERATIONS";
  if (upper.includes("EMERGENCY") || upper.includes("LIFE SAFETY")) return "EMERGENCY";
  return (AUDIENCE_TYPES.has(upper) ? upper : "OTHER") as TrainingRow["audience"];
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
      trainings: [],
      stats: { total: 0, sectionsWithTraining: 0, byAudience: {} },
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

  const trainings: TrainingRow[] = [];
  let sectionsWithTraining = 0;

  for (const section of sections) {
    if (!section.aiExtractions) continue;

    let extraction: AiExtraction;
    try {
      extraction = JSON.parse(section.aiExtractions) as AiExtraction;
    } catch {
      continue;
    }

    const trainingList = Array.isArray(extraction.training) ? extraction.training : [];
    if (trainingList.length === 0) continue;

    sectionsWithTraining++;

    const displayTitle = section.csiCanonicalTitle ?? section.csiTitle;
    const tradeId = section.tradeId ?? section.matchedTradeId ?? null;
    const tradeName = section.trade?.name ?? section.matchedTrade?.name ?? null;
    const severity = extraction.severity ?? null;

    for (const t of trainingList) {
      const requirement = t.requirement?.trim() || null;
      const topic = t.topic?.trim() || null;
      if (!requirement && !topic) continue; // skip empty entries

      trainings.push({
        specSectionId: section.id,
        csiNumber: section.csiNumber,
        csiTitle: displayTitle,
        audience: normalizeAudience(t.audience),
        topic,
        requirement,
        duration: t.duration?.trim() || null,
        timing: t.timing?.trim() || null,
        severity,
        tradeId,
        tradeName,
      });
    }
  }

  const byAudience: Record<string, number> = {};
  for (const t of trainings) {
    byAudience[t.audience] = (byAudience[t.audience] ?? 0) + 1;
  }

  return Response.json({
    trainings,
    stats: {
      total: trainings.length,
      sectionsWithTraining,
      byAudience,
    },
  });
}

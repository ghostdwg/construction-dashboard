// GET /api/market-intelligence/docs/[id]/analyses
//
// List all engine analyses for a given scraped doc, newest first. Powers the
// Analyses panel on the doc viewer page and the compare view.

import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const doc = await prisma.marketSourceDoc.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!doc) return Response.json({ error: "Document not found" }, { status: 404 });

  const analyses = await prisma.marketDocAnalysis.findMany({
    where: { docId: id },
    orderBy: { requestedAt: "desc" },
    take: 50,
    select: {
      id: true,
      engine: true,
      modelName: true,
      status: true,
      requestedAt: true,
      startedAt: true,
      completedAt: true,
      durationMs: true,
      costUsd: true,
      signalsCount: true,
      leadsCount: true,
      errorMessage: true,
      // rawResponseJson omitted from list — fetch a single analysis to load it
    },
  });

  return Response.json({ analyses });
}

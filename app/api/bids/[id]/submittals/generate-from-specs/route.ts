// POST /api/bids/[id]/submittals/generate-from-specs
//
// Phase 5G-1 — generates SubmittalItem records from AI spec analysis.
// Reads each SpecSection.aiExtractions and creates one submittal per
// extracted submittal in the AI output. Idempotent — re-runs won't duplicate.

import { generateSubmittalsFromAiAnalysis } from "@/lib/services/submittal/generateFromAiAnalysis";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  try {
    const result = await generateSubmittalsFromAiAnalysis(bidId);
    return Response.json(result);
  } catch (err) {
    console.error("[POST /api/bids/:id/submittals/generate-from-specs]", err);
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("No spec book") ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}

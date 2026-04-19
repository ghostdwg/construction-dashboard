import { prisma } from "@/lib/prisma";
import { generateSubmittalsFromAiAnalysis } from "@/lib/services/submittal/generateFromAiAnalysis";

// POST /api/bids/[id]/specbook/analyze/complete
//
// Webhook endpoint — sidecar calls this when an analyze_split job finishes.
// Saves AI analysis results to SpecSection.aiExtractions so the browser
// doesn't need to be open for the data to be persisted.
//
// Security: requires X-Callback-Token header matching SIDECAR_CALLBACK_TOKEN.

const CALLBACK_TOKEN = process.env.SIDECAR_CALLBACK_TOKEN || "";

interface CallbackPayload {
  job_id: string;
  status: "complete" | "error";
  result?: {
    sections: Array<{
      csi: string;
      title: string;
      analysis: Record<string, unknown> | null;
    }>;
    section_count: number;
    summary: Record<string, number>;
    total_cost: number;
  };
  error?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify shared token
  if (CALLBACK_TOKEN) {
    const token = request.headers.get("X-Callback-Token");
    if (token !== CALLBACK_TOKEN) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const payload = (await request.json()) as CallbackPayload;

  if (payload.status === "error" || !payload.result) {
    console.error(`[analyze/complete] job ${payload.job_id} failed: ${payload.error}`);
    return Response.json({ saved: false, error: payload.error ?? "job failed" });
  }

  const specBook = await prisma.specBook.findFirst({
    where: { bidId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
    select: { id: true },
  });

  if (!specBook) {
    return Response.json({ saved: false, error: "SpecBook not found" }, { status: 404 });
  }

  const existing = await prisma.specSection.findMany({
    where: { specBookId: specBook.id },
    select: { id: true, csiNumber: true },
  });
  const byCsi = new Map(existing.map((s) => [s.csiNumber.replace(/\s+/g, ""), s.id]));

  const toUpdate = payload.result.sections
    .map((sec) => ({ sectionId: byCsi.get(sec.csi.replace(/\s+/g, "")), analysis: sec.analysis }))
    .filter((u): u is { sectionId: number; analysis: typeof u.analysis } => u.sectionId !== undefined);

  await Promise.all(
    toUpdate.map((u) =>
      prisma.specSection.update({
        where: { id: u.sectionId },
        data: { aiExtractions: u.analysis ? JSON.stringify(u.analysis) : null },
      })
    )
  );

  const updated = toUpdate.length;

  console.log(
    `[analyze/complete] job ${payload.job_id}: ${updated}/${payload.result.section_count} ` +
    `sections saved, $${payload.result.total_cost}`
  );

  // Auto-generate submittal register from the freshly saved AI extractions
  let submittalsGenerated: number | null = null;
  try {
    const result = await generateSubmittalsFromAiAnalysis(bidId);
    submittalsGenerated = result.created;
    console.log(`[analyze/complete] auto-generated ${result.created} submittals for bid ${bidId}`);
  } catch (err) {
    // Don't fail the webhook — spec data is saved; submittals can be regenerated manually
    console.error("[analyze/complete] submittal auto-generation failed:", err);
  }

  return Response.json({
    saved: true,
    sectionsUpdated: updated,
    submittalsGenerated,
    summary: payload.result.summary,
    totalCost: payload.result.total_cost,
  });
}

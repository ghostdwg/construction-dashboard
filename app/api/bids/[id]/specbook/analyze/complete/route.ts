import { prisma } from "@/lib/prisma";

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

  let updated = 0;
  for (const sec of payload.result.sections) {
    const key = sec.csi.replace(/\s+/g, "");
    const sectionId = byCsi.get(key);
    if (!sectionId) continue;
    await prisma.specSection.update({
      where: { id: sectionId },
      data: {
        aiExtractions: sec.analysis ? JSON.stringify(sec.analysis) : null,
      },
    });
    updated++;
  }

  console.log(
    `[analyze/complete] job ${payload.job_id}: ${updated}/${payload.result.section_count} ` +
    `sections saved, $${payload.result.total_cost}`
  );

  return Response.json({
    saved: true,
    sectionsUpdated: updated,
    summary: payload.result.summary,
    totalCost: payload.result.total_cost,
  });
}

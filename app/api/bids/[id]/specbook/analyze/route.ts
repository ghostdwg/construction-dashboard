import { prisma } from "@/lib/prisma";

// POST /api/bids/[id]/specbook/analyze
// Submits already-split sections (from /specbook/split) to the sidecar for
// per-section AI analysis. Each section is analyzed using its own PDF as
// clean, isolated context (Procore-style).
// Returns a job_id. Frontend polls GET /api/bids/[id]/specbook/analyze?jobId=xxx

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";
const APP_URL = process.env.APP_URL || "http://127.0.0.1:3001";
const CALLBACK_TOKEN = process.env.SIDECAR_CALLBACK_TOKEN || "";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const specBook = await prisma.specBook.findFirst({
    where: { bidId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
    include: {
      sections: {
        where: { pdfPath: { not: null } },
        select: { id: true, csiNumber: true, csiTitle: true, pdfPath: true },
      },
    },
  });

  if (!specBook) {
    return Response.json({ error: "No spec book uploaded. Upload a spec book first." }, { status: 404 });
  }

  if (specBook.sections.length === 0) {
    return Response.json(
      { error: "No split sections found. Run 'Split into Sections' first." },
      { status: 400 }
    );
  }

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

    const sectionsPayload = specBook.sections.map((s) => ({
      csi: s.csiNumber,
      title: s.csiTitle,
      pdf_path: s.pdfPath,
    }));

    const res = await fetch(`${SIDECAR_URL}/parse/specs/analyze_split`, {
      method: "POST",
      body: JSON.stringify({
        sections: sectionsPayload,
        callback_url: `${APP_URL}/api/bids/${bidId}/specbook/analyze/complete`,
        callback_token: CALLBACK_TOKEN || undefined,
      }),
      headers,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `Sidecar returned ${res.status}` }));
      return Response.json({ error: err.detail ?? "Failed to start analysis" }, { status: res.status });
    }

    const { job_id } = await res.json() as { job_id: string };

    console.log(`[specbook/analyze] submitted job ${job_id} for bid ${bidId}`);

    return Response.json({
      jobId: job_id,
      specBookId: specBook.id,
      status: "processing",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[specbook/analyze] error:", err);
    return Response.json({ error: message }, { status: 422 });
  }
}

// GET /api/bids/[id]/specbook/analyze?jobId=xxx
// Polls sidecar for job progress. When complete, saves results to DB.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId required" }, { status: 400 });

  try {
    const headers: Record<string, string> = {};
    if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

    const res = await fetch(`${SIDECAR_URL}/parse/specs/intelligent/status/${jobId}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return Response.json({ error: "Job not found" }, { status: 404 });
    }

    const job = await res.json() as {
      status: string;
      progress: number;
      total_sections: number;
      sections_processed: number;
      current_section: string | null;
      result?: {
        sections: Array<{
          csi: string;
          title: string;
          raw_text: string;
          analysis: Record<string, unknown> | null;
        }>;
        section_count: number;
        summary: Record<string, number>;
        total_cost: number;
      };
      error?: string;
    };

    // If complete, save results to DB
    if (job.status === "complete" && job.result) {
      const specBook = await prisma.specBook.findFirst({
        where: { bidId, status: "ready" },
        orderBy: { uploadedAt: "desc" },
      });

      if (specBook) {
        const existingSections = await prisma.specSection.findMany({
          where: { specBookId: specBook.id },
          select: { id: true, csiNumber: true },
        });

        const sectionByCsi = new Map(
          existingSections.map((s) => [s.csiNumber.replace(/\s+/g, ""), s.id])
        );

        let updated = 0;
        let created = 0;

        for (const aiSection of job.result.sections) {
          const csiNormalized = aiSection.csi.replace(/\s+/g, "");
          const existingId = sectionByCsi.get(csiNormalized);

          if (existingId) {
            await prisma.specSection.update({
              where: { id: existingId },
              data: {
                aiExtractions: aiSection.analysis ? JSON.stringify(aiSection.analysis) : null,
                csiTitle: aiSection.title || undefined,
              },
            });
            updated++;
          } else {
            await prisma.specSection.create({
              data: {
                specBookId: specBook.id,
                csiNumber: aiSection.csi,
                csiTitle: aiSection.title,
                rawText: (aiSection.raw_text || "").slice(0, 5000),
                source: "ai_analysis",
                aiExtractions: aiSection.analysis ? JSON.stringify(aiSection.analysis) : null,
              },
            });
            created++;
          }
        }

        console.log(
          `[specbook/analyze] job ${jobId} complete: ` +
          `${job.result.section_count} sections, ${updated} updated, ${created} created, ` +
          `$${job.result.total_cost}`
        );
      }

      return Response.json({
        status: "complete",
        progress: 100,
        sectionsAnalyzed: job.result.section_count,
        summary: job.result.summary,
        totalCost: job.result.total_cost,
      });
    }

    // Still processing or error
    return Response.json({
      status: job.status,
      progress: job.progress,
      totalSections: job.total_sections,
      sectionsProcessed: job.sections_processed,
      currentSection: job.current_section,
      error: job.error,
    });
  } catch (err) {
    return Response.json({ error: "Analysis service unavailable" }, { status: 503 });
  }
}

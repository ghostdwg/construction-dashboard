import {
  triggerSpecAnalysis,
  TriggerError,
} from "@/lib/services/jobs/specAnalysisAutomation";

// POST /api/bids/[id]/specbook/analyze
// Submits already-split sections (from /specbook/split) to the sidecar for
// per-section AI analysis. Each section is analyzed using its own PDF as
// clean, isolated context (Procore-style).
// Returns a job_id. Frontend polls GET /api/bids/[id]/specbook/analyze?jobId=xxx
// Core trigger logic lives in specAnalysisAutomation.ts (shared with automation endpoint).

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as { tier?: number };
  const tier = [1, 2, 3].includes(body.tier ?? 0) ? body.tier! : 2;

  try {
    const result = await triggerSpecAnalysis(bidId, {
      tier,
      triggerSource: "user",
    });

    if (result.status === "skipped") {
      return Response.json({ error: result.reason }, { status: 409 });
    }

    return Response.json({
      jobId: result.jobId,
      backgroundJobId: result.backgroundJobId,
      specBookId: result.specBookId,
      status: "processing",
    });
  } catch (err) {
    if (err instanceof TriggerError) {
      return Response.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("[specbook/analyze] unexpected error:", err);
    return Response.json({ error: "Unexpected error" }, { status: 500 });
  }
}

// GET /api/bids/[id]/specbook/analyze?jobId=xxx
// Read-only progress poll. Forwards sidecar status; never writes to DB.

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

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

    const res = await fetch(`${SIDECAR_URL}/parse/specs/analyze_split/status/${jobId}`, {
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

    // Completion persistence is handled exclusively by the webhook callback
    // (POST .../specbook/analyze/complete). This route is read-only — it
    // forwards sidecar progress/result without touching the DB.
    if (job.status === "complete" && job.result) {
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
  } catch (_err) {
    return Response.json({ error: "Analysis service unavailable" }, { status: 503 });
  }
}

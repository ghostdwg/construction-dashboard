// POST /api/bids/[id]/submittals/generate-ai
//
//   Phase 1 (synchronous): runs spec-only submittal generation locally
//   (generateFromAiAnalysis), same result as /generate-from-specs.
//
//   Phase 2 (async, only when drawing analysis exists): submits a drawing
//   cross-reference job to the sidecar. Claude compares covered CSI sections
//   against drawing scope and returns submittal items for drawing-only scope.
//
//   Returns: { specResult: GenerateResult, jobId: string | null }
//   jobId is null when no drawing analysis is available — caller is done.
//
// GET /api/bids/[id]/submittals/generate-ai?jobId=xxx
//
//   Polls sidecar for drawing cross-reference job progress.
//   When complete, saves drawing-sourced SubmittalItem records to DB.

import { prisma } from "@/lib/prisma";
import { generateSubmittalsFromAiAnalysis } from "@/lib/services/submittal/generateFromAiAnalysis";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

function sidecarHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) h["X-API-Key"] = SIDECAR_API_KEY;
  return h;
}

const SUBMITTAL_TYPES = [
  "PRODUCT_DATA", "SHOP_DRAWING", "SAMPLE", "MOCKUP",
  "WARRANTY", "O_AND_M", "LEED", "CERT", "OTHER",
] as const;
type SubmittalType = (typeof SUBMITTAL_TYPES)[number];

function normalizeType(raw: string): SubmittalType {
  const upper = raw.trim().toUpperCase() as SubmittalType;
  return SUBMITTAL_TYPES.includes(upper) ? upper : "OTHER";
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid bid id" }, { status: 400 });

  // Phase 1: spec-only generation (local, synchronous, fast)
  let specResult;
  try {
    specResult = await generateSubmittalsFromAiAnalysis(bidId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: msg.includes("No spec book") ? 404 : 500 });
  }

  // Phase 2: drawing cross-reference (optional, async)
  const drawing = await prisma.drawingUpload.findFirst({
    where: { bidId, analysisStatus: "ready" },
    orderBy: { uploadedAt: "desc" },
    select: { analysisJson: true },
  });

  if (!drawing?.analysisJson) {
    return Response.json({ specResult, jobId: null });
  }

  // Compact spec section list — just csi + title for coverage comparison
  const specBook = await prisma.specBook.findFirst({
    where: { bidId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
    include: {
      sections: {
        where: { aiExtractions: { not: null } },
        select: { csiNumber: true, csiTitle: true },
      },
    },
  });

  const specSections = specBook?.sections.map((s) => ({
    csi: s.csiNumber,
    title: s.csiTitle,
  })) ?? [];

  // No analyzed sections → skip drawing cross-reference (empty list would make
  // everything in the drawings appear "uncovered", producing misleading results).
  if (specSections.length === 0) {
    return Response.json({ specResult, jobId: null });
  }

  let drawingAnalysis: Record<string, unknown>;
  try {
    drawingAnalysis = JSON.parse(drawing.analysisJson) as Record<string, unknown>;
  } catch {
    return Response.json({ specResult, jobId: null });
  }

  try {
    const res = await fetch(`${SIDECAR_URL}/parse/submittals/generate`, {
      method: "POST",
      headers: sidecarHeaders(),
      body: JSON.stringify({
        spec_sections: specSections,
        drawing_analysis: drawingAnalysis,
        model: "sonnet",
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `Sidecar ${res.status}` })) as { detail?: string };
      // Non-fatal — spec items are already saved, just skip drawing phase
      console.warn("[submittals/generate-ai] sidecar rejected:", err.detail);
      return Response.json({ specResult, jobId: null });
    }

    const { job_id } = await res.json() as { job_id: string };
    return Response.json({ specResult, jobId: job_id });
  } catch (err) {
    console.warn("[submittals/generate-ai] sidecar unavailable:", err);
    return Response.json({ specResult, jobId: null });
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  // Metadata check — called without jobId to preflight spec readiness for the UI hint
  if (!jobId) {
    const [specBook, drawing] = await Promise.all([
      prisma.specBook.findFirst({
        where: { bidId, status: "ready" },
        orderBy: { uploadedAt: "desc" },
        include: {
          sections: {
            where: { aiExtractions: { not: null } },
            select: { id: true },
          },
        },
      }),
      prisma.drawingUpload.findFirst({
        where: { bidId, analysisStatus: "ready" },
        select: { id: true },
      }),
    ]);
    return Response.json({
      analyzedSectionCount: specBook?.sections.length ?? 0,
      hasSpecBook: !!specBook,
      hasDrawings: !!drawing,
    });
  }

  try {
    const res = await fetch(`${SIDECAR_URL}/parse/submittals/status/${jobId}`, {
      headers: sidecarHeaders(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return Response.json({ error: "Job not found" }, { status: 404 });

    const job = await res.json() as {
      status: string;
      progress: number;
      result?: {
        drawing_submittals: Array<{
          type: string;
          section_title: string;
          title: string;
          description: string;
          engineer_review: boolean;
          notes: string | null;
        }>;
        spec_coverage_gaps: string[];
        project_summary: string;
        cost_usd: number;
        input_tokens: number;
        output_tokens: number;
      };
      error?: string;
    };

    if (job.status === "complete" && job.result) {
      const created = await applyDrawingResults(bidId, job.result.drawing_submittals);
      return Response.json({
        status: "complete",
        progress: 100,
        drawingItemsCreated: created,
        specCoverageGaps: job.result.spec_coverage_gaps,
        projectSummary: job.result.project_summary,
        costUsd: job.result.cost_usd,
      });
    }

    return Response.json({
      status: job.status,
      progress: job.progress,
      error: job.error,
    });
  } catch {
    return Response.json({ error: "Sidecar unavailable" }, { status: 503 });
  }
}

// ── Save drawing-sourced items ─────────────────────────────────────────────────

async function applyDrawingResults(
  bidId: number,
  drawingSubmittals: Array<{
    type: string;
    section_title: string;
    title: string;
    description: string;
    engineer_review: boolean;
    notes: string | null;
  }>
): Promise<number> {
  // Wipe previous drawing-analysis items before recreating
  await prisma.submittalItem.deleteMany({
    where: { bidId, source: "drawing_analysis" },
  });

  if (drawingSubmittals.length === 0) return 0;

  await prisma.submittalItem.createMany({
    data: drawingSubmittals.map((s) => ({
      bidId,
      bidTradeId: null,
      packageId: null,
      specSectionId: null,
      type: normalizeType(s.type),
      title: s.title,
      description: s.description,
      source: "drawing_analysis",
      status: "PENDING",
      notes: s.notes ?? null,
    })),
  });

  console.log(`[submittals/generate-ai] saved ${drawingSubmittals.length} drawing-sourced items for bid ${bidId}`);
  return drawingSubmittals.length;
}

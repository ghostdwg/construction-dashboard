// GET  /api/bids/[id]/schedule-v2/generate
//   No jobId  → returns metadata for pre-run cost estimation
//              { sectionCount, hasDrawings, estimatedInputTokens }
//   ?jobId=xx → polls sidecar for job progress; applies results when complete
//
// POST /api/bids/[id]/schedule-v2/generate
//   Body: { model: "sonnet" | "opus46" | "opus47" }
//   Reads spec sections + drawing analysis from DB, sends to sidecar,
//   returns { jobId, status: "processing" }

import { prisma } from "@/lib/prisma";
import {
  seedScheduleV2,
  getOrCreateSchedule,
  loadScheduleById,
  createActivityV2,
  recalculateScheduleV2,
} from "@/lib/services/schedule/scheduleV2Service";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

function sidecarHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (SIDECAR_API_KEY) h["X-API-Key"] = SIDECAR_API_KEY;
  return h;
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

  // ── Poll mode ─────────────────────────────────────────────────────────────
  if (jobId) {
    try {
      const res = await fetch(`${SIDECAR_URL}/parse/schedule/status/${jobId}`, {
        headers: sidecarHeaders(),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) return Response.json({ error: "Job not found" }, { status: 404 });

      const job = await res.json() as {
        status: string;
        progress: number;
        result?: {
          activity_overrides: Array<{ code: string; name?: string; duration_days?: number; notes?: string }>;
          new_activities: Array<{ insert_after_code: string; name: string; duration_days: number; csi_code?: string; notes?: string }>;
          procurement_activities: Array<{ csi_div: string; name: string; duration_days: number; notes?: string }>;
          project_summary: string;
          estimated_weeks: number | null;
          cost_usd: number;
          input_tokens: number;
          output_tokens: number;
        };
        error?: string;
      };

      if (job.status === "complete" && job.result) {
        await applyAiResults(bidId, job.result);
        return Response.json({
          status: "complete",
          progress: 100,
          projectSummary: job.result.project_summary,
          estimatedWeeks: job.result.estimated_weeks,
          costUsd: job.result.cost_usd,
          inputTokens: job.result.input_tokens,
          outputTokens: job.result.output_tokens,
        });
      }

      return Response.json({
        status: job.status,
        progress: job.progress,
        error: job.error,
      });
    } catch {
      return Response.json({ error: "Schedule service unavailable" }, { status: 503 });
    }
  }

  // ── Metadata mode (pre-run cost estimation) ───────────────────────────────
  const specBook = await prisma.specBook.findFirst({
    where: { bidId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
    include: {
      sections: {
        where: { aiExtractions: { not: null } },
        select: { id: true },
      },
    },
  });

  const drawing = await prisma.drawingUpload.findFirst({
    where: { bidId, analysisStatus: "ready" },
    orderBy: { uploadedAt: "desc" },
    select: { id: true },
  });

  const sectionCount = specBook?.sections.length ?? 0;
  const hasDrawings = !!drawing;
  // ~400 tokens per section + 3 500 for drawings + 3 000 for template + prompt
  const estimatedInputTokens = sectionCount * 400 + (hasDrawings ? 3_500 : 0) + 3_000;

  return Response.json({
    sectionCount,
    hasDrawings,
    hasSpecBook: !!specBook,
    estimatedInputTokens,
  });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json().catch(() => ({})) as { model?: string };
  const model = ["sonnet", "opus46", "opus47"].includes(body.model ?? "")
    ? body.model!
    : "sonnet";

  // Load spec sections with AI extractions
  const specBook = await prisma.specBook.findFirst({
    where: { bidId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
    include: {
      sections: {
        where: { aiExtractions: { not: null } },
        select: {
          csiNumber: true,
          csiTitle: true,
          csiCanonicalTitle: true,
          aiExtractions: true,
        },
      },
    },
  });

  if (!specBook || specBook.sections.length === 0) {
    return Response.json(
      { error: "No analyzed spec sections found. Run spec analysis first." },
      { status: 400 }
    );
  }

  // Load drawing analysis (optional)
  const drawing = await prisma.drawingUpload.findFirst({
    where: { bidId, analysisStatus: "ready" },
    orderBy: { uploadedAt: "desc" },
    select: { analysisJson: true },
  });

  const drawingAnalysis = drawing?.analysisJson
    ? JSON.parse(drawing.analysisJson) as Record<string, unknown>
    : null;

  const sectionsPayload = specBook.sections.map((s) => ({
    csi: s.csiNumber,
    title: s.csiTitle,
    canonical_title: s.csiCanonicalTitle,
    ai_extractions: s.aiExtractions,
  }));

  try {
    const res = await fetch(`${SIDECAR_URL}/parse/schedule/generate`, {
      method: "POST",
      headers: sidecarHeaders(),
      body: JSON.stringify({
        spec_sections: sectionsPayload,
        drawing_analysis: drawingAnalysis,
        model,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `Sidecar ${res.status}` }));
      return Response.json({ error: err.detail ?? "Failed to start generation" }, { status: res.status });
    }

    const { job_id } = await res.json() as { job_id: string };
    return Response.json({ jobId: job_id, status: "processing" });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw === "fetch failed"
      ? "Sidecar unavailable — make sure the Python service is running (`npm run dev:sidecar`)"
      : raw;
    return Response.json({ error: message }, { status: 422 });
  }
}

// ── Apply AI results to the schedule DB ──────────────────────────────────────

async function applyAiResults(
  bidId: number,
  result: {
    activity_overrides: Array<{ code: string; name?: string; duration_days?: number; notes?: string }>;
    new_activities: Array<{ insert_after_code: string; name: string; duration_days: number; csi_code?: string; notes?: string }>;
    procurement_activities: Array<{ csi_div: string; name: string; duration_days: number; notes?: string }>;
  }
): Promise<void> {
  // Ensure skeleton exists first (idempotent — won't wipe existing)
  await seedScheduleV2(bidId, false);

  const scheduleId = await getOrCreateSchedule(bidId);
  const { activities } = await loadScheduleById(scheduleId);
  const byCode = new Map(activities.map((a) => [a.activityCode, a]));

  // 1. Activity overrides (name / duration / notes on existing template activities)
  const overrideUpdates = result.activity_overrides
    .map((o) => {
      const act = byCode.get(o.code);
      if (!act) return null;
      const data: Record<string, unknown> = {};
      if (o.name) data.name = o.name;
      if (o.duration_days != null) data.duration = o.duration_days;
      if (o.notes != null) data.notes = o.notes;
      return Object.keys(data).length > 0
        ? prisma.scheduleActivityV2.update({ where: { id: act.id }, data })
        : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (overrideUpdates.length > 0) await Promise.all(overrideUpdates);

  // 2. Procurement overrides — update existing P20xx by CSI div, or create new ones
  if (result.procurement_activities.length > 0) {
    const procActivities = activities.filter((a) => a.activityCode.startsWith("P20"));
    const p1050 = byCode.get("P1050");

    for (const pa of result.procurement_activities) {
      const existing = procActivities.find(
        (a) => a.csiCode?.replace(/\D/g, "").slice(0, 2) === pa.csi_div
      );
      if (existing) {
        await prisma.scheduleActivityV2.update({
          where: { id: existing.id },
          data: {
            name: pa.name,
            duration: pa.duration_days,
            ...(pa.notes ? { notes: pa.notes } : {}),
          },
        });
      } else if (p1050) {
        // New procurement division not in skeleton — insert into Phase 2
        await createActivityV2(scheduleId, {
          name: pa.name,
          duration: pa.duration_days,
          csiCode: `${pa.csi_div} 00 00`,
          notes: pa.notes ?? "",
          insertAfterSortOrder: p1050.sortOrder,
        });
      }
    }
  }

  // Reload activities after potential insertions
  const { activities: refreshed } = await loadScheduleById(scheduleId);
  const byCodeRefreshed = new Map(refreshed.map((a) => [a.activityCode, a]));

  // 3. New project-specific activities
  for (const na of result.new_activities) {
    const afterAct = byCodeRefreshed.get(na.insert_after_code);
    if (!afterAct) continue;
    await createActivityV2(scheduleId, {
      name: na.name,
      duration: na.duration_days,
      csiCode: na.csi_code ?? null,
      notes: na.notes ?? "",
      insertAfterSortOrder: afterAct.sortOrder,
    });
  }

  // Final recalc with all changes applied
  await recalculateScheduleV2(scheduleId);
}

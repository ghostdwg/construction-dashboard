// Module OPS6 (Phase 2) — consultant-stream PDF export (SSE).
//
// POST …/consultant-reports/export-pdf
//   Body: { dateFrom?, dateTo?, observationIds?, includeDisposed? }
//   Response: text/event-stream — `progress {stage}` events, then
//   `done {downloadUrl, exportId, byteSize, observationCount}` or
//   `error {message}`.
//
// Order of gates: requireBidAccess → filter validation → CAP PRECHECK
// (one count query; over-cap is answered before any sidecar contact) →
// per-bid in-flight lock (second concurrent export → 429). Generation is
// SYNCHRONOUS under the SSE feedback channel (60s abort on the sidecar
// call; the sidecar kills its render subprocess at 90s) — no job system.
// The artifact is stored privately; the download URL is the bid-scoped
// authenticated route — never a public or signed URL.

import { auth } from "@/lib/auth";
import { requireBidAccess } from "@/lib/auth-helpers";
import {
  MAX_EXPORT_OBSERVATIONS,
  countExportObservations,
  generateStreamExport,
  type ExportFilters,
} from "@/lib/services/consultantReports/streamExport";

// Per-bid in-flight marker (single app process — V1 posture).
const inFlight = new Set<number>();

function parseDate(value: unknown, name: string): Date | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`Invalid ${name}`);
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new Error(`Invalid ${name}`);
  return d;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  let filters: ExportFilters;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      dateFrom?: unknown;
      dateTo?: unknown;
      observationIds?: unknown;
      includeDisposed?: unknown;
    };
    const observationIds = Array.isArray(body.observationIds)
      ? body.observationIds.filter((v): v is number => typeof v === "number" && Number.isInteger(v))
      : null;
    if (Array.isArray(body.observationIds) && observationIds!.length !== body.observationIds.length) {
      throw new Error("observationIds must be integers");
    }
    filters = {
      dateFrom: parseDate(body.dateFrom, "dateFrom"),
      dateTo: parseDate(body.dateTo, "dateTo"),
      observationIds,
      includeDisposed: body.includeDisposed === true,
    };
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid filters" },
      { status: 400 }
    );
  }

  // Cap precheck — one count query, BEFORE the sidecar or the lock.
  const count = await countExportObservations(bidId, filters);
  if (count > MAX_EXPORT_OBSERVATIONS) {
    return Response.json(
      {
        error: `This stream has ${count} observations — exports are capped at ${MAX_EXPORT_OBSERVATIONS}. Narrow the date range or select specific observations.`,
      },
      { status: 400 }
    );
  }
  if (count === 0) {
    return Response.json(
      { error: "Nothing to export — zero observations match the filters" },
      { status: 400 }
    );
  }

  if (inFlight.has(bidId)) {
    return Response.json(
      { error: "An export is already generating for this project — try again in a minute" },
      { status: 429 }
    );
  }
  inFlight.add(bidId);

  const session = await auth().catch(() => null);
  const su = session?.user as { name?: string | null; email?: string | null } | undefined;
  const actor = { name: su?.name ?? null, email: su?.email ?? null };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      try {
        const result = await generateStreamExport(bidId, filters, actor, (stage) =>
          send("progress", { stage })
        );
        if (!result.ok) {
          send("error", { message: result.error });
        } else {
          send("done", {
            exportId: result.value.exportId,
            byteSize: result.value.byteSize,
            observationCount: result.value.observationCount,
            downloadUrl: `/api/bids/${bidId}/consultant-reports/export-pdf/${result.value.exportId}/download`,
          });
        }
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : "Export failed",
        });
      } finally {
        inFlight.delete(bidId);
        controller.close();
      }
    },
    cancel() {
      inFlight.delete(bidId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

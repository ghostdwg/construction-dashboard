// lib/services/consultantReports/streamExport.ts
//
// Module OPS6 (Phase 2) — consultant-stream PDF export orchestration.
// Assembles the STRUCTURED payload from Prisma (the sidecar never touches
// the DB), enforces the payload caps BEFORE any sidecar contact, calls the
// pure-rendering sidecar endpoint (no provider, no API key on this path),
// stores the immutable artifact in the BlobStore, and records a
// ConsultantStreamExport row — the tenancy-checked target behind the
// authenticated download URL. Never a public or signed URL.

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getBlobStore } from "@/lib/storage/blobStore";
import { audit, type Actor, actorLabel, type ServiceResult } from "./index";

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";

export const MAX_EXPORT_OBSERVATIONS = 500;
export const MAX_EXPORT_PAYLOAD_BYTES = 2 * 1024 * 1024;

const CATEGORY_LABELS: Record<string, string> = {
  ARCHITECT_FIELD_REPORT: "Architect Field Report",
  ENGINEER_FIELD_REPORT: "Engineer Field Report",
  COMMISSIONING_REPORT: "Commissioning Report",
  TESTING_INSPECTION_REPORT: "Testing / Inspection Report",
  OTHER_CONSULTANT_REPORT: "Other Consultant Report",
};

export interface ExportFilters {
  dateFrom?: Date | null;
  dateTo?: Date | null;
  observationIds?: number[] | null;
  includeDisposed?: boolean; // filters DISMISSED observations in/out
}

function filterSummary(f: ExportFilters): string {
  const parts: string[] = [];
  if (f.dateFrom) parts.push(`from ${f.dateFrom.toISOString().slice(0, 10)}`);
  if (f.dateTo) parts.push(`to ${f.dateTo.toISOString().slice(0, 10)}`);
  if (f.observationIds?.length) parts.push(`${f.observationIds.length} selected observations`);
  parts.push(f.includeDisposed ? "dismissed included" : "dismissed excluded");
  return parts.join(" · ");
}

/** Count query only — the cap precheck the route runs before anything else. */
export async function countExportObservations(
  bidId: number,
  filters: ExportFilters
): Promise<number> {
  return prisma.consultantObservation.count({
    where: buildObservationWhere(bidId, filters),
  });
}

function buildObservationWhere(bidId: number, f: ExportFilters) {
  return {
    bidId,
    ...(f.includeDisposed ? {} : { state: { not: "DISMISSED" } }),
    ...(f.observationIds?.length ? { id: { in: f.observationIds } } : {}),
    ...(f.dateFrom || f.dateTo
      ? {
          report: {
            reportDate: {
              ...(f.dateFrom ? { gte: f.dateFrom } : {}),
              ...(f.dateTo ? { lte: f.dateTo } : {}),
            },
          },
        }
      : {}),
  };
}

/** Assemble the structured sidecar payload. Formal responses render once
 *  per item (zero-copy §9 rule): the first observation citing an item
 *  carries the response text; later citations carry responseRef. */
export async function buildStreamPayload(
  bidId: number,
  filters: ExportFilters,
  actor: Actor
): Promise<
  ServiceResult<{ payload: Record<string, unknown>; observationCount: number }>
> {
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { projectName: true },
  });
  if (!bid) return { ok: false, error: "Not found" };

  const observations = await prisma.consultantObservation.findMany({
    where: buildObservationWhere(bidId, filters),
    orderBy: { createdAt: "asc" },
    include: {
      report: {
        select: {
          id: true,
          vendorName: true,
          title: true,
          reportNumber: true,
          reportType: true,
          reportDate: true,
          status: true,
          _count: { select: { revisions: true } },
        },
      },
      registerItem: {
        select: {
          id: true,
          title: true,
          status: true,
          dueDate: true,
          formalResponse: true,
          formalResponseBy: true,
          formalResponseAt: true,
        },
      },
      dispositions: { orderBy: [{ disposedAt: "asc" }, { id: "asc" }] },
    },
  });

  if (observations.length === 0) {
    return { ok: false, error: "Nothing to export — zero observations match the filters" };
  }
  if (observations.length > MAX_EXPORT_OBSERVATIONS) {
    return {
      ok: false,
      error: `This stream has ${observations.length} observations — exports are capped at ${MAX_EXPORT_OBSERVATIONS}. Narrow the date range or select specific observations.`,
    };
  }

  // Group by report, chronological by reportDate then id.
  const byReport = new Map<number, { report: (typeof observations)[number]["report"]; rows: typeof observations }>();
  for (const o of observations) {
    const entry = byReport.get(o.report.id) ?? { report: o.report, rows: [] as typeof observations };
    entry.rows.push(o);
    byReport.set(o.report.id, entry);
  }
  const groups = [...byReport.values()].sort((a, b) => {
    const da = a.report.reportDate?.getTime() ?? 0;
    const db = b.report.reportDate?.getTime() ?? 0;
    return da - db || a.report.id - b.report.id;
  });

  const respondedItemsSeen = new Set<number>();
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

  const payload = {
    projectName: bid.projectName,
    rangeLabel:
      filters.dateFrom || filters.dateTo
        ? `${filters.dateFrom?.toISOString().slice(0, 10) ?? "start"} — ${filters.dateTo?.toISOString().slice(0, 10) ?? "today"}`
        : "All reports to date",
    filterSummary: filterSummary(filters),
    generatedBy: actorLabel(actor),
    generatedAt: new Date().toISOString(),
    reports: groups.map(({ report, rows }) => ({
      vendorName: report.vendorName,
      title: report.title,
      reportNumber: report.reportNumber,
      categoryLabel: CATEGORY_LABELS[report.reportType] ?? report.reportType,
      reportDate: iso(report.reportDate),
      status: report.status,
      revisionCount: report._count.revisions,
      observations: rows.map((o) => {
        let registerItem: Record<string, unknown> | null = null;
        if (o.registerItem) {
          const hasResponse = o.registerItem.formalResponse != null;
          const alreadyRendered = respondedItemsSeen.has(o.registerItem.id);
          if (hasResponse && !alreadyRendered) respondedItemsSeen.add(o.registerItem.id);
          registerItem = {
            id: o.registerItem.id,
            title: o.registerItem.title,
            status: o.registerItem.status,
            dueDate: iso(o.registerItem.dueDate),
            formalResponse: hasResponse && !alreadyRendered ? o.registerItem.formalResponse : null,
            formalResponseBy: o.registerItem.formalResponseBy,
            formalResponseAt: iso(o.registerItem.formalResponseAt),
            responseRef: hasResponse && alreadyRendered,
          };
        }
        return {
          observationText: o.observationText,
          sourcePage: o.sourcePage,
          consultantTargetDate: iso(o.consultantTargetDate),
          state: o.state,
          dismissedReason: o.dismissedReason,
          registerItem,
          dispositions: o.dispositions.map((d) => ({
            dispositionType: d.dispositionType,
            dispositionText: d.dispositionText,
            disposedBy: d.disposedBy,
            disposedAt: iso(d.disposedAt),
          })),
        };
      }),
    })),
  };

  const bytes = Buffer.byteLength(JSON.stringify(payload));
  if (bytes > MAX_EXPORT_PAYLOAD_BYTES) {
    return {
      ok: false,
      error: `Export payload is ${bytes} bytes — the cap is ${MAX_EXPORT_PAYLOAD_BYTES}. Narrow the date range or select specific observations.`,
    };
  }

  return { ok: true, value: { payload, observationCount: observations.length } };
}

/** Render via the sidecar, store the artifact, record the immutable row. */
export async function generateStreamExport(
  bidId: number,
  filters: ExportFilters,
  actor: Actor,
  onProgress: (stage: string) => void
): Promise<ServiceResult<{ exportId: string; byteSize: number; observationCount: number }>> {
  onProgress("fetching");
  const built = await buildStreamPayload(bidId, filters, actor);
  if (!built.ok) return built;

  onProgress("rendering");
  let pdf: Buffer;
  try {
    const res = await fetch(`${SIDECAR_URL}/reports/consultant-stream-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(built.value.payload),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => `HTTP ${res.status}`);
      const message =
        res.status === 429
          ? "A stream export is already rendering — try again in a minute"
          : res.status === 501
            ? "WeasyPrint is not installed in the sidecar"
            : `Render failed (${res.status}): ${detail.slice(0, 200)}`;
      return { ok: false, error: message };
    }
    pdf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      error: timedOut
        ? "Export timed out — narrow the date range or report selection and retry"
        : `Sidecar unavailable: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  onProgress("storing");
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const storedKey = `plan-room/jobs/${bidId}/consultant-stream-exports/${sha256}.pdf`;
  await getBlobStore().put(storedKey, pdf, { contentType: "application/pdf" });

  const row = await prisma.consultantStreamExport.create({
    data: {
      bidId,
      storedKey,
      sha256,
      byteSize: pdf.byteLength,
      observationCount: built.value.observationCount,
      filtersJson: JSON.stringify({
        dateFrom: filters.dateFrom?.toISOString() ?? null,
        dateTo: filters.dateTo?.toISOString() ?? null,
        observationIds: filters.observationIds ?? null,
        includeDisposed: filters.includeDisposed ?? false,
      }),
      generatedBy: actorLabel(actor),
    },
    select: { id: true },
  });

  await audit(
    "stream_export_generated",
    bidId,
    { kind: "ConsultantStreamExport", id: row.id },
    actor,
    "generated",
    {
      observationCount: built.value.observationCount,
      byteSize: pdf.byteLength,
      sha256,
      filters: filterSummary(filters),
    }
  );

  return {
    ok: true,
    value: {
      exportId: row.id,
      byteSize: pdf.byteLength,
      observationCount: built.value.observationCount,
    },
  };
}

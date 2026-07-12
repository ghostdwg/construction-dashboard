// Module OPS3 (Phase 1A) — Consultant Reports collection.
//
// GET  …/consultant-reports        list (stream metadata + revision/observation counts)
// POST …/consultant-reports        upload a NEW report (multipart: file + metadata fields)
//
// Behind the session wall (proxy.ts) like every bid route. Upload order
// (card §6, verbatim): tenancy → validate single-file multipart → buffer
// (≤25 MiB) → MIME + %PDF- magic bytes (BOTH, required) → sha-256 →
// duplicate check [bidId, checksum] → content-addressed blob write → one
// transaction inserting ConsultantReport + revision 0 → audit. A duplicate
// returns the existing report explicitly — never silent, never re-stored.
// NO parsing, NO OCR, NO extraction, NO provider call — ever, on any path.

import { auth } from "@/lib/auth";
import { getBlobStore } from "@/lib/storage/blobStore";
import {
  listConsultantReports,
  uploadConsultantReport,
} from "@/lib/services/consultantReports";
import { validateConsultantReportUpload } from "@/lib/services/consultantReports/pdfValidation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const reports = await listConsultantReports(bidId);
  return Response.json({
    consultantReports: reports.map((r) => ({
      id: r.id,
      vendorName: r.vendorName,
      title: r.title,
      reportNumber: r.reportNumber,
      reportType: r.reportType,
      reportDate: r.reportDate,
      status: r.status,
      uploadedBy: r.uploadedBy,
      uploadedAt: r.uploadedAt,
      revisionCount: r.revisions.length,
      latestRevision: r.revisions[0] ?? null,
      observationCount: r._count.observations,
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "multipart/form-data body required" },
      { status: 400 }
    );
  }
  const file = form.get("file");
  if (!(file instanceof Blob) || !("name" in file)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }
  const originalFilename = String((file as File).name || "report.pdf");
  const mimeType = file.type || "application/octet-stream";

  // Size gate BEFORE buffering trusts the Blob's own size; the buffer is
  // re-checked after read (both go through the same validator).
  const bytes = Buffer.from(await file.arrayBuffer());
  const validation = validateConsultantReportUpload({ mimeType, bytes });
  if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 });

  const text = (name: string): string | null => {
    const v = form.get(name);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const vendorName = text("vendorName");
  const reportType = text("reportType");
  if (!vendorName) return Response.json({ error: "vendorName is required" }, { status: 400 });
  if (!reportType) return Response.json({ error: "reportType is required" }, { status: 400 });
  const reportDateRaw = text("reportDate");
  const reportDate = reportDateRaw ? new Date(reportDateRaw) : null;
  if (reportDate && isNaN(reportDate.getTime())) {
    return Response.json({ error: "Invalid reportDate" }, { status: 400 });
  }

  const session = await auth().catch(() => null);
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;
  const store = getBlobStore();

  const result = await uploadConsultantReport(
    bidId,
    {
      vendorName,
      title: text("title"),
      reportNumber: text("reportNumber"),
      reportType,
      reportDate,
      originalFilename,
      mimeType,
      bytes,
    },
    { name: user?.name ?? null, email: user?.email ?? null },
    async (key, buf) => {
      await store.put(key, buf, { contentType: mimeType });
    }
  );

  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  if (result.value.kind === "duplicate") {
    return Response.json(
      {
        ok: true,
        duplicate: true,
        reportId: result.value.reportId,
        revisionId: result.value.revisionId,
      },
      { status: 200 }
    );
  }
  return Response.json(
    {
      ok: true,
      duplicate: false,
      reportId: result.value.reportId,
      revisionId: result.value.revisionId,
    },
    { status: 201 }
  );
}

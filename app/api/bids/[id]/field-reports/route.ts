// Module OPS2 (Slice 2) — Field Report collection routes.
//
// GET  /api/bids/[id]/field-reports          — list reports (+ item counts)
// POST /api/bids/[id]/field-reports          — create a report row
//   Body: { title, reportDate?, authorName? }
//
// Auth: proxy session wall + bidId-scoped queries (same convention as every
// bid route). No provider/OCR/AI/Procore path exists below this route;
// uploads never auto-create items.

import { prisma } from "@/lib/prisma";
import { createFieldReport, listFieldReports } from "@/lib/services/fieldReports";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const reports = await listFieldReports(bidId);
  return Response.json({
    fieldReports: reports.map((r) => ({
      id: r.id,
      title: r.title,
      reportDate: r.reportDate?.toISOString() ?? null,
      authorName: r.authorName,
      originalFileName: r.originalFileName,
      mimeType: r.mimeType,
      byteSize: r.byteSize,
      parseStatus: r.parseStatus,
      trackedItemCount: r._count.trackedItems,
      hasFile: r.sourceFileStorageKey !== null,
      createdAt: r.createdAt.toISOString(),
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

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
  if (!bid) return Response.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let reportDate: Date | null = null;
  if (typeof body.reportDate === "string") {
    reportDate = new Date(body.reportDate);
    if (isNaN(reportDate.getTime()))
      return Response.json({ error: "Invalid reportDate" }, { status: 400 });
  }

  const result = await createFieldReport(bidId, {
    title: String(body.title ?? ""),
    reportDate,
    authorName: typeof body.authorName === "string" ? body.authorName : null,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ id: result.value.id }, { status: 201 });
}

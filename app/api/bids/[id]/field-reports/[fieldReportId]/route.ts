// Module OPS2 (Slice 2) — single Field Report routes.
//
// GET   …/field-reports/[fieldReportId]  — metadata + the tracked items citing it
// PATCH …/field-reports/[fieldReportId]  — update title/reportDate/authorName

import { getFieldReport, updateFieldReport } from "@/lib/services/fieldReports";
import { requireBidAccess } from "@/lib/auth-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fieldReportId: string }> }
) {
  const { id, fieldReportId } = await params;
  const bidId = parseInt(id, 10);
  const rid = parseInt(fieldReportId, 10);
  if (isNaN(bidId) || isNaN(rid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const report = await getFieldReport(bidId, rid);
  if (!report) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({
    id: report.id,
    title: report.title,
    reportDate: report.reportDate?.toISOString() ?? null,
    authorName: report.authorName,
    originalFileName: report.originalFileName,
    mimeType: report.mimeType,
    byteSize: report.byteSize,
    parseStatus: report.parseStatus,
    hasFile: report.sourceFileStorageKey !== null,
    trackedItems: report.trackedItems,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; fieldReportId: string }> }
) {
  const { id, fieldReportId } = await params;
  const bidId = parseInt(id, 10);
  const rid = parseInt(fieldReportId, 10);
  if (isNaN(bidId) || isNaN(rid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let reportDate: Date | null | undefined = undefined;
  if ("reportDate" in body) {
    if (body.reportDate === null) reportDate = null;
    else if (typeof body.reportDate === "string") {
      reportDate = new Date(body.reportDate);
      if (isNaN(reportDate.getTime()))
        return Response.json({ error: "Invalid reportDate" }, { status: 400 });
    } else return Response.json({ error: "Invalid reportDate" }, { status: 400 });
  }

  const result = await updateFieldReport(bidId, rid, {
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...(reportDate !== undefined ? { reportDate } : {}),
    ...("authorName" in body
      ? { authorName: typeof body.authorName === "string" ? body.authorName : null }
      : {}),
  }, access.user);
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true });
}

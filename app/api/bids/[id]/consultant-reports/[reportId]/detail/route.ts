// Module OPS3 (Phase 1A) — JSON detail for one consultant report.
//
// GET …/consultant-reports/[reportId]/detail
//
// (GET [reportId] itself serves the inline PDF — the card's route shape —
// so structured detail lives here.) Returns the report identity, its full
// revision chain, and every observation with the LIVE linked-item status
// (a fresh fetch each call, never a stale cache) plus the item's one
// formal response, so the report detail can render "carried forward"
// responses with zero copying.

import { getConsultantReport } from "@/lib/services/consultantReports";
import { requireBidAccess } from "@/lib/auth-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; reportId: string }> }
) {
  const { id, reportId } = await params;
  const bidId = parseInt(id, 10);
  const rid = parseInt(reportId, 10);
  if (isNaN(bidId) || isNaN(rid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const report = await getConsultantReport(bidId, rid);
  if (!report) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ consultantReport: report });
}

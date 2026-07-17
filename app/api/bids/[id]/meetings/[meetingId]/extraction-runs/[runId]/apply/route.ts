// Module R2-B1 — human APPLY of a previewed extraction run. One
// transaction: lifecycle rows (PROPOSED-replacement discipline) +
// non-destructive register reconcile (unchanged entries kept; removed
// extractions marked SUPERSEDED, never deleted; dispositioned entries never
// touched) + mandatory in-tx AuditEvent.
//
// POST …/extraction-runs/[runId]/apply

import { meetingRouteContext, serviceStatus } from "@/lib/services/meetingRegister/routeHelpers";
import { applyRun } from "@/lib/services/meetingRegister/extractionRuns";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string; runId: string }> }
) {
  const { id, meetingId, runId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;
  const rId = parseInt(runId, 10);
  if (isNaN(rId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const result = await applyRun(ctx.bidId, ctx.meetingId, rId, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: serviceStatus(result.error) });
  return Response.json({ ok: true, ...result.value });
}

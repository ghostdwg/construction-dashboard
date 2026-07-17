// Module R2-B1 — discard a previewed extraction run (kept on record).
//
// POST …/extraction-runs/[runId]/discard

import { meetingRouteContext, serviceStatus } from "@/lib/services/meetingRegister/routeHelpers";
import { discardRun } from "@/lib/services/meetingRegister/extractionRuns";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string; runId: string }> }
) {
  const { id, meetingId, runId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;
  const rId = parseInt(runId, 10);
  if (isNaN(rId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const result = await discardRun(ctx.bidId, ctx.meetingId, rId, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: serviceStatus(result.error) });
  return Response.json({ ok: true, ...result.value });
}

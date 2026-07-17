// Module R2-B1 — extraction runs (list). Runs are created by the analyze
// route (initial = applied; rerun = previewed) — R2 rules 7–8.
//
// GET …/extraction-runs

import { meetingRouteContext } from "@/lib/services/meetingRegister/routeHelpers";
import { listRuns } from "@/lib/services/meetingRegister/extractionRuns";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;

  const runs = await listRuns(ctx.bidId, ctx.meetingId);
  return Response.json({ ok: true, runs });
}

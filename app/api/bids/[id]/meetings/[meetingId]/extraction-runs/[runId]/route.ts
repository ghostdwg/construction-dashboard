// Module R2-B1 — one extraction run's preview detail (downstream-effect
// preview before applying a rerun — R2 rule 8).
//
// GET …/extraction-runs/[runId]

import { meetingRouteContext } from "@/lib/services/meetingRegister/routeHelpers";
import { getRun } from "@/lib/services/meetingRegister/extractionRuns";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string; runId: string }> }
) {
  const { id, meetingId, runId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;
  const rId = parseInt(runId, 10);
  if (isNaN(rId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const run = await getRun(ctx.bidId, ctx.meetingId, rId);
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    ok: true,
    run: {
      id: run.id,
      analysisVersion: run.analysisVersion,
      trigger: run.trigger,
      status: run.status,
      previewJson: run.previewJson,
      createdBy: run.createdBy,
      createdAt: run.createdAt,
      appliedBy: run.appliedBy,
      appliedAt: run.appliedAt,
    },
  });
}

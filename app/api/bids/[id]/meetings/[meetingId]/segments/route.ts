// Module R2-B1 — transcript segments (materialize-on-first-read + list).
// Meeting.rawTranscript stays immutable; this only projects it.
//
// GET …/segments

import { meetingRouteContext, serviceStatus } from "@/lib/services/meetingRegister/routeHelpers";
import { listSegments, materializeSegments } from "@/lib/services/meetingRegister/segments";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;

  const materialized = await materializeSegments(ctx.bidId, ctx.meetingId);
  if (!materialized.ok) {
    return Response.json({ error: materialized.error }, { status: serviceStatus(materialized.error) });
  }
  const segments = await listSegments(ctx.bidId, ctx.meetingId);
  return Response.json({ ok: true, segments, materialized: materialized.value });
}

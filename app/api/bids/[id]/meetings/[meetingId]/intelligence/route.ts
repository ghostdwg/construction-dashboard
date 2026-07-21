// Meeting Intelligence v1 read model. Dynamic by construction: this route
// performs authenticated database reads and is not cached.

import { meetingRouteContext } from "@/lib/services/meetingRegister/routeHelpers";
import { getMeetingIntelligence } from "@/lib/services/meetingIntelligence/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  const { id, meetingId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;
  const intelligence = await getMeetingIntelligence(ctx.bidId, ctx.meetingId);
  if (!intelligence) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true, ...intelligence });
}

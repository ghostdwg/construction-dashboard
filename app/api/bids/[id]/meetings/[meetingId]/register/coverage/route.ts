// Module R2-B1 — Meeting Register disposition coverage. fullyReviewed is
// false while any extracted entry is undispositioned (R2 rule 11).
//
// GET …/register/coverage

import { meetingRouteContext } from "@/lib/services/meetingRegister/routeHelpers";
import { getCoverage } from "@/lib/services/meetingRegister/register";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> }
) {
  const { id, meetingId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;

  const coverage = await getCoverage(ctx.bidId, ctx.meetingId);
  return Response.json({ ok: true, coverage });
}

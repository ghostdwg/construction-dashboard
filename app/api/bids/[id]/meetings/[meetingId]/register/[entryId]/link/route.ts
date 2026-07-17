// Module R2-B1 — link a Meeting Register entry to an EXISTING Operations
// Register item (cross-meeting continuity, R2 rule 10). Same-bid enforced.
//
// POST …/register/[entryId]/link
// Body: { trackedItemId }

import { meetingRouteContext, serviceStatus } from "@/lib/services/meetingRegister/routeHelpers";
import { linkEntryToItem } from "@/lib/services/meetingRegister/promotion";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string; entryId: string }> }
) {
  const { id, meetingId, entryId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;
  const eId = parseInt(entryId, 10);
  if (isNaN(eId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  let body: { trackedItemId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const trackedItemId = typeof body.trackedItemId === "number" ? body.trackedItemId : NaN;
  if (!Number.isInteger(trackedItemId)) {
    return Response.json({ error: "trackedItemId is required" }, { status: 400 });
  }

  const result = await linkEntryToItem(ctx.bidId, ctx.meetingId, eId, trackedItemId, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: serviceStatus(result.error) });
  return Response.json({ ok: true, ...result.value });
}

// Module R2-B1 — single Meeting Register entry.
//
// PATCH …/register/[entryId] — edit normalized fields (rawSourceText frozen).
// Auth: requireBidAccess before body parsing.

import { meetingRouteContext, serviceStatus } from "@/lib/services/meetingRegister/routeHelpers";
import { editEntry, type EditEntryInput } from "@/lib/services/meetingRegister/register";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string; entryId: string }> }
) {
  const { id, meetingId, entryId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;
  const eId = parseInt(entryId, 10);
  if (isNaN(eId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  let body: EditEntryInput;
  try {
    body = (await request.json()) as EditEntryInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await editEntry(ctx.bidId, ctx.meetingId, eId, body, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: serviceStatus(result.error) });
  return Response.json({ ok: true, ...result.value });
}

// Module R2-B1 — human disposition of a Meeting Register entry (R2 rule 11).
//
// POST …/register/[entryId]/disposition
// Body: { disposition, reason?, targetEntryId?, correctedText? }
// PROMOTED_TO_OPERATIONS is rejected here — use /promote or /link.

import { meetingRouteContext, serviceStatus } from "@/lib/services/meetingRegister/routeHelpers";
import { dispositionEntry, type DispositionInput } from "@/lib/services/meetingRegister/register";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string; entryId: string }> }
) {
  const { id, meetingId, entryId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;
  const eId = parseInt(entryId, 10);
  if (isNaN(eId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  let body: DispositionInput;
  try {
    body = (await request.json()) as DispositionInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await dispositionEntry(ctx.bidId, ctx.meetingId, eId, body, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: serviceStatus(result.error) });
  return Response.json({ ok: true, ...result.value });
}

// Module R2-B1 — promote a Meeting Register entry into the Operations
// Register (TrackedItem) with full source provenance. Promotion never
// removes the register entry (R2 Part C.6).
//
// POST …/register/[entryId]/promote
// Body: { kind?, title?, priority?, tradeId?, dueDate? }

import { meetingRouteContext, serviceStatus } from "@/lib/services/meetingRegister/routeHelpers";
import { promoteEntry, type PromoteInput } from "@/lib/services/meetingRegister/promotion";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string; entryId: string }> }
) {
  const { id, meetingId, entryId } = await params;
  const ctx = await meetingRouteContext(id, meetingId);
  if (!ctx.ok) return ctx.response;
  const eId = parseInt(entryId, 10);
  if (isNaN(eId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  let body: PromoteInput;
  try {
    body = (await request.json()) as PromoteInput;
  } catch {
    body = {};
  }

  const result = await promoteEntry(ctx.bidId, ctx.meetingId, eId, body, ctx.actor);
  if (!result.ok) return Response.json({ error: result.error }, { status: serviceStatus(result.error) });
  return Response.json({ ok: true, ...result.value }, { status: 201 });
}

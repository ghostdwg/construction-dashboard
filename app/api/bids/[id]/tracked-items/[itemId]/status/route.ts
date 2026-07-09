// Module OPS1 (Slice 1) — FSM-validated status transitions. HUMAN-ONLY:
// the actor comes from the authenticated session; there is no system caller.
//
// POST /api/bids/[id]/tracked-items/[itemId]/status
//   Body: { to, waivedReason?, note? }
//   - to=CLOSED  requires a session actor (closedBy) — 400 without one
//   - to=WAIVED  requires waivedReason
//   - note, when present, is appended to the item's comment thread

import { auth } from "@/lib/auth";
import { transitionTrackedItem } from "@/lib/services/trackedItems";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const bidId = parseInt(id, 10);
  const tid = parseInt(itemId, 10);
  if (isNaN(bidId) || isNaN(tid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  let body: { to?: unknown; waivedReason?: unknown; note?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.to !== "string") {
    return Response.json({ error: "to is required" }, { status: 400 });
  }

  const session = await auth().catch(() => null);
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await transitionTrackedItem(
    bidId,
    tid,
    body.to,
    { name: user?.name ?? null, email: user?.email ?? null },
    {
      waivedReason: typeof body.waivedReason === "string" ? body.waivedReason : null,
      note: typeof body.note === "string" ? body.note : null,
    }
  );

  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ ok: true, status: result.value.status });
}

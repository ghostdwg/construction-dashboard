// Module OPS1 (Slice 1) — OAC bridge: promote an existing MeetingActionItem
// into the tracked-item register.
//
// POST /api/bids/[id]/tracked-items/promote   body: { meetingActionItemId }
//
// HUMAN-CHOSEN, one item per request — never bulk, never automatic. The
// MeetingActionItem row is read-only source evidence: promotion copies its
// description/assignee/due/priority/evidence excerpt into a new TrackedItem
// (kind OAC_ACTION, sourceKind "meeting") and NEVER edits or deletes the
// original. A unique constraint plus a friendly pre-check guarantee at most
// one TrackedItem per action item. Speaker attributions inside the carried
// evidence are draft diarization labels, not verified identity.

import { auth } from "@/lib/auth";
import { promoteMeetingActionItem } from "@/lib/services/trackedItems";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  let body: { meetingActionItemId?: unknown };
  try {
    body = (await request.json()) as { meetingActionItemId?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const actionItemId = Number(body.meetingActionItemId);
  if (!Number.isInteger(actionItemId) || actionItemId <= 0) {
    return Response.json({ error: "meetingActionItemId is required" }, { status: 400 });
  }

  const session = await auth().catch(() => null);
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;

  const result = await promoteMeetingActionItem(bidId, actionItemId, {
    name: user?.name ?? null,
    email: user?.email ?? null,
  });

  if (!result.ok) {
    const status = /not found/i.test(result.error) ? 404 : /once/i.test(result.error) ? 409 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json({ id: result.value.id }, { status: 201 });
}

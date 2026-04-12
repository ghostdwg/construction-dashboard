// GET /api/bids/[id]/notifications/award/status
//
// Module H8 — Returns the delivery log for award notifications on this bid.
// Powers the delivery status table on the HandoffTab.

import { getAwardNotificationStatus } from "@/lib/services/notifications/awardNotificationService";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  try {
    const status = await getAwardNotificationStatus(bidId);
    return Response.json(status);
  } catch (err) {
    console.error("[GET /api/bids/:id/notifications/award/status]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

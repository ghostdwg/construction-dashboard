// GET /api/bids/[id]/notifications/award/preview
//
// Module H8 — Returns who would receive award notifications for this bid
// (awarded subs + project team), along with email configuration status and
// whether notifications have already been sent.

import { previewAwardNotifications } from "@/lib/services/notifications/awardNotificationService";

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
    const preview = await previewAwardNotifications(bidId);
    if (!preview) {
      return Response.json({ error: "Bid not found" }, { status: 404 });
    }
    return Response.json(preview);
  } catch (err) {
    console.error("[GET /api/bids/:id/notifications/award/preview]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// GET /api/bids/[id]/handoff
//
// Returns the assembled handoff packet as JSON. Used by the Handoff tab UI.
//
// Works for ANY bid status — the estimator can preview the packet before
// officially awarding. The packet's `isAwarded` flag tells the UI whether to
// show the preview banner.

import { assembleHandoffPacket } from "@/lib/services/handoff/assembleHandoffPacket";

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
    const packet = await assembleHandoffPacket(bidId);
    if (!packet) {
      return Response.json({ error: "Bid not found" }, { status: 404 });
    }
    return Response.json(packet);
  } catch (err) {
    console.error("[GET /api/bids/:id/handoff]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

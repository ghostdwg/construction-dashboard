// GET /api/bids/[id]/buyout
//
// Returns the list of BuyoutItems for a bid, auto-creating rows for any
// BidTrade that doesn't have one yet. Also returns a financial rollup.

import {
  loadBuyoutItemsForBid,
  computeBuyoutRollup,
} from "@/lib/services/buyout/buyoutService";

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
    const items = await loadBuyoutItemsForBid(bidId);
    const rollup = computeBuyoutRollup(items);
    return Response.json({ items, rollup });
  } catch (err) {
    console.error("[GET /api/bids/:id/buyout]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

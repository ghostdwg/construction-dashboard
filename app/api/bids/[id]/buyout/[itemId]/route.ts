// PATCH /api/bids/[id]/buyout/[itemId]
//
// Updates a single BuyoutItem. Body contains any subset of the editable fields.
// Validates numeric fields and contractStatus in the service layer.

import {
  updateBuyoutItem,
  type BuyoutUpdateInput,
} from "@/lib/services/buyout/buyoutService";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const bidId = parseInt(id, 10);
  const buyoutId = parseInt(itemId, 10);

  if (isNaN(bidId) || isNaN(buyoutId)) {
    return Response.json({ error: "Invalid ids" }, { status: 400 });
  }

  let body: BuyoutUpdateInput;
  try {
    body = (await request.json()) as BuyoutUpdateInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await updateBuyoutItem(bidId, buyoutId, body);
    if (!result.ok) {
      const status = result.error.includes("not found") ? 404 : 400;
      return Response.json({ error: result.error }, { status });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[PATCH /api/bids/:id/buyout/:itemId]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

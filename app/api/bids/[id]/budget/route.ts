// GET   /api/bids/[id]/budget — returns assembled budget JSON
// PATCH /api/bids/[id]/budget — saves GC line items
//
// Module H6 — Budget Creation.

import {
  assembleBudget,
  updateBudgetGcLines,
} from "@/lib/services/budget/assembleBudget";

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
    const budget = await assembleBudget(bidId);
    if (!budget) {
      return Response.json({ error: "Bid not found" }, { status: 404 });
    }
    return Response.json(budget);
  } catch (err) {
    console.error("[GET /api/bids/:id/budget]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  let body: { gcLines?: unknown };
  try {
    body = (await request.json()) as { gcLines?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await updateBudgetGcLines(bidId, body.gcLines);
    if (!result.ok) {
      const status = result.error.includes("not found") ? 404 : 400;
      return Response.json({ error: result.error }, { status });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[PATCH /api/bids/:id/budget]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

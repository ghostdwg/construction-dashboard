// GET /api/bids/[id]/submittals        → list + rollup (with optional filters)
// POST /api/bids/[id]/submittals       → manually add a new submittal

import {
  loadSubmittalsForBid,
  computeSubmittalRollup,
  createSubmittal,
  type SubmittalCreateInput,
} from "@/lib/services/submittal/submittalService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const type = url.searchParams.get("type") ?? undefined;
  const bidTradeIdParam = url.searchParams.get("bidTradeId");
  const bidTradeId = bidTradeIdParam ? parseInt(bidTradeIdParam, 10) : undefined;

  try {
    const items = await loadSubmittalsForBid(bidId, { status, type, bidTradeId });
    const rollup = computeSubmittalRollup(items);
    return Response.json({ items, rollup });
  } catch (err) {
    console.error("[GET /api/bids/:id/submittals]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid id" }, { status: 400 });
  }

  let body: SubmittalCreateInput;
  try {
    body = (await request.json()) as SubmittalCreateInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await createSubmittal(bidId, body);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    return Response.json({ ok: true, id: result.id });
  } catch (err) {
    console.error("[POST /api/bids/:id/submittals]", err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

import { prisma } from "@/lib/prisma";

// PATCH /api/bids/[id]/trades/[tradeId]
// Body: { tier?, leadTimeDays?, rfqSentAt?, rfqNotes? }
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; tradeId: string }> }
) {
  const { id, tradeId } = await params;
  const bidId = parseInt(id, 10);
  const tId = parseInt(tradeId, 10);
  if (isNaN(bidId) || isNaN(tId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const data: {
    tier?: string;
    leadTimeDays?: number | null;
    rfqSentAt?: Date | null;
    quotesReceivedAt?: Date | null;
    rfqNotes?: string | null;
  } = {};

  if ("tier" in body) {
    const t = String(body.tier);
    if (!["TIER1", "TIER2", "TIER3"].includes(t)) {
      return Response.json({ error: "tier must be TIER1, TIER2, or TIER3" }, { status: 400 });
    }
    data.tier = t;
  }

  if ("leadTimeDays" in body) {
    const v = body.leadTimeDays;
    data.leadTimeDays = v == null ? null : Number(v);
  }

  if ("rfqSentAt" in body) {
    const v = body.rfqSentAt;
    data.rfqSentAt = v == null ? null : new Date(String(v));
  }

  if ("quotesReceivedAt" in body) {
    const v = body.quotesReceivedAt;
    data.quotesReceivedAt = v == null ? null : new Date(String(v));
  }

  if ("rfqNotes" in body) {
    data.rfqNotes = body.rfqNotes == null ? null : String(body.rfqNotes);
  }

  const updated = await prisma.bidTrade.updateMany({
    where: { bidId, tradeId: tId },
    data,
  });

  if (updated.count === 0) {
    return Response.json({ error: "Trade not found on this bid" }, { status: 404 });
  }

  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; tradeId: string }> }
) {
  const { id, tradeId } = await params;
  const bidId = parseInt(id, 10);
  const tId = parseInt(tradeId, 10);

  if (isNaN(bidId) || isNaN(tId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  await prisma.bidTrade.deleteMany({
    where: { bidId, tradeId: tId },
  });

  return new Response(null, { status: 204 });
}

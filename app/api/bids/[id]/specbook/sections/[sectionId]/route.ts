import { prisma } from "@/lib/prisma";
import { autoPopulateBidSubs } from "@/lib/services/autoPopulateBidSubs";
import { Prisma } from "@prisma/client";

// PATCH /api/bids/[id]/specbook/sections/[sectionId]
// Body: { tradeId: number | null }
// Manually assigns (or clears) a trade for a spec section.
// If tradeId is set and the trade is not already on the bid, creates a BidTrade.
// Clears matchedTradeId so the section becomes fully covered (or unknown if cleared).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const { id, sectionId } = await params;
  const bidId = parseInt(id, 10);
  const secId = parseInt(sectionId, 10);

  if (isNaN(bidId) || isNaN(secId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json();
  const { tradeId } = body as { tradeId: number | null };

  if (tradeId !== null && tradeId !== undefined && typeof tradeId !== "number") {
    return Response.json({ error: "tradeId must be a number or null" }, { status: 400 });
  }

  try {
    // If assigning a trade, ensure it's on the bid
    if (tradeId != null) {
      const existing = await prisma.bidTrade.findUnique({
        where: { bidId_tradeId: { bidId, tradeId } },
      });
      if (!existing) {
        await prisma.bidTrade.create({ data: { bidId, tradeId } });
        await autoPopulateBidSubs(bidId);
      }
    }

    const section = await prisma.specSection.update({
      where: { id: secId },
      data: {
        tradeId: tradeId ?? null,
        matchedTradeId: null,
        covered: tradeId != null,
      },
      include: {
        trade: { select: { id: true, name: true } },
        matchedTrade: { select: { id: true, name: true } },
      },
    });

    return Response.json(section);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return Response.json({ error: "Section not found" }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

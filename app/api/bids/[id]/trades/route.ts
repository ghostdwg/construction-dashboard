import { prisma } from "@/lib/prisma";
import { autoPopulateBidSubs } from "@/lib/services/autoPopulateBidSubs";
import { Prisma } from "@prisma/client";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);

  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json();
  const tradeId = parseInt(body.tradeId, 10);

  if (isNaN(tradeId)) {
    return Response.json({ error: "tradeId is required" }, { status: 400 });
  }

  try {
    const bidTrade = await prisma.bidTrade.create({
      data: { bidId, tradeId },
      include: { trade: true },
    });

    await autoPopulateBidSubs(bidId);

    return Response.json(bidTrade, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return Response.json({ error: "Trade already assigned to this bid" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

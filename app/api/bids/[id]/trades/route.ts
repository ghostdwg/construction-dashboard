import { prisma } from "@/lib/prisma";

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

  const bidTrade = await prisma.bidTrade.create({
    data: { bidId, tradeId },
    include: { trade: true },
  });

  return Response.json(bidTrade, { status: 201 });
}

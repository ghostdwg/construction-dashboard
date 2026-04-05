import { prisma } from "@/lib/prisma";

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

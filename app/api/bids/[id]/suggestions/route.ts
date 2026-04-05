import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);

  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    include: {
      bidTrades: true,
      selections: true,
    },
  });

  if (!bid) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const tradeIds = bid.bidTrades.map((bt) => bt.tradeId);
  const selectedSubIds = bid.selections.map((s) => s.subcontractorId);

  if (tradeIds.length === 0) {
    return Response.json([]);
  }

  const subs = await prisma.subcontractor.findMany({
    where: {
      status: { not: "inactive" },
      id: { notIn: selectedSubIds.length ? selectedSubIds : [-1] },
      subTrades: { some: { tradeId: { in: tradeIds } } },
    },
    include: {
      subTrades: {
        where: { tradeId: { in: tradeIds } },
        include: { trade: true },
      },
      contacts: { where: { isPrimary: true }, take: 1 },
    },
    orderBy: { company: "asc" },
  });

  return Response.json(subs);
}

import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);

  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid bid ID" }, { status: 400 });
  }

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    include: {
      bidTrades: {
        include: {
          trade: true,
        },
        orderBy: { id: "asc" },
      },
      selections: {
        include: {
          subcontractor: {
            include: {
              contacts: {
                where: { isPrimary: true },
                take: 1,
              },
            },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!bid) {
    return Response.json({ error: "Bid not found" }, { status: 404 });
  }

  return Response.json(bid);
}

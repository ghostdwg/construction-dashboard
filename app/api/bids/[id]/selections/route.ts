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
  const subcontractorId = parseInt(body.subcontractorId, 10);
  const tradeId = body.tradeId ? parseInt(body.tradeId, 10) : null;

  if (isNaN(subcontractorId)) {
    return Response.json({ error: "subcontractorId is required" }, { status: 400 });
  }

  const selection = await prisma.bidInviteSelection.create({
    data: {
      bidId,
      subcontractorId,
      tradeId: tradeId && !isNaN(tradeId) ? tradeId : null,
    },
    include: {
      subcontractor: {
        include: {
          contacts: { where: { isPrimary: true }, take: 1 },
          subTrades: { include: { trade: true } },
        },
      },
    },
  });

  return Response.json(selection, { status: 201 });
}

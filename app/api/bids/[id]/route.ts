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
      bidTrades: { include: { trade: true }, orderBy: { id: "asc" } },
      selections: { include: { subcontractor: true } },
    },
  });

  if (!bid) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(bid);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);

  if (isNaN(bidId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json();
  const { projectName, location, description, status, dueDate } = body;

  const bid = await prisma.bid.update({
    where: { id: bidId },
    data: {
      ...(projectName !== undefined ? { projectName } : {}),
      ...(location !== undefined ? { location: location || null } : {}),
      ...(description !== undefined ? { description: description || null } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
    },
  });

  return Response.json(bid);
}

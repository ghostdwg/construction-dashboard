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

  const items = await prisma.scopeItem.findMany({
    where: { bidId },
    include: {
      tradeAssignments: { include: { trade: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return Response.json(items);
}

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
  const { description, notes, tradeId } = body as {
    description: string;
    notes?: string;
    tradeId?: number;
  };

  if (!description?.trim()) {
    return Response.json({ error: "description is required" }, { status: 400 });
  }

  const item = await prisma.scopeItem.create({
    data: {
      bidId,
      description: description.trim(),
      notes: notes?.trim() || null,
      tradeAssignments: tradeId
        ? { create: [{ tradeId }] }
        : undefined,
    },
    include: {
      tradeAssignments: { include: { trade: true } },
    },
  });

  return Response.json(item, { status: 201 });
}

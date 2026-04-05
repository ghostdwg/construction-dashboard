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
      trade: true,
      tradeAssignments: { include: { trade: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  type TradeShape = { id: number; name: string };
  type ItemShape = (typeof items)[number];
  const byTrade: Record<string, { trade: TradeShape; items: ItemShape[] }> = {};
  const unassigned: ItemShape[] = [];

  for (const item of items) {
    if (item.tradeId && item.trade) {
      const key = String(item.tradeId);
      if (!byTrade[key]) byTrade[key] = { trade: item.trade, items: [] };
      byTrade[key].items.push(item);
    } else {
      unassigned.push(item);
    }
  }

  return Response.json({ byTrade, unassigned });
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
  const {
    description,
    tradeId,
    inclusion,
    specSection,
    drawingRef,
    notes,
    riskFlag,
  } = body as {
    description: string;
    tradeId?: number;
    inclusion?: boolean;
    specSection?: string;
    drawingRef?: string;
    notes?: string;
    riskFlag?: boolean;
  };

  if (!description?.trim()) {
    return Response.json({ error: "description is required" }, { status: 400 });
  }

  const item = await prisma.scopeItem.create({
    data: {
      bidId,
      description: description.trim(),
      tradeId: tradeId ?? null,
      inclusion: inclusion ?? true,
      specSection: specSection?.trim() || null,
      drawingRef: drawingRef?.trim() || null,
      notes: notes?.trim() || null,
      riskFlag: riskFlag ?? false,
      // restricted is not settable via this route — always defaults false
    },
    include: {
      trade: true,
      tradeAssignments: { include: { trade: true } },
    },
  });

  return Response.json(item, { status: 201 });
}

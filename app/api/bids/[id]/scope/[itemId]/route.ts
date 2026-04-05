import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const bidId = parseInt(id, 10);
  const scopeItemId = parseInt(itemId, 10);

  if (isNaN(bidId) || isNaN(scopeItemId)) {
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
    // restricted is intentionally destructured away — not patchable via this route
  } = body as {
    description?: string;
    tradeId?: number | null;
    inclusion?: boolean;
    specSection?: string | null;
    drawingRef?: string | null;
    notes?: string | null;
    riskFlag?: boolean;
    restricted?: never;
  };

  const item = await prisma.scopeItem.update({
    where: { id: scopeItemId, bidId },
    data: {
      ...(description !== undefined && { description: description.trim() }),
      ...(tradeId !== undefined && { tradeId }),
      ...(inclusion !== undefined && { inclusion }),
      ...(specSection !== undefined && { specSection: specSection?.trim() || null }),
      ...(drawingRef !== undefined && { drawingRef: drawingRef?.trim() || null }),
      ...(notes !== undefined && { notes: notes?.trim() || null }),
      ...(riskFlag !== undefined && { riskFlag }),
    },
    include: {
      trade: true,
      tradeAssignments: { include: { trade: true } },
    },
  });

  return Response.json(item);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const bidId = parseInt(id, 10);
  const scopeItemId = parseInt(itemId, 10);

  if (isNaN(bidId) || isNaN(scopeItemId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  await prisma.scopeItem.delete({ where: { id: scopeItemId, bidId } });

  return new Response(null, { status: 204 });
}

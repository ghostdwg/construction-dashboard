import { prisma } from "@/lib/prisma";

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

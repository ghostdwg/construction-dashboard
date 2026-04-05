import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; selectionId: string }> }
) {
  const { id, selectionId } = await params;
  const bidId = parseInt(id, 10);
  const selId = parseInt(selectionId, 10);

  if (isNaN(bidId) || isNaN(selId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  await prisma.bidInviteSelection.delete({
    where: { id: selId },
  });

  return new Response(null, { status: 204 });
}

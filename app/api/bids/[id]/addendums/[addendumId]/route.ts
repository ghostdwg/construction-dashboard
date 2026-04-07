import { prisma } from "@/lib/prisma";
import { generateBidIntelligenceBrief } from "@/lib/services/ai/generateBidIntelligenceBrief";

// DELETE /api/bids/[id]/addendums/[addendumId]
// Deletes the addendum record, marks brief stale, fires regeneration.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; addendumId: string }> }
) {
  const { id, addendumId } = await params;
  const bidId = parseInt(id, 10);
  const aId = parseInt(addendumId, 10);
  if (isNaN(bidId) || isNaN(aId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const record = await prisma.addendumUpload.findUnique({
    where: { id: aId },
    select: { id: true, bidId: true },
  });
  if (!record || record.bidId !== bidId) {
    return Response.json({ error: "Addendum not found" }, { status: 404 });
  }

  await prisma.addendumUpload.delete({ where: { id: aId } });

  // Mark brief stale and regenerate
  await prisma.bidIntelligenceBrief.updateMany({
    where: { bidId },
    data: { isStale: true },
  });

  generateBidIntelligenceBrief(bidId, "addendum_delete").catch((err) =>
    console.error("[addendums/delete] background brief generation failed:", err)
  );

  return Response.json({ deleted: true });
}

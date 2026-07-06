import { prisma } from "@/lib/prisma";
import { triggerBriefRefresh } from "@/lib/services/jobs/briefRefreshAutomation";
import { deleteAddendumStoragePath } from "@/lib/services/addendums/storagePath";

// DELETE /api/bids/[id]/addendums/[addendumId]
// Deletes the addendum record, marks brief stale, fires regeneration, and
// best-effort cleans up the durable blob if this row has a storageKey.
// Historic rows (written before the storageKey column existed) have no
// on-disk reference at all — a null storageKey is a safe no-op, never a
// guessed path.
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
    select: { id: true, bidId: true, storageKey: true },
  });
  if (!record || record.bidId !== bidId) {
    return Response.json({ error: "Addendum not found" }, { status: 404 });
  }

  await prisma.addendumUpload.delete({ where: { id: aId } });

  // Clean up the durable blob (best-effort — a missing/invalid/null key is
  // a no-op, never an error that blocks the delete).
  if (record.storageKey) {
    await deleteAddendumStoragePath(record.storageKey, bidId).catch(() => {});
  }

  // Mark brief stale and regenerate
  await prisma.bidIntelligenceBrief.updateMany({
    where: { bidId },
    data: { isStale: true },
  });

  triggerBriefRefresh(bidId, { triggerSource: "upload" }).catch((err) =>
    console.error("[addendums/delete] background brief refresh failed:", err)
  );

  return Response.json({ deleted: true });
}

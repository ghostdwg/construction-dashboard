import { prisma } from "@/lib/prisma";
import { deleteStoragePath } from "@/lib/services/specbook/storagePath";

// DELETE /api/bids/[id]/specbook/[uploadId]
// Removes a spec book, its sections, and the files on disk.
// Nulls out specSectionId on any SubmittalItems linked to this book's sections
// (Prisma SetNull default; handled explicitly for safety).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; uploadId: string }> }
) {
  const { id, uploadId } = await params;
  const bidId = parseInt(id, 10);
  const specBookId = parseInt(uploadId, 10);
  if (isNaN(bidId) || isNaN(specBookId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const specBook = await prisma.specBook.findFirst({
    where: { id: specBookId, bidId },
    include: {
      sections: {
        select: { id: true, pdfPath: true },
      },
    },
  });
  if (!specBook)
    return Response.json({ error: "Spec book not found" }, { status: 404 });

  // Disconnect any submittals linked to sections in this book
  const sectionIds = specBook.sections.map((s) => s.id);
  if (sectionIds.length > 0) {
    await prisma.submittalItem.updateMany({
      where: { specSectionId: { in: sectionIds } },
      data: { specSectionId: null },
    });
  }

  // Delete DB record — sections cascade via onDelete: Cascade
  await prisma.specBook.delete({ where: { id: specBookId } });

  // Clean up artifacts (best-effort — don't fail if any are already missing).
  // Only ever the specific keys/paths this spec book is known to own — never
  // a bid/project-wide prefix sweep. deleteStoragePath() dispatches by shape
  // (see lib/services/specbook/storagePath.ts): canonical and production
  // storage-root paths go through BlobStore.delete() against the derived
  // key, legacy cwd-rooted paths are unlinked directly, and an invalid
  // reference is a no-op.
  const artifacts = [
    specBook.filePath,
    ...specBook.sections.map((s) => s.pdfPath).filter(Boolean) as string[],
  ];
  await Promise.allSettled(artifacts.map((p) => deleteStoragePath(p)));

  return new Response(null, { status: 204 });
}

import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { readDrawingStorageBuffer } from "@/lib/services/drawings/storagePath";
import { deleteDrawingStorageIfUnreferenced } from "@/lib/services/storage/referenceSafety";
import { privateDownloadHeaders } from "@/lib/services/storage/downloadHeaders";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; uploadId: string }> },
) {
  const { id, uploadId } = await params;
  const bidId = parseInt(id, 10);
  const drawingUploadId = parseInt(uploadId, 10);
  if (isNaN(bidId) || isNaN(drawingUploadId)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const upload = await prisma.drawingUpload.findFirst({
    where: { id: drawingUploadId, bidId },
    select: { fileName: true, filePath: true },
  });
  if (!upload) return Response.json({ error: "Not found" }, { status: 404 });

  let buffer: Buffer;
  try {
    buffer = await readDrawingStorageBuffer(upload.filePath, bidId);
  } catch {
    return Response.json({ error: "File is missing from storage" }, { status: 404 });
  }
  return new Response(new Uint8Array(buffer), {
    headers: privateDownloadHeaders({
      mimeType: "application/pdf",
      fileName: upload.fileName,
      byteSize: buffer.byteLength,
    }),
  });
}

// DELETE /api/bids/[id]/drawings/[uploadId]
// Removes a single drawing upload record, its sheets (cascade), and the PDF
// on disk. deleteDrawingStoragePath() dispatches by shape (see
// lib/services/drawings/storagePath.ts): canonical and production
// storage-root paths go through BlobStore.delete() against the derived key,
// legacy cwd-rooted paths are unlinked directly, and an invalid/malformed or
// wrong-bid reference is a no-op — never an arbitrary fs.unlink.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; uploadId: string }> }
) {
  const { id, uploadId } = await params;
  const bidId = parseInt(id, 10);
  const drawingUploadId = parseInt(uploadId, 10);
  if (isNaN(bidId) || isNaN(drawingUploadId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const upload = await prisma.drawingUpload.findFirst({
    where: { id: drawingUploadId, bidId },
    select: { id: true, filePath: true },
  });
  if (!upload)
    return Response.json({ error: "Drawing upload not found" }, { status: 404 });

  // Delete DB record — sheets cascade via onDelete: Cascade
  await prisma.drawingUpload.delete({ where: { id: drawingUploadId } });

  // Delete only after a global durable-reference scan proves it is orphaned.
  await deleteDrawingStorageIfUnreferenced(upload.filePath, bidId).catch((err) => {
    console.error("[drawings/delete] unreferenced blob cleanup failed:", err);
  });

  return new Response(null, { status: 204 });
}

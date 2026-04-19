import fs from "fs/promises";
import { prisma } from "@/lib/prisma";

// DELETE /api/bids/[id]/drawings/[uploadId]
// Removes a single drawing upload record, its sheets (cascade), and the PDF on disk.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; uploadId: string }> }
) {
  const { id, uploadId } = await params;
  const bidId = parseInt(id, 10);
  const drawingUploadId = parseInt(uploadId, 10);
  if (isNaN(bidId) || isNaN(drawingUploadId))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const upload = await prisma.drawingUpload.findFirst({
    where: { id: drawingUploadId, bidId },
    select: { id: true, filePath: true },
  });
  if (!upload)
    return Response.json({ error: "Drawing upload not found" }, { status: 404 });

  // Delete DB record — sheets cascade via onDelete: Cascade
  await prisma.drawingUpload.delete({ where: { id: drawingUploadId } });

  // Clean up file from disk (best-effort)
  await fs.unlink(upload.filePath).catch(() => {});

  return new Response(null, { status: 204 });
}

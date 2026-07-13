// Module OPS6 (Phase 2) — authenticated download of one stream export.
//
// GET …/consultant-reports/export-pdf/[exportId]/download
//
// The 1A private-download pattern verbatim: requireBidAccess → bid-scoped
// export fetch (cross-project 404) → blob read LAST by the SERVER-STORED
// key → attachment disposition, nosniff, private/no-store. Never a public
// or signed URL; a metadata row whose blob is missing is an honest 404.

import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { getBlobStore } from "@/lib/storage/blobStore";
import { privateDownloadHeaders } from "@/lib/services/storage/downloadHeaders";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; exportId: string }> }
) {
  const { id, exportId } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId) || !exportId)
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const exportRow = await prisma.consultantStreamExport.findFirst({
    where: { id: exportId, bidId },
    select: { storedKey: true, byteSize: true, generatedAt: true },
  });
  if (!exportRow) return Response.json({ error: "Not found" }, { status: 404 });

  let buffer: Buffer;
  try {
    buffer = await getBlobStore().get(exportRow.storedKey);
  } catch (err) {
    console.error(
      "[consultant-stream-export] blob missing/unreadable for metadata row:",
      err instanceof Error ? err.message : err
    );
    return Response.json({ error: "File is missing from storage" }, { status: 404 });
  }

  const dateStr = exportRow.generatedAt.toISOString().slice(0, 10);
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: privateDownloadHeaders({
      mimeType: "application/pdf",
      fileName: `consultant-stream-${dateStr}.pdf`,
      byteSize: buffer.byteLength,
    }),
  });
}

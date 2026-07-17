// OPS private file serving V0 — authenticated download of a Field Report's
// uploaded source file.
//
// GET …/field-reports/[fieldReportId]/download
//
// Security order (each step before the next; blob is read LAST):
//   1. session wall (proxy.ts);
//   2. report must belong to THIS bid (404 otherwise — cross-bid blocked
//      before any blob access);
//   3. report must actually have an uploaded file (404 with a clear message
//      otherwise);
//   4. only then is the blob read — by the SERVER-STORED
//      sourceFileStorageKey. Clients supply ids only, never keys.
// Headers per lib/services/storage/downloadHeaders.ts (attachment
// disposition, allowlisted Content-Type, nosniff, private/no-store).

import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { getBlobStore } from "@/lib/storage/blobStore";
import { privateDownloadHeaders } from "@/lib/services/storage/downloadHeaders";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fieldReportId: string }> }
) {
  const { id, fieldReportId } = await params;
  const bidId = parseInt(id, 10);
  const rid = parseInt(fieldReportId, 10);
  if (isNaN(bidId) || isNaN(rid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const report = await prisma.fieldReport.findFirst({
    where: { id: rid, bidId },
    select: {
      sourceFileStorageKey: true,
      originalFileName: true,
      mimeType: true,
      byteSize: true,
    },
  });
  if (!report) return Response.json({ error: "Not found" }, { status: 404 });
  if (!report.sourceFileStorageKey) {
    return Response.json(
      { error: "No file has been uploaded for this report" },
      { status: 404 }
    );
  }

  let buffer: Buffer;
  try {
    buffer = await getBlobStore().get(report.sourceFileStorageKey);
  } catch (err) {
    console.error(
      "[field-reports] source blob missing/unreadable for metadata row:",
      err instanceof Error ? err.message : err
    );
    return Response.json(
      { error: "File is missing from storage" },
      { status: 404 }
    );
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: privateDownloadHeaders({
      mimeType: report.mimeType,
      fileName: report.originalFileName,
      byteSize: buffer.byteLength,
    }),
  });
}

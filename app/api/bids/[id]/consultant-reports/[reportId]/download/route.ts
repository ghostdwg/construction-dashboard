// Module OPS3 (Phase 1A) — attachment download for one consultant report.
//
// GET …/consultant-reports/[reportId]/download   → the PDF, Content-Disposition: attachment
//     ?revisionId=<n>                            → a specific revision (must belong
//                                                  to this report AND this bid)
//
// The always-available fallback for the inline viewer — unchanged existing
// private-download behavior. Security order: session wall (proxy.ts) →
// bid-scoped resource fetch → blob read LAST, by the SERVER-STORED
// storageKey only. Client supplies ids only.

import { getBlobStore } from "@/lib/storage/blobStore";
import { requireBidAccess } from "@/lib/auth-helpers";
import { privateDownloadHeaders } from "@/lib/services/storage/downloadHeaders";
import { resolveServableRevision } from "@/lib/services/consultantReports";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; reportId: string }> }
) {
  const { id, reportId } = await params;
  const bidId = parseInt(id, 10);
  const rid = parseInt(reportId, 10);
  if (isNaN(bidId) || isNaN(rid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  const revisionIdRaw = new URL(request.url).searchParams.get("revisionId");
  let revisionId: number | null = null;
  if (revisionIdRaw != null) {
    revisionId = parseInt(revisionIdRaw, 10);
    if (isNaN(revisionId))
      return Response.json({ error: "Invalid revisionId" }, { status: 400 });
  }

  const revision = await resolveServableRevision(bidId, rid, revisionId);
  if (!revision) return Response.json({ error: "Not found" }, { status: 404 });

  let buffer: Buffer;
  try {
    buffer = await getBlobStore().get(revision.storedKey);
  } catch (err) {
    console.error(
      "[consultant-reports] blob missing/unreadable for metadata row:",
      err instanceof Error ? err.message : err
    );
    return Response.json({ error: "File is missing from storage" }, { status: 404 });
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: privateDownloadHeaders({
      mimeType: revision.mimeType,
      fileName: revision.originalFilename,
      byteSize: buffer.byteLength,
    }),
  });
}

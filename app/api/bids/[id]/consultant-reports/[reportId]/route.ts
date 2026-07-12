// Module OPS3 (Phase 1A) — INLINE PDF serving for one consultant report.
//
// GET …/consultant-reports/[reportId]            → the PDF, Content-Disposition: inline
//     ?revisionId=<n>                            → a specific revision (must belong
//                                                  to this report AND this bid)
//
// The one genuinely new file-serving capability in Phase 1A — a sibling
// inline-disposition variant of the proven private-download pattern. Same
// security order (session wall → bid-scoped resource fetch → blob read
// LAST, by the SERVER-STORED key only), same allowlisted Content-Type,
// same nosniff, same private/no-store. The ONLY difference from the
// download route is the disposition header. A missing blob is an honest
// 404, never a fabricated body.

import { getBlobStore } from "@/lib/storage/blobStore";
import { privateInlineHeaders } from "@/lib/services/storage/downloadHeaders";
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
    headers: privateInlineHeaders({
      mimeType: revision.mimeType,
      fileName: revision.originalFilename,
      byteSize: buffer.byteLength,
    }),
  });
}

import { getBlobStore } from "@/lib/storage/blobStore";
import { privateDownloadHeaders } from "@/lib/services/storage/downloadHeaders";
import { findInternalResponseAttachment } from "@/lib/services/tradeResponse/attachments";
import { bidRouteContext, positiveId } from "@/lib/services/tradeResponse/routeHelpers";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; pkgId: string; itemId: string; revId: string; attachmentId: string }> }) {
  const { id, pkgId, itemId, revId, attachmentId } = await params;
  const pid = positiveId(pkgId); const iid = positiveId(itemId); const rid = positiveId(revId); const aid = positiveId(attachmentId);
  if (!pid || !iid || !rid || !aid) return Response.json({ error: "Invalid id" }, { status: 400 });
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  const attachment = await findInternalResponseAttachment(ctx.bidId, pid, iid, rid, aid);
  if (!attachment) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const buffer = await getBlobStore().get(attachment.storageKey);
    return new Response(new Uint8Array(buffer), { headers: privateDownloadHeaders({ mimeType: attachment.mimeType, fileName: attachment.fileName, byteSize: buffer.byteLength }) });
  } catch {
    return Response.json({ error: "File is missing from storage" }, { status: 404 });
  }
}

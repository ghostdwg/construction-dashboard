import { getBlobStore } from "@/lib/storage/blobStore";
import { privateDownloadHeaders } from "@/lib/services/storage/downloadHeaders";
import { findExternalResponseAttachment } from "@/lib/services/tradeResponse/attachments";
import { checkExternalRateLimit } from "@/lib/services/tradeResponse/rateLimit";
import { externalNotFound } from "@/lib/services/tradeResponse/externalHttp";
import { positiveId } from "@/lib/services/tradeResponse/routeHelpers";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string; attachmentId: string }> }) {
  const { token, attachmentId } = await params;
  const aid = positiveId(attachmentId);
  if (!aid) return externalNotFound();
  if (!(await checkExternalRateLimit(token))) return externalNotFound();
  const result = await findExternalResponseAttachment(token, aid);
  if (!result.ok) return externalNotFound();
  const beforeBlob = await findExternalResponseAttachment(token, aid);
  if (!beforeBlob.ok || beforeBlob.value.storageKey !== result.value.storageKey) return externalNotFound();
  try {
    const buffer = await getBlobStore().get(result.value.storageKey);
    const afterBlob = await findExternalResponseAttachment(token, aid);
    if (!afterBlob.ok || afterBlob.value.storageKey !== result.value.storageKey) return externalNotFound();
    return new Response(new Uint8Array(buffer), { headers: privateDownloadHeaders({ mimeType: result.value.mimeType, fileName: result.value.fileName, byteSize: buffer.byteLength }) });
  } catch {
    return externalNotFound();
  }
}

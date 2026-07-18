import { getBlobStore } from "@/lib/storage/blobStore";
import { privateDownloadHeaders } from "@/lib/services/storage/downloadHeaders";
import { findExternalResponseAttachment } from "@/lib/services/tradeResponse/attachments";
import { checkExternalRateLimit } from "@/lib/services/tradeResponse/rateLimit";
import { positiveId } from "@/lib/services/tradeResponse/routeHelpers";

export async function GET(request: Request, { params }: { params: Promise<{ token: string; attachmentId: string }> }) {
  const { token, attachmentId } = await params;
  const aid = positiveId(attachmentId);
  if (!aid) return Response.json({ error: "Not found" }, { status: 404 });
  const hint = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkExternalRateLimit(token, hint)) return Response.json({ error: "Not found" }, { status: 404 });
  const result = await findExternalResponseAttachment(token, aid);
  if (!result.ok) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const buffer = await getBlobStore().get(result.value.storageKey);
    return new Response(new Uint8Array(buffer), { headers: privateDownloadHeaders({ mimeType: result.value.mimeType, fileName: result.value.fileName, byteSize: buffer.byteLength }) });
  } catch {
    return Response.json({ error: "File is missing from storage" }, { status: 404 });
  }
}

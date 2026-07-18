import { getBlobStore } from "@/lib/storage/blobStore";
import { getInternalAttachmentTarget, recordInternalResponseAttachment } from "@/lib/services/tradeResponse/attachments";
import { responseAttachmentStorageKey, validateResponseAttachment } from "@/lib/services/tradeResponse/storage";
import { bidRouteContext, positiveId } from "@/lib/services/tradeResponse/routeHelpers";
import { statusForError } from "@/lib/services/tradeResponse/types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; pkgId: string; itemId: string; revId: string }> }) {
  const { id, pkgId, itemId, revId } = await params;
  const pid = positiveId(pkgId); const iid = positiveId(itemId); const rid = positiveId(revId);
  if (!pid || !iid || !rid) return Response.json({ error: "Invalid id" }, { status: 400 });
  const ctx = await bidRouteContext(id);
  if (!ctx.ok) return ctx.response;
  // Full parent chain is checked before multipart parsing or blob work.
  if (!(await getInternalAttachmentTarget(ctx.bidId, pid, iid, rid))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: "multipart/form-data body required" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof Blob) || !("name" in file)) return Response.json({ error: "file is required" }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateResponseAttachment({ fileName: String((file as File).name), mimeType: file.type, byteSize: buffer.byteLength });
  if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 });
  const storageKey = responseAttachmentStorageKey(ctx.bidId, pid, rid, validation.safeFileName);
  const store = getBlobStore();
  try { await store.put(storageKey, buffer, { contentType: file.type }); }
  catch { return Response.json({ error: "Storage write failed" }, { status: 500 }); }
  try {
    const result = await recordInternalResponseAttachment(ctx.bidId, pid, iid, rid, {
      storageKey, fileName: validation.safeFileName, mimeType: file.type, byteSize: buffer.byteLength,
    }, ctx.actor);
    if (!result.ok) {
      await store.delete(storageKey).catch(() => undefined);
      return Response.json({ error: result.error }, { status: statusForError(result.error) });
    }
    return Response.json({ ok: true, ...result.value }, { status: 201 });
  } catch {
    await store.delete(storageKey).catch(() => undefined);
    return Response.json({ error: "Attachment metadata failed; upload rolled back" }, { status: 500 });
  }
}

import { getBlobStore } from "@/lib/storage/blobStore";
import { preflightExternalAttachmentTarget, recordExternalResponseAttachment } from "@/lib/services/tradeResponse/attachments";
import { checkExternalRateLimit } from "@/lib/services/tradeResponse/rateLimit";
import { externalJson, externalNotFound } from "@/lib/services/tradeResponse/externalHttp";
import { positiveId } from "@/lib/services/tradeResponse/routeHelpers";
import { responseAttachmentStorageKey, validateResponseAttachment } from "@/lib/services/tradeResponse/storage";

export async function POST(request: Request, { params }: { params: Promise<{ token: string; itemId: string; revId: string }> }) {
  const { token, itemId, revId } = await params;
  const iid = positiveId(itemId); const rid = positiveId(revId);
  if (!iid || !rid) return externalNotFound();
  if (!(await checkExternalRateLimit(token))) return externalNotFound();
  // Token validity and complete package chain are proven before multipart parsing/blob work.
  const preflight = await preflightExternalAttachmentTarget(token, iid, rid);
  if (!preflight.ok) return externalNotFound();
  let form: FormData;
  try { form = await request.formData(); } catch { return externalJson({ error: "multipart/form-data body required" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof Blob) || !("name" in file)) return externalJson({ error: "file is required" }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateResponseAttachment({ fileName: String((file as File).name), mimeType: file.type, byteSize: buffer.byteLength });
  if (!validation.ok) return externalJson({ error: validation.error }, { status: 400 });
  // Recheck after potentially expensive multipart parsing and immediately
  // before the blob boundary. Revocation/VOID during parsing performs no write.
  if (!(await preflightExternalAttachmentTarget(token, iid, rid)).ok) return externalNotFound();
  const storageKey = responseAttachmentStorageKey(preflight.value.bidId, preflight.value.packageId, rid, validation.safeFileName);
  const store = getBlobStore();
  try { await store.put(storageKey, buffer, { contentType: file.type }); }
  catch { return externalJson({ error: "Storage write failed" }, { status: 500 }); }
  try {
    const result = await recordExternalResponseAttachment(token, iid, rid, {
      storageKey, fileName: validation.safeFileName, mimeType: file.type, byteSize: buffer.byteLength,
    });
    if (!result.ok) {
      await store.delete(storageKey).catch(() => undefined);
      return externalNotFound();
    }
    return externalJson({ ok: true, ...result.value }, { status: 201 });
  } catch {
    await store.delete(storageKey).catch(() => undefined);
    return externalJson({ error: "Attachment metadata failed; upload rolled back" }, { status: 500 });
  }
}

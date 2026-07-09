// Module OPS1 (Slice 1) — attachment upload + metadata list.
//
// GET  /api/bids/[id]/tracked-items/[itemId]/attachments
// POST /api/bids/[id]/tracked-items/[itemId]/attachments
//   multipart/form-data: file (required), caption? (text)
//
// Bytes go straight into the existing BlobStore under the canonical
// tracked-items key (plan-room/jobs/{bidId}/tracked-items/{itemId}/…) —
// MIME-allowlisted (jpeg/png/webp/pdf) and size-capped in
// lib/services/trackedItems/storagePath.ts. Attachments are private: no
// public serving path exists; V1 exposes metadata only (byte serving is a
// follow-up route with its own review). No EXIF/GPS processing, no
// thumbnails.

import { auth } from "@/lib/auth";
import { getBlobStore } from "@/lib/storage/blobStore";
import {
  listAttachments,
  recordAttachment,
} from "@/lib/services/trackedItems";
import {
  trackedItemStorageKey,
  validateTrackedItemUpload,
} from "@/lib/services/trackedItems/storagePath";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const bidId = parseInt(id, 10);
  const tid = parseInt(itemId, 10);
  if (isNaN(bidId) || isNaN(tid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const attachments = await listAttachments(bidId, tid);
  if (attachments === null) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({
    attachments: attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      byteSize: a.byteSize,
      kind: a.kind,
      caption: a.caption,
      createdBy: a.createdBy,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const bidId = parseInt(id, 10);
  const tid = parseInt(itemId, 10);
  if (isNaN(bidId) || isNaN(tid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "multipart/form-data body required" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob) || !("name" in file)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }
  const fileName = String((file as File).name || "upload.bin");
  const buffer = Buffer.from(await file.arrayBuffer());

  const validation = validateTrackedItemUpload({
    fileName,
    mimeType: file.type || "application/octet-stream",
    byteSize: buffer.byteLength,
  });
  if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 });

  const captionRaw = form.get("caption");
  const caption = typeof captionRaw === "string" ? captionRaw : null;

  const session = await auth().catch(() => null);
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;
  const actor = { name: user?.name ?? null, email: user?.email ?? null };

  const storageKey = trackedItemStorageKey(bidId, tid, validation.safeFileName);

  // Record metadata FIRST (it also enforces the bid-scoped tenancy check) so
  // a blob is never written for an item outside this bid; then write bytes.
  const result = await recordAttachment(bidId, tid, actor, {
    storageKey,
    fileName: validation.safeFileName,
    mimeType: file.type,
    byteSize: buffer.byteLength,
    kind: validation.kind,
    caption,
  });
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }

  await getBlobStore().put(storageKey, buffer, { contentType: file.type });

  return Response.json(
    { id: result.value.id, storageKeyRecorded: true },
    { status: 201 }
  );
}

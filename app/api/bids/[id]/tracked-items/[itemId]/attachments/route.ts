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
import { randomUUID } from "node:crypto";
import { requireBidAccess } from "@/lib/auth-helpers";
import { getBlobStore } from "@/lib/storage/blobStore";
import {
  listAttachments,
  recordAttachment,
  trackedItemExists,
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

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

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

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

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
  const actor = {
    id: access.user.id,
    name: user?.name ?? null,
    email: user?.email ?? null,
  };

  // Ordering contract (Codex review fix): (1) bid/item tenancy is enforced
  // BEFORE any byte is written, so a blob can never land for an item outside
  // this bid; (2) bytes are written; (3) ONLY after a successful blob write
  // is the metadata row created — a failed blob write therefore leaves NO
  // metadata row pointing at missing bytes; (4) if the metadata insert fails
  // after the blob landed, the blob is best-effort deleted so neither side
  // orphans the other.
  const exists = await trackedItemExists(bidId, tid);
  if (!exists) return Response.json({ error: "Not found" }, { status: 404 });

  const storageKey = trackedItemStorageKey(
    bidId,
    tid,
    randomUUID(),
    validation.safeFileName,
  );
  const store = getBlobStore();
  try {
    await store.put(storageKey, buffer, { contentType: file.type });
  } catch (err) {
    console.error("[tracked-items] attachment blob write failed:", err);
    return Response.json(
      { error: "Storage write failed — attachment not saved" },
      { status: 500 }
    );
  }

  let result: Awaited<ReturnType<typeof recordAttachment>>;
  try {
    result = await recordAttachment(bidId, tid, actor, {
      storageKey,
      fileName: validation.safeFileName,
      mimeType: file.type,
      byteSize: buffer.byteLength,
      kind: validation.kind,
      caption,
    });
  } catch (err) {
    await store.delete(storageKey).catch((cleanupErr) => {
      console.error(
        "[tracked-items] blob cleanup after metadata failure also failed — orphan blob at",
        storageKey,
        cleanupErr
      );
    });
    console.error("[tracked-items] attachment metadata insert failed (blob cleaned up):", err);
    return Response.json(
      { error: "Attachment could not be recorded — upload rolled back" },
      { status: 500 }
    );
  }
  if (!result.ok) {
    await store.delete(storageKey).catch(() => {});
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }

  return Response.json(
    { id: result.value.id, storageKeyRecorded: true },
    { status: 201 }
  );
}

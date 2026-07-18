// lib/services/trackedItems/storagePath.ts
//
// Module OPS1 (Slice 1) — attachment storage keys + upload validation for
// TrackedItem attachments (photos/documents).
//
// Tracked items are a NEW domain with no pre-BlobStore history, so — unlike
// specbook/drawings/estimates/addendums/meetings — there are no legacy path
// shapes to classify and no legacyPathCompat instantiation is needed. New
// writes follow the Ledger's canonical new-write namespace:
//
//   plan-room/jobs/{bidId}/tracked-items/{trackedItemId}/{immutableId}/{safeFileName}
//
// Bytes live in the existing BlobStore (getBlobStore()); this module never
// invents storage machinery — it only builds keys (via the shared
// safeBlobFileName helper) and validates uploads. Attachments are private:
// they are served/deleted only through the authenticated tracked-items
// routes, never any public path.
//
// V1 deliberately does NOT: process EXIF/GPS, generate thumbnails, or accept
// anything outside the allowlist below.

import { safeBlobFileName } from "@/lib/storage/blobStore";

// jpeg/png/webp photos + pdf documents only (V1 allowlist).
export const TRACKED_ITEM_ALLOWED_MIME: Record<string, "photo" | "document"> = {
  "image/jpeg": "photo",
  "image/png": "photo",
  "image/webp": "photo",
  "application/pdf": "document",
};

// No repo-wide upload cap convention exists (verified by search) — 25 MiB is
// this domain's documented cap: generous for site photos and scanned PDFs,
// small enough to keep the SQLite-metadata + blob layout responsive.
export const TRACKED_ITEM_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function trackedItemStorageKey(
  bidId: number,
  trackedItemId: number,
  immutableId: string,
  fileName: string
): string {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(immutableId)) {
    throw new Error("immutable attachment id is invalid");
  }
  const safe = safeBlobFileName(fileName);
  return `plan-room/jobs/${bidId}/tracked-items/${trackedItemId}/${immutableId}/${safe}`;
}

export type AttachmentValidation =
  | { ok: true; kind: "photo" | "document"; safeFileName: string }
  | { ok: false; error: string };

export function validateTrackedItemUpload(input: {
  fileName: string;
  mimeType: string;
  byteSize: number;
}): AttachmentValidation {
  const kind = TRACKED_ITEM_ALLOWED_MIME[input.mimeType];
  if (!kind) {
    return {
      ok: false,
      error: `Unsupported file type "${input.mimeType}" — allowed: jpeg, png, webp, pdf`,
    };
  }
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    return { ok: false, error: "Upload is empty" };
  }
  if (input.byteSize > TRACKED_ITEM_MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `File is too large (${input.byteSize} bytes; max ${TRACKED_ITEM_MAX_UPLOAD_BYTES})`,
    };
  }
  const safeFileName = safeBlobFileName(input.fileName);
  return { ok: true, kind, safeFileName };
}

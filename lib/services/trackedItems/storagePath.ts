// lib/services/trackedItems/storagePath.ts
//
// Module OPS1 (Slice 1) — attachment storage keys + upload validation for
// TrackedItem attachments (photos/documents).
//
// Tracked items are a NEW domain with no pre-BlobStore history, so — unlike
// specbook/drawings/estimates/addendums/meetings — there are no legacy path
// shapes to classify and no legacyPathCompat instantiation is needed. New
// writes follow the Ledger's canonical new-write namespace, with a
// server-generated per-upload token so distinct attachments NEVER collide:
//
//   plan-room/jobs/{bidId}/tracked-items/{trackedItemId}/{uploadToken}/{safeFileName}
//
// R2 remediation — attachment byte immutability: a tracked item can hold
// many attachments, each its own object. Keying only on the sanitized file
// name (the pre-remediation shape) meant two uploads of "photo.jpg" wrote the
// SAME blob key, so the second overwrote the first and downloading the older
// attachment id returned the newer bytes. The unique token makes every
// upload's key immutable and distinct while keeping the human-readable file
// name in the final path segment for the download Content-Disposition.
//
// Bytes live in the existing BlobStore (getBlobStore()); this module never
// invents storage machinery — it only builds keys (via the shared
// safeBlobFileName helper) and validates uploads. Attachments are private:
// they are served/deleted only through the authenticated tracked-items
// routes, never any public path.
//
// V1 deliberately does NOT: process EXIF/GPS, generate thumbnails, or accept
// anything outside the allowlist below.

import { randomUUID } from "node:crypto";
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

/** A unique, server-generated per-upload token. Callers MUST mint a fresh
 *  one for every attachment upload and NEVER derive it from client input, so
 *  two same-named files always land under different, immutable keys. */
export function newAttachmentToken(): string {
  return randomUUID();
}

export function trackedItemStorageKey(
  bidId: number,
  trackedItemId: number,
  uploadToken: string,
  fileName: string
): string {
  const safe = safeBlobFileName(fileName);
  return `plan-room/jobs/${bidId}/tracked-items/${trackedItemId}/${uploadToken}/${safe}`;
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

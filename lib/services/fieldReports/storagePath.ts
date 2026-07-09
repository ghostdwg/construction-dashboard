// lib/services/fieldReports/storagePath.ts
//
// Module OPS2 (Slice 2) — storage keys + upload validation for Field Report
// source files. Same posture as the tracked-items attachment module (a NEW
// domain with no legacy path shapes, so no legacyPathCompat instantiation):
// keys only, via the shared safeBlobFileName helper; bytes live in the
// existing BlobStore; files are private (metadata-only surface in V0 — no
// byte-serving route, no OCR, no AI extraction, no EXIF/GPS, no thumbnails).

import { safeBlobFileName } from "@/lib/storage/blobStore";

// pdf documents + jpeg/png/webp photos (V0 allowlist).
export const FIELD_REPORT_ALLOWED_MIME: Record<string, "photo" | "document"> = {
  "image/jpeg": "photo",
  "image/png": "photo",
  "image/webp": "photo",
  "application/pdf": "document",
};

// Same documented domain cap as tracked-item attachments (no repo-wide
// convention exists; 25 MiB covers scanned dailies and site photos).
export const FIELD_REPORT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function fieldReportStorageKey(
  bidId: number,
  fieldReportId: number,
  fileName: string
): string {
  const safe = safeBlobFileName(fileName);
  return `plan-room/jobs/${bidId}/field-reports/${fieldReportId}/${safe}`;
}

export type FieldReportUploadValidation =
  | { ok: true; kind: "photo" | "document"; safeFileName: string }
  | { ok: false; error: string };

export function validateFieldReportUpload(input: {
  fileName: string;
  mimeType: string;
  byteSize: number;
}): FieldReportUploadValidation {
  const kind = FIELD_REPORT_ALLOWED_MIME[input.mimeType];
  if (!kind) {
    return {
      ok: false,
      error: `Unsupported file type "${input.mimeType}" — allowed: pdf, jpeg, png, webp`,
    };
  }
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    return { ok: false, error: "Upload is empty" };
  }
  if (input.byteSize > FIELD_REPORT_MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `File is too large (${input.byteSize} bytes; max ${FIELD_REPORT_MAX_UPLOAD_BYTES})`,
    };
  }
  return { ok: true, kind, safeFileName: safeBlobFileName(input.fileName) };
}

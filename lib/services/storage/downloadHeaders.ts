// lib/services/storage/downloadHeaders.ts
//
// OPS private file serving V0 — shared response-header policy for the
// authenticated download routes (tracked-item attachments, field-report
// source files). Pure functions only: no blob access, no schema, no network.
//
// Policy:
//   - Content-Type passes through ONLY for the MIME types our upload
//     allowlists ever accepted (jpeg/png/webp/pdf); anything else — or a
//     missing stored type — serves as application/octet-stream so a
//     mislabeled blob can never be sniffed into an active content type.
//   - Content-Disposition is always `attachment` (V0 is download/open —
//     never inline embedding) with a sanitized ASCII filename.
//   - X-Content-Type-Options: nosniff, always.
//   - Cache-Control: private, no-store — these are authenticated,
//     per-session responses; nothing may cache them.

const SERVABLE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export function servableContentType(storedMime: string | null | undefined): string {
  if (storedMime && SERVABLE_MIME.has(storedMime)) return storedMime;
  return "application/octet-stream";
}

export function sanitizedDispositionFileName(fileName: string | null | undefined): string {
  const base = (fileName ?? "download.bin").split("/").pop()!.trim();
  // ASCII-safe, no quotes/control chars/backslashes; never empty.
  const cleaned = base.replace(/[^A-Za-z0-9._() -]/g, "_").slice(0, 180);
  return cleaned && cleaned.replace(/\./g, "") !== "" ? cleaned : "download.bin";
}

export function privateDownloadHeaders(input: {
  mimeType: string | null | undefined;
  fileName: string | null | undefined;
  byteSize?: number | null;
}): Headers {
  const headers = new Headers();
  headers.set("Content-Type", servableContentType(input.mimeType));
  headers.set(
    "Content-Disposition",
    `attachment; filename="${sanitizedDispositionFileName(input.fileName)}"`
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "private, no-store");
  if (input.byteSize != null && Number.isFinite(input.byteSize) && input.byteSize > 0) {
    headers.set("Content-Length", String(input.byteSize));
  }
  return headers;
}

/** Phase 1A sibling variant — identical policy in every respect except
 *  Content-Disposition: inline, so the browser's NATIVE viewer renders the
 *  document in a same-origin frame (consultant-report PDFs). Not a new
 *  capability class: same allowlisted Content-Type, same nosniff, same
 *  private/no-store; PDFs rendered natively by the browser do not execute
 *  script. Callers still authenticate + tenancy-check before any blob read. */
export function privateInlineHeaders(input: {
  mimeType: string | null | undefined;
  fileName: string | null | undefined;
  byteSize?: number | null;
}): Headers {
  const headers = privateDownloadHeaders(input);
  headers.set(
    "Content-Disposition",
    `inline; filename="${sanitizedDispositionFileName(input.fileName)}"`
  );
  return headers;
}

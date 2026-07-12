// lib/services/consultantReports/storagePath.ts
//
// Module OPS3 (Phase 1A) — storage keys for consultant-report PDFs.
// Content-addressed: the key is derived from the sha-256 of the exact
// bytes, so the same file can never be stored twice under two names and a
// client can never influence where a blob lands. Keys only — bytes live in
// the existing BlobStore; serving happens exclusively through the
// authenticated, bid-scoped inline/download routes.

export function consultantReportStorageKey(bidId: number, checksum: string): string {
  return `plan-room/jobs/${bidId}/consultant-reports/${checksum}.pdf`;
}

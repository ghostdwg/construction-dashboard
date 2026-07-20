// Addendums storage-path compatibility — domain instantiation of the shared
// factory in lib/services/storage/legacyPathCompat.ts. See that module's
// header for the full four-shape breakdown.
//
// New writes use
// `plan-room/jobs/{bidId}/addenda/{immutableId}/{safeBlobFileName(...)}`.
// Relative `uploads/addendums/{bidId}/...`, storage-root absolute paths, and
// scoped cwd paths remain readable for existing/backfilled rows.
//
// Unlike Spec Books/Drawings/Estimates, Addendums never had a filePath/
// storageKey column before this change at all — every existing row's
// storageKey is null, so "legacy-cwd"/"legacy-storage-root" classification
// only ever matters for a value this same migration's new writes produce
// going forward (there is no historic on-disk row shape to recognize). The
// classifier is still instantiated with both shapes for parity with the
// other domains and in case an operator ever hand-backfills a historic key.

import { createLegacyPathCompat } from "@/lib/services/storage/legacyPathCompat";

export type { ClassifyResult, ResolvedLocalPath, StoragePathKind } from "@/lib/services/storage/legacyPathCompat";

const ADDENDUMS_SEGMENTS = ["uploads", "addendums"];

const compat = createLegacyPathCompat({
  legacyCwdSegments: ADDENDUMS_SEGMENTS,
  legacyStorageRootSegments: ADDENDUMS_SEGMENTS,
  allowedKeyPrefixes: ([bidId]) => [
    ["plan-room", "jobs", bidId, "addenda"],
    ["uploads", "addendums", bidId],
  ],
});

export function classifyAddendumStoragePath(ref: string, bidId: number) {
  return compat.classify(ref, [bidId]);
}

export function resolveAddendumLocalPath(ref: string, bidId: number) {
  return compat.resolveLocalPath(ref, [bidId]);
}

export function addendumStoragePathExists(ref: string, bidId: number) {
  return compat.storagePathExists(ref, [bidId]);
}

export function readAddendumStorageBuffer(ref: string, bidId: number) {
  return compat.readBuffer(ref, [bidId]);
}

export function deleteAddendumStoragePath(ref: string, bidId: number) {
  return compat.deletePath(ref, [bidId]);
}

/** Canonical collision-safe BlobStore key for a new addendum upload. */
export function addendumStorageKey(bidId: number, immutableId: string, safeFileName: string): string {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(immutableId)) {
    throw new Error("immutable addendum file id is invalid");
  }
  return `plan-room/jobs/${bidId}/addenda/${immutableId}/${safeFileName}`;
}

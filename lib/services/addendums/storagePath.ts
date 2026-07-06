// Addendums storage-path compatibility — domain instantiation of the shared
// factory in lib/services/storage/legacyPathCompat.ts. See that module's
// header for the full four-shape breakdown.
//
// `AddendumUpload.storageKey` (new nullable column, added by this work) is
// scoped by a single bidId segment — the production shape is
// `uploads/addendums/{bidId}/{safeBlobFileName(...)}`. The legacy
// pre-BlobStore root is `process.cwd()/uploads/addendums`.
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

/** Canonical BlobStore key for a new addendum upload — matches production's namespace. */
export function addendumStorageKey(bidId: number, safeFileName: string): string {
  return `uploads/addendums/${bidId}/${safeFileName}`;
}

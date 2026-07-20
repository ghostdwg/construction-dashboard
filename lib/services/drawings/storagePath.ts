// Drawings storage-path compatibility — domain instantiation of the shared
// factory in lib/services/storage/legacyPathCompat.ts. See that module's
// header for the full four-shape breakdown (canonical / legacy-cwd /
// legacy-storage-root / invalid) and why this is a fresh instantiation
// rather than a shared classifier with Spec Books or the other domains.
//
// New writes use
// `plan-room/jobs/{bidId}/drawings/{immutableId}/{safeBlobFileName(...)}`.
// Relative `uploads/drawings/{bidId}/...`, storage-root absolute paths, and
// the scoped pre-BlobStore `process.cwd()/uploads/drawings/{bidId}/...`
// remain readable for existing rows only.
//
// Every exported function below takes `bidId: number` (not the generic
// `scope` array the underlying factory uses) — this domain only ever needs
// one scope segment, so the array is hidden from callers here exactly as
// lib/services/specbook/storagePath.ts hides its own bid-scoping.

import { createLegacyPathCompat } from "@/lib/services/storage/legacyPathCompat";

export type { ClassifyResult, ResolvedLocalPath, StoragePathKind } from "@/lib/services/storage/legacyPathCompat";

const DRAWINGS_SEGMENTS = ["uploads", "drawings"];

const compat = createLegacyPathCompat({
  legacyCwdSegments: DRAWINGS_SEGMENTS,
  legacyStorageRootSegments: DRAWINGS_SEGMENTS,
  allowedKeyPrefixes: ([bidId]) => [
    ["plan-room", "jobs", bidId, "drawings"],
    ["uploads", "drawings", bidId],
  ],
});

export function classifyDrawingStoragePath(ref: string, bidId: number) {
  return compat.classify(ref, [bidId]);
}

export function resolveDrawingLocalPath(ref: string, bidId: number) {
  return compat.resolveLocalPath(ref, [bidId]);
}

export function drawingStoragePathExists(ref: string, bidId: number) {
  return compat.storagePathExists(ref, [bidId]);
}

export function readDrawingStorageBuffer(ref: string, bidId: number) {
  return compat.readBuffer(ref, [bidId]);
}

export function deleteDrawingStoragePath(ref: string, bidId: number) {
  return compat.deletePath(ref, [bidId]);
}

/** Canonical collision-safe BlobStore key for a new drawing upload. */
export function drawingStorageKey(bidId: number, immutableId: string, safeFileName: string): string {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(immutableId)) {
    throw new Error("immutable drawing file id is invalid");
  }
  return `plan-room/jobs/${bidId}/drawings/${immutableId}/${safeFileName}`;
}

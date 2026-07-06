// Estimates storage-path compatibility — domain instantiation of the shared
// factory in lib/services/storage/legacyPathCompat.ts. See that module's
// header for the full four-shape breakdown.
//
// `EstimateUpload.rawFilePath` is scoped by TWO segments —
// `{bidId}/{subcontractorId}` — unlike every other domain's single bidId.
// The production shape is
// `uploads/estimates/{bidId}/{subcontractorId}/{safeBlobFileName(...)}`.
// The legacy pre-BlobStore root is `process.cwd()/uploads/estimates`.
//
// Every exported function below takes `(bidId, subcontractorId)` — the
// two-segment scope array the underlying factory expects is built here so
// callers never see it directly.

import { createLegacyPathCompat } from "@/lib/services/storage/legacyPathCompat";

export type { ClassifyResult, ResolvedLocalPath, StoragePathKind } from "@/lib/services/storage/legacyPathCompat";

const ESTIMATES_SEGMENTS = ["uploads", "estimates"];

const compat = createLegacyPathCompat({
  legacyCwdSegments: ESTIMATES_SEGMENTS,
  legacyStorageRootSegments: ESTIMATES_SEGMENTS,
});

export function classifyEstimateStoragePath(ref: string, bidId: number, subcontractorId: number) {
  return compat.classify(ref, [bidId, subcontractorId]);
}

export function resolveEstimateLocalPath(ref: string, bidId: number, subcontractorId: number) {
  return compat.resolveLocalPath(ref, [bidId, subcontractorId]);
}

export function estimateStoragePathExists(ref: string, bidId: number, subcontractorId: number) {
  return compat.storagePathExists(ref, [bidId, subcontractorId]);
}

export function readEstimateStorageBuffer(ref: string, bidId: number, subcontractorId: number) {
  return compat.readBuffer(ref, [bidId, subcontractorId]);
}

export function deleteEstimateStoragePath(ref: string, bidId: number, subcontractorId: number) {
  return compat.deletePath(ref, [bidId, subcontractorId]);
}

/** Canonical BlobStore key for a new estimate upload — matches production's namespace. */
export function estimateStorageKey(bidId: number, subcontractorId: number, safeFileName: string): string {
  return `uploads/estimates/${bidId}/${subcontractorId}/${safeFileName}`;
}

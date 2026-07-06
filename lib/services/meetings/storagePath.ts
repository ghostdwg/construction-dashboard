// Meetings storage-path compatibility — domain instantiation of the shared
// factory in lib/services/storage/legacyPathCompat.ts. See that module's
// header for the full four-shape breakdown.
//
// `Meeting.audioStorageKey` (new nullable column, added by this work) is
// scoped by the MEETING id, not the bid id — both today's naming-convention
// reconstruction (`process.cwd()/uploads/meetings/{meetingId}/{audioFileName}`)
// and production's equivalent key the on-disk/BlobStore layout is per
// meeting, since a meeting already belongs to exactly one bid (`Meeting.bidId`)
// and every route validates `{ id: meetingId, bidId }` before ever touching
// storage — using the meeting id as the compat layer's scope segment matches
// the existing physical layout exactly and needs no schema change to derive.
//
// Production shape: `uploads/meetings/{meetingId}/{safeBlobFileName(...)}`.
// Legacy pre-BlobStore root: `process.cwd()/uploads/meetings`.

import { createLegacyPathCompat } from "@/lib/services/storage/legacyPathCompat";

export type { ClassifyResult, ResolvedLocalPath, StoragePathKind } from "@/lib/services/storage/legacyPathCompat";

const MEETINGS_SEGMENTS = ["uploads", "meetings"];

const compat = createLegacyPathCompat({
  legacyCwdSegments: MEETINGS_SEGMENTS,
  legacyStorageRootSegments: MEETINGS_SEGMENTS,
});

export function classifyMeetingStoragePath(ref: string, meetingId: number) {
  return compat.classify(ref, [meetingId]);
}

export function resolveMeetingLocalPath(ref: string, meetingId: number) {
  return compat.resolveLocalPath(ref, [meetingId]);
}

export function meetingStoragePathExists(ref: string, meetingId: number) {
  return compat.storagePathExists(ref, [meetingId]);
}

export function readMeetingStorageBuffer(ref: string, meetingId: number) {
  return compat.readBuffer(ref, [meetingId]);
}

export function deleteMeetingStoragePath(ref: string, meetingId: number) {
  return compat.deletePath(ref, [meetingId]);
}

/** Canonical BlobStore key for a new hybrid meeting audio upload — matches production's namespace. */
export function meetingAudioStorageKey(meetingId: number, safeFileName: string): string {
  return `uploads/meetings/${meetingId}/${safeFileName}`;
}

// Meetings storage-path compatibility — domain instantiation of the shared
// factory in lib/services/storage/legacyPathCompat.ts. See that module's
// header for the full four-shape breakdown.
//
// New writes use `plan-room/jobs/{bidId}/meetings/{meetingId}/{immutableId}/`
// and therefore bind both ownership scopes into the key. Existing relative
// `uploads/meetings/{meetingId}/...`, storage-root absolute references, and
// scoped cwd paths remain readable without bulk migration.

import { createLegacyPathCompat } from "@/lib/services/storage/legacyPathCompat";
import path from "node:path";

export type { ClassifyResult, ResolvedLocalPath, StoragePathKind } from "@/lib/services/storage/legacyPathCompat";

const MEETINGS_SEGMENTS = ["uploads", "meetings"];

const compat = createLegacyPathCompat({
  legacyCwdSegments: MEETINGS_SEGMENTS,
  legacyStorageRootSegments: MEETINGS_SEGMENTS,
  allowedKeyPrefixes: ([bidId, meetingId]) => [
    ["plan-room", "jobs", bidId, "meetings", meetingId],
    ["uploads", "meetings", meetingId],
  ],
  legacyCwdScope: ([, meetingId]) => [meetingId],
});

export function classifyMeetingStoragePath(ref: string, bidId: number, meetingId: number) {
  return compat.classify(ref, [bidId, meetingId]);
}

export function resolveMeetingLocalPath(ref: string, bidId: number, meetingId: number) {
  return compat.resolveLocalPath(ref, [bidId, meetingId]);
}

export function meetingStoragePathExists(ref: string, bidId: number, meetingId: number) {
  return compat.storagePathExists(ref, [bidId, meetingId]);
}

export function readMeetingStorageBuffer(ref: string, bidId: number, meetingId: number) {
  return compat.readBuffer(ref, [bidId, meetingId]);
}

export function deleteMeetingStoragePath(ref: string, bidId: number, meetingId: number) {
  return compat.deletePath(ref, [bidId, meetingId]);
}

/** Canonical BlobStore key for a new hybrid meeting audio upload — matches production's namespace. */
export function meetingAudioStorageKey(
  bidId: number,
  meetingId: number,
  immutableId: string,
  safeFileName: string,
): string {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(immutableId)) {
    throw new Error("immutable meeting-media id is invalid");
  }
  return `plan-room/jobs/${bidId}/meetings/${meetingId}/${immutableId}/${safeFileName}`;
}

export const MEETING_MEDIA_MAX_BYTES = 500 * 1024 * 1024;
export const MEETING_VTT_MAX_BYTES = 10 * 1024 * 1024;

const MEETING_MEDIA_EXTENSIONS = new Set([
  ".aac", ".flac", ".m4a", ".mp3", ".mp4", ".ogg", ".wav", ".webm",
]);

export function validateMeetingMediaUpload(input: {
  fileName: string;
  mimeType: string;
  byteSize: number;
}): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    return { ok: false, error: "Meeting media upload is empty" };
  }
  if (input.byteSize > MEETING_MEDIA_MAX_BYTES) {
    return { ok: false, error: `Meeting media exceeds ${MEETING_MEDIA_MAX_BYTES} bytes` };
  }
  const ext = path.extname(input.fileName).toLowerCase();
  const allowedMime =
    input.mimeType.startsWith("audio/") ||
    input.mimeType === "video/mp4" ||
    input.mimeType === "video/webm" ||
    input.mimeType === "application/octet-stream" ||
    input.mimeType === "";
  if (!allowedMime || !MEETING_MEDIA_EXTENSIONS.has(ext)) {
    return { ok: false, error: "Unsupported meeting media type" };
  }
  return { ok: true };
}

export function meetingMediaContentType(
  fileName: string,
  storedType?: string | null,
): string {
  if (
    storedType?.startsWith("audio/") ||
    storedType === "video/mp4" ||
    storedType === "video/webm"
  ) {
    return storedType;
  }
  const ext = path.extname(fileName).toLowerCase();
  return ({
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
  } as Record<string, string>)[ext] ?? "application/octet-stream";
}

export const MEETING_UPLOAD_STALE_AFTER_MS = 5 * 60 * 1000;

type UploadLifecycleState = {
  status: string;
  updatedAt?: string | null;
};

export function isMeetingUploadStale(
  meeting: UploadLifecycleState,
  nowMs = Date.now(),
): boolean {
  if (meeting.status !== "UPLOADING" || !meeting.updatedAt) return false;

  const uploadStateUpdatedAtMs = Date.parse(meeting.updatedAt);
  if (!Number.isFinite(uploadStateUpdatedAtMs)) return false;

  return nowMs - uploadStateUpdatedAtMs > MEETING_UPLOAD_STALE_AFTER_MS;
}

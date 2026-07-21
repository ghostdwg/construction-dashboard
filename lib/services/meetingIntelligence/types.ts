export const MEETING_INTELLIGENCE_STATES = [
  "NOT_STARTED",
  "QUEUED",
  "PROCESSING",
  "READY_FOR_REVIEW",
  "PUBLISHED",
  "FAILED",
  "CANCELED",
] as const;

export type MeetingIntelligenceState =
  (typeof MEETING_INTELLIGENCE_STATES)[number];

export const MEETING_INTELLIGENCE_CANDIDATE_TYPES = [
  "ACTION_ITEM",
  "DECISION",
  "ISSUE",
  "RFI_OR_CLARIFICATION",
  "OWNER_COMMITMENT",
  "CONTRACTOR_COMMITMENT",
  "DUE_DATE",
  "RISK",
  "CLOSEOUT_ITEM",
  "WARRANTY_ITEM",
  "SPEC_REFERENCE",
] as const;

export type MeetingIntelligenceCandidateType =
  (typeof MEETING_INTELLIGENCE_CANDIDATE_TYPES)[number];

export const MEETING_INTELLIGENCE_REVIEW_STATES = [
  "DRAFT",
  "ACCEPTED",
  "REJECTED",
  "EDITED",
  "PUBLISHED",
] as const;

export type MeetingIntelligenceReviewState =
  (typeof MEETING_INTELLIGENCE_REVIEW_STATES)[number];

export const UNKNOWN_SPEAKER = "UNKNOWN_SPEAKER" as const;
export const LOCAL_PROCESSOR_KIND = "DETERMINISTIC_LOCAL_DEV" as const;
export const LOCAL_PROCESSOR_VERSION = "meeting-intelligence-fixture-v1" as const;
export const LOCAL_WORKER_PROCESSOR_KIND = "PRIVATE_LOCAL_WORKER" as const;
export const HEURISTIC_EXTRACTOR_VERSION = "meeting-structure-heuristics-v1" as const;
export const LOCAL_ONLY_CONFIDENTIALITY = "LOCAL_ONLY" as const;

export const MEETING_INTELLIGENCE_WORKER_JOB_STATUSES = [
  "QUEUED",
  "CLAIMED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "STALE",
] as const;

export const MEETING_INTELLIGENCE_PROGRESS_STAGES = [
  "media_fetch",
  "normalize",
  "transcribe",
  "diarize",
  "persist",
] as const;

export type MeetingIntelligenceProgressStage =
  (typeof MEETING_INTELLIGENCE_PROGRESS_STAGES)[number];

export type MeetingIntelligenceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function isCandidateType(
  value: string,
): value is MeetingIntelligenceCandidateType {
  return (MEETING_INTELLIGENCE_CANDIDATE_TYPES as readonly string[]).includes(
    value,
  );
}

export function normalizeSpeakerLabel(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase().replaceAll(" ", "_") ?? "";
  if (/^SPEAKER_\d+$/.test(normalized)) return normalized;
  if (normalized === "UNKNOWN" || normalized === UNKNOWN_SPEAKER) {
    return UNKNOWN_SPEAKER;
  }
  return UNKNOWN_SPEAKER;
}

export function isCorrectableSpeakerLabel(value: string): boolean {
  return normalizeSpeakerLabel(value) === value.trim().toUpperCase().replaceAll(" ", "_");
}

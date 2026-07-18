// lib/services/meetingRegister/types.ts
//
// Module R2-B1 — shared vocabularies for the Meeting Register Foundation.
// All vocabularies are app-validated strings (repo convention — never
// Prisma enums). Contract: docs/architecture/R2_MEETING_RESPONSE_CONTROL_LOOP.md.

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface Actor {
  id?: string | null;
  name?: string | null;
  email?: string | null;
}

export function actorLabel(actor: Actor | null | undefined): string | null {
  const label = actor?.email?.trim() || actor?.name?.trim() || actor?.id?.trim();
  return label || null;
}

export const REGISTER_ENTRY_TYPES = [
  "DISCUSSION",
  "DECISION",
  "QUESTION",
  "ACTION_ITEM",
  "COMMITMENT",
  "DESIGN_CHANGE",
  "RISK",
  "CONSTRAINT",
  "SCHEDULE_ITEM",
  "PROCUREMENT_ITEM",
  "INFORMATIONAL",
] as const;
export type RegisterEntryType = (typeof REGISTER_ENTRY_TYPES)[number];

export const REGISTER_DISPOSITIONS = [
  "CONFIRMED",
  "CORRECTED",
  "MERGED",
  "DUPLICATE",
  "DISMISSED_WITH_REASON",
  "DISCUSSION_ONLY",
  "INFORMATIONAL",
  "PROMOTED_TO_OPERATIONS",
] as const;
export type RegisterDisposition = (typeof REGISTER_DISPOSITIONS)[number];

/**
 * Machine lifecycle outcome of an extraction rerun — NEVER a human
 * disposition (it is deliberately absent from REGISTER_DISPOSITIONS so no
 * disposition route can set it). A superseded entry is permanent history:
 * retained forever, excluded from active views and the fully-reviewed gate,
 * with supersededByRunId/supersededByEntryId recording the replacement.
 */
export const SUPERSEDED_STATE = "SUPERSEDED" as const;

export type RegisterReviewState =
  | "PENDING"
  | RegisterDisposition
  | typeof SUPERSEDED_STATE;

export const ENTRY_ORIGINS = [
  "ai_extraction",
  "manual",
  "action_item_bridge",
  "commitment_bridge",
  "design_change_bridge",
] as const;
export type EntryOrigin = (typeof ENTRY_ORIGINS)[number];

/** Machine origins — entries a human must disposition (R2 rule 11). */
export const EXTRACTED_ORIGINS: readonly EntryOrigin[] = [
  "ai_extraction",
  "action_item_bridge",
  "commitment_bridge",
  "design_change_bridge",
];

export const CORRECTION_TYPES = [
  "RENAME_SPEAKER",
  "REASSIGN_SEGMENT",
  "REASSIGN_ALL_MATCHING",
  "MERGE_SPEAKERS",
  "SPLIT_SEGMENT",
  "MARK_UNKNOWN",
  "EDIT_TEXT",
] as const;
export type CorrectionType = (typeof CORRECTION_TYPES)[number];

export const EXTRACTION_RUN_STATUSES = ["PREVIEWED", "APPLIED", "DISCARDED"] as const;
export type ExtractionRunStatus = (typeof EXTRACTION_RUN_STATUSES)[number];

export function isRegisterEntryType(v: string): v is RegisterEntryType {
  return (REGISTER_ENTRY_TYPES as readonly string[]).includes(v);
}
export function isRegisterDisposition(v: string): v is RegisterDisposition {
  return (REGISTER_DISPOSITIONS as readonly string[]).includes(v);
}
export function isCorrectionType(v: string): v is CorrectionType {
  return (CORRECTION_TYPES as readonly string[]).includes(v);
}

/** Bounded excerpt for audit rows — never store long bodies in history JSON. */
export function bound(v: string | null | undefined, max = 500): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

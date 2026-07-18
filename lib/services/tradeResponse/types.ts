export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type Actor = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
};

export const OBSERVATION_SOURCE_KINDS = [
  "field_report",
  "consultant_report",
  "direct_entry",
] as const;

export const OBSERVATION_DISPOSITIONS = [
  "ACCEPTED",
  "DISMISSED_WITH_REASON",
  "DUPLICATE",
  "INFORMATIONAL",
] as const;

export const PACKAGE_STATUSES = [
  "DRAFT",
  "ISSUED",
  "RESPONSES_IN",
  "GC_REVIEW",
  "READY_TO_TRANSMIT",
  "VOIDED",
] as const;

export const MANUAL_CHANNELS = ["EMAIL", "PROCORE", "OTHER"] as const;
export const RESPONSE_CHANNELS = ["PORTAL", ...MANUAL_CHANNELS] as const;
export const RESPONSE_TYPES = [
  "COMPLETED",
  "PROPOSED_DATE",
  "CLARIFICATION_REQUESTED",
  "DISPUTED",
  "NOT_APPLICABLE",
] as const;
export const GC_REVIEW_STATES = [
  "ACCEPTED_FOR_TRANSMITTAL",
  "RETURNED_FOR_REVISION",
] as const;
export const CONSULTANT_DISCIPLINES = ["architect", "engineer", "other"] as const;

export function includes<const T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.includes(value);
}

export function actorLabel(actor: Actor | null | undefined): string {
  return actor?.email?.trim() || actor?.name?.trim() || actor?.id?.trim() || "unknown";
}

export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

export function statusForError(error: string): number {
  if (error === "Not found") return 404;
  if (error === "Rate limit exceeded") return 429;
  if (error.includes("conflict") || error.includes("already")) return 409;
  return 400;
}

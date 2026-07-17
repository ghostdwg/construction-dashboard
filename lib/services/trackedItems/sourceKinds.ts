// lib/services/trackedItems/sourceKinds.ts
//
// R2 remediation — the SINGLE source of truth for TrackedItem.sourceKind.
//
// Canonical vocabulary (every writer imports these constants — never a
// string literal):
//   manual                 — human-entered register item
//   meeting_action_item    — promoted MeetingActionItem (bridge FK:
//                            sourceMeetingActionItemId)
//   meeting_design_change  — TrackedItem created by confirming a
//                            DesignIntentChange
//   meeting_register       — promoted MeetingRegisterEntry (bridge FK:
//                            sourceMeetingRegisterEntryId)
//   consultant_observation — accepted ConsultantObservation (bridge FK:
//                            sourceConsultantObservationId)
//   field_report           — human item citing a FieldReport (bridge FK:
//                            sourceFieldReportId)
//
// LEGACY values remain on existing rows and are readable forever — they are
// NEVER rewritten (no destructive backfill) and never written by new code:
//   meeting            — historic action-item promotions / design-change
//                        confirmations (disambiguate via the FK columns)
//   consultant_report  — historic observation acceptances
//   spec_section       — historic spec-derived items (no current writer)
//   jso_report         — reserved for a later slice
//
// UI labels and grouping live here too so display code cannot drift from
// the vocabulary.

export const TRACKED_ITEM_SOURCE_KIND = {
  MANUAL: "manual",
  MEETING_ACTION_ITEM: "meeting_action_item",
  MEETING_DESIGN_CHANGE: "meeting_design_change",
  MEETING_REGISTER: "meeting_register",
  CONSULTANT_OBSERVATION: "consultant_observation",
  FIELD_REPORT: "field_report",
} as const;

export type TrackedItemSourceKind =
  (typeof TRACKED_ITEM_SOURCE_KIND)[keyof typeof TRACKED_ITEM_SOURCE_KIND];

export const CANONICAL_SOURCE_KINDS: readonly string[] = Object.values(
  TRACKED_ITEM_SOURCE_KIND
);

/** Legacy values readable on existing rows; never written by new code. */
export const LEGACY_SOURCE_KINDS: readonly string[] = [
  "meeting",
  "consultant_report",
  "spec_section",
  "jso_report",
];

export function isCanonicalSourceKind(v: string): v is TrackedItemSourceKind {
  return CANONICAL_SOURCE_KINDS.includes(v);
}

export function isKnownSourceKind(v: string): boolean {
  return CANONICAL_SOURCE_KINDS.includes(v) || LEGACY_SOURCE_KINDS.includes(v);
}

/** Meeting-derived family — canonical AND legacy — for UI notes that apply
 *  to any meeting-sourced evidence (e.g. draft speaker attribution). */
export function isMeetingSourceKind(v: string): boolean {
  return (
    v === TRACKED_ITEM_SOURCE_KIND.MEETING_ACTION_ITEM ||
    v === TRACKED_ITEM_SOURCE_KIND.MEETING_DESIGN_CHANGE ||
    v === TRACKED_ITEM_SOURCE_KIND.MEETING_REGISTER ||
    v === "meeting"
  );
}

/** Human-readable label for any known value (legacy included). */
export const SOURCE_KIND_LABELS: Record<string, string> = {
  manual: "manual entry",
  meeting: "meeting",
  meeting_action_item: "meeting action item",
  meeting_design_change: "meeting design change",
  meeting_register: "meeting register",
  consultant_report: "consultant report",
  consultant_observation: "consultant observation",
  field_report: "field report",
  spec_section: "spec section",
  jso_report: "JSO report",
};

export function sourceKindLabel(v: string): string {
  return SOURCE_KIND_LABELS[v] ?? "manual entry";
}

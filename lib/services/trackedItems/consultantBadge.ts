// lib/services/trackedItems/consultantBadge.ts
//
// Module OPS4 (Phase 1B) — the derived consultant badge. COMPUTED AT READ
// TIME over facts, never a stored status field (a denormalized flag was
// evaluated and rejected: five write paths would have to keep it true).
// Precedence, highest wins:
//   disposed  — a supporting observation carries ≥1 disposition record
//   responded — the item has a formal response
//   linked    — ≥1 observation cites the item (supporting or spawned)
//   unlinked  — none of the above
// Pure function — the query layer supplies the three booleans.

export const CONSULTANT_BADGES = ["unlinked", "linked", "responded", "disposed"] as const;
export type ConsultantBadge = (typeof CONSULTANT_BADGES)[number];

export function deriveConsultantBadge(input: {
  hasLinkedObservation: boolean;
  hasFormalResponse: boolean;
  hasDispositionRecord: boolean;
}): ConsultantBadge {
  if (input.hasDispositionRecord) return "disposed";
  if (input.hasFormalResponse) return "responded";
  if (input.hasLinkedObservation) return "linked";
  return "unlinked";
}

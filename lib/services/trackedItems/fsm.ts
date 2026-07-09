// lib/services/trackedItems/fsm.ts
//
// Module OPS1 (Slice 1) — the single authority for TrackedItem status
// transitions. HUMAN-ONLY in V1: every transition is the direct result of an
// authenticated user action passing through the tracked-items routes. There
// is deliberately no auto-close, no auto-assign, no notification side effect,
// and no system-initiated transition of any kind in this module.
//
// Status flow:
//
//   OPEN ──▶ IN_PROGRESS ──▶ READY_TO_CLOSE ──▶ CLOSED
//     │            │                │
//     └────────────┴────────────────┴──────────▶ WAIVED (reason required)
//
//   plus honest corrections backwards along the non-terminal states
//   (IN_PROGRESS → OPEN, READY_TO_CLOSE → IN_PROGRESS/OPEN) — a super who
//   staged an item too early must be able to un-stage it without ceremony.
//   CLOSED and WAIVED are terminal in V1 (reopening is a later, audited
//   feature decision — not silently supported here).
//
// Rules enforced here (not in callers):
//   - CLOSED requires an actor (closedBy); an optional closeout comment is
//     the caller's concern (routes append it via the comment thread).
//   - WAIVED requires a non-empty reason.
//   - Unknown statuses and unknown transitions are rejected, never coerced.

export const TRACKED_ITEM_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "READY_TO_CLOSE",
  "CLOSED",
  "WAIVED",
] as const;
export type TrackedItemStatus = (typeof TRACKED_ITEM_STATUSES)[number];

export const TRACKED_ITEM_KINDS = [
  "OAC_ACTION",
  "FIELD_ITEM",
  "JSO_ITEM",
  "WARRANTY",
  "CLOSEOUT",
  "TRAINING",
  "OM",
  "TEST_INSPECTION",
  "ATTIC_STOCK",
] as const;
export type TrackedItemKind = (typeof TRACKED_ITEM_KINDS)[number];

export const TRACKED_ITEM_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type TrackedItemPriority = (typeof TRACKED_ITEM_PRIORITIES)[number];

const ALLOWED_TRANSITIONS: Record<TrackedItemStatus, TrackedItemStatus[]> = {
  OPEN: ["IN_PROGRESS", "READY_TO_CLOSE", "CLOSED", "WAIVED"],
  IN_PROGRESS: ["OPEN", "READY_TO_CLOSE", "CLOSED", "WAIVED"],
  READY_TO_CLOSE: ["OPEN", "IN_PROGRESS", "CLOSED", "WAIVED"],
  CLOSED: [], // terminal in V1
  WAIVED: [], // terminal in V1
};

export function isTrackedItemStatus(value: unknown): value is TrackedItemStatus {
  return (
    typeof value === "string" &&
    (TRACKED_ITEM_STATUSES as readonly string[]).includes(value)
  );
}

export function isTrackedItemKind(value: unknown): value is TrackedItemKind {
  return (
    typeof value === "string" && (TRACKED_ITEM_KINDS as readonly string[]).includes(value)
  );
}

export interface TransitionRequest {
  from: TrackedItemStatus;
  to: TrackedItemStatus;
  /** Human performing the transition — required for CLOSED. */
  actor?: string | null;
  /** Required, non-empty, for WAIVED. */
  waivedReason?: string | null;
}

export type TransitionResult =
  | {
      ok: true;
      /** Field updates the service should persist alongside `status`. */
      updates: {
        status: TrackedItemStatus;
        closedAt?: Date;
        closedBy?: string;
        waivedReason?: string;
      };
    }
  | { ok: false; error: string };

export function validateTransition(req: TransitionRequest): TransitionResult {
  if (!isTrackedItemStatus(req.from)) {
    return { ok: false, error: `Unknown current status: ${String(req.from)}` };
  }
  if (!isTrackedItemStatus(req.to)) {
    return { ok: false, error: `Unknown target status: ${String(req.to)}` };
  }
  if (req.from === req.to) {
    return { ok: false, error: `Item is already ${req.to}` };
  }
  if (!ALLOWED_TRANSITIONS[req.from].includes(req.to)) {
    return {
      ok: false,
      error: `Transition ${req.from} → ${req.to} is not allowed${
        ALLOWED_TRANSITIONS[req.from].length === 0 ? ` (${req.from} is terminal)` : ""
      }`,
    };
  }

  if (req.to === "CLOSED") {
    const actor = req.actor?.trim();
    if (!actor) {
      return { ok: false, error: "Closing requires an actor (closedBy)" };
    }
    return {
      ok: true,
      updates: { status: "CLOSED", closedAt: new Date(), closedBy: actor },
    };
  }

  if (req.to === "WAIVED") {
    const reason = req.waivedReason?.trim();
    if (!reason) {
      return { ok: false, error: "Waiving requires a non-empty reason" };
    }
    const actor = req.actor?.trim();
    return {
      ok: true,
      updates: {
        status: "WAIVED",
        closedAt: new Date(),
        ...(actor ? { closedBy: actor } : {}),
        waivedReason: reason,
      },
    };
  }

  return { ok: true, updates: { status: req.to } };
}

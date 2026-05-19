// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectAggregation/lifecycle.ts
//  Phase MI-6 — Project lifecycle state machine.
//
//  States flow forward through the construction-emergence funnel:
//    EMERGING → EARLY_SIGNAL → PRE_ENTITLEMENT → ENTITLEMENT → SITE_PREP
//      → PRE_CONSTRUCTION → ACTIVE_CONSTRUCTION → COMPLETED
//
//  At any point a project may slip sideways:
//    any-state → STALLED   (no signals for N months; deterministic)
//    any-state → ABANDONED (operator-marked)
//
//  STALLED can revive — operator override allowed back to any earlier state.
//
//  This module owns the transition table + validation. Actual state changes
//  go through aggregator.transitionState() which also records a
//  ProjectStateTransition row and a ProjectTimelineEvent.
// ──────────────────────────────────────────────────────────────────────────────

import type { LifecycleState } from "./types";

/** Forward-only allowed transitions (excluding STALLED/ABANDONED escape hatches). */
const FORWARD_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  EMERGING:            ["EARLY_SIGNAL"],
  EARLY_SIGNAL:        ["PRE_ENTITLEMENT"],
  PRE_ENTITLEMENT:     ["ENTITLEMENT"],
  ENTITLEMENT:         ["SITE_PREP"],
  SITE_PREP:           ["PRE_CONSTRUCTION"],
  PRE_CONSTRUCTION:    ["ACTIVE_CONSTRUCTION"],
  ACTIVE_CONSTRUCTION: ["COMPLETED"],
  STALLED:             [],
  ABANDONED:           [],
  COMPLETED:           [],
};

const SIDEWAYS_ALLOWED: ReadonlyArray<LifecycleState> = ["STALLED", "ABANDONED"];

const STALLED_REVIVAL_TARGETS: ReadonlyArray<LifecycleState> = [
  "EMERGING",
  "EARLY_SIGNAL",
  "PRE_ENTITLEMENT",
  "ENTITLEMENT",
  "SITE_PREP",
  "PRE_CONSTRUCTION",
  "ACTIVE_CONSTRUCTION",
];

const TERMINAL_STATES: ReadonlyArray<LifecycleState> = ["COMPLETED", "ABANDONED"];

export function isTerminal(state: LifecycleState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * Validate that a state transition is allowed.
 *
 * Rules (returning ok:false unless explicitly allowed):
 *   - Same-state transitions are refused (no-op should be caught earlier).
 *   - COMPLETED and ABANDONED are terminal — no further transitions except
 *     by operator override (overrides bypass this validator).
 *   - Forward-only along the funnel — skipping stages is refused so the
 *     timeline preserves the staging of emergence.
 *   - any-state → STALLED / ABANDONED always allowed.
 *   - STALLED → earlier productive state allowed (revival).
 */
export function canTransition(
  from: LifecycleState,
  to: LifecycleState
): { ok: boolean; reason: string } {
  if (from === to) return { ok: false, reason: "same state (no-op)" };

  if (SIDEWAYS_ALLOWED.includes(to)) return { ok: true, reason: "sideways exit allowed from any state" };

  if (from === "STALLED" && STALLED_REVIVAL_TARGETS.includes(to)) {
    return { ok: true, reason: "STALLED → revival to productive state" };
  }

  if (isTerminal(from)) {
    return { ok: false, reason: `${from} is terminal — operator override required to leave` };
  }

  const forward = FORWARD_TRANSITIONS[from];
  if (forward.includes(to)) return { ok: true, reason: `forward transition ${from} → ${to}` };

  return {
    ok: false,
    reason:
      `no path from ${from} to ${to} in the lifecycle. ` +
      "Use operator override or step through intermediate states.",
  };
}

/** Suggest the next state for a project given heuristics about its
 *  accumulated signals. Pure function — caller decides whether to apply.
 *
 *  Heuristic rules (deterministic-first; no ML):
 *    - 1 signal → EMERGING
 *    - 2-3 signals → EARLY_SIGNAL
 *    - rezoning/plat/SUP signal attached → PRE_ENTITLEMENT
 *    - approved entitlement signal → ENTITLEMENT
 *    - utility-extension / grading signal → SITE_PREP
 *    - issued building permit → PRE_CONSTRUCTION
 *    - first inspection / pour signal → ACTIVE_CONSTRUCTION
 *    - no signals for ≥ STALL_THRESHOLD_DAYS → STALLED
 */
export interface SuggestStateInput {
  currentState: LifecycleState;
  signalCount: number;
  lastSignalAt: Date | null;
  hasRezoningSignal: boolean;
  hasEntitlementApprovedSignal: boolean;
  hasUtilityOrGradingSignal: boolean;
  hasBuildingPermitSignal: boolean;
  hasActiveConstructionSignal: boolean;
  hasCompletionSignal: boolean;
  now: Date;
}

const STALL_THRESHOLD_DAYS = 180;

export function suggestNextState(input: SuggestStateInput): {
  suggested: LifecycleState;
  reason: string;
} {
  // Terminal states stay terminal until operator overrides.
  if (isTerminal(input.currentState)) {
    return { suggested: input.currentState, reason: "terminal state holds" };
  }

  // Stall detection — checked first because a stalled project may regress
  // even if other progress signals exist (they should be operator-reviewed).
  if (input.lastSignalAt) {
    const daysSince =
      (input.now.getTime() - input.lastSignalAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > STALL_THRESHOLD_DAYS) {
      return { suggested: "STALLED", reason: `no signals for ${daysSince.toFixed(0)} days` };
    }
  }

  // Forward progression — most specific first
  if (input.hasCompletionSignal) {
    return { suggested: "COMPLETED", reason: "completion signal observed" };
  }
  if (input.hasActiveConstructionSignal) {
    return { suggested: "ACTIVE_CONSTRUCTION", reason: "active-construction signal observed" };
  }
  if (input.hasBuildingPermitSignal) {
    return { suggested: "PRE_CONSTRUCTION", reason: "building-permit signal observed" };
  }
  if (input.hasUtilityOrGradingSignal) {
    return { suggested: "SITE_PREP", reason: "utility/grading signal observed" };
  }
  if (input.hasEntitlementApprovedSignal) {
    return { suggested: "ENTITLEMENT", reason: "entitlement-approval signal observed" };
  }
  if (input.hasRezoningSignal) {
    return { suggested: "PRE_ENTITLEMENT", reason: "rezoning / plat / SUP signal observed" };
  }

  if (input.signalCount >= 2) {
    return { suggested: "EARLY_SIGNAL", reason: `${input.signalCount} weak signals accumulated` };
  }
  if (input.signalCount >= 1) {
    return { suggested: "EMERGING", reason: "first signal" };
  }

  return { suggested: input.currentState, reason: "no signal-driven change" };
}

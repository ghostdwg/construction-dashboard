// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectAggregation/__tests__/lifecycle.test.ts
//  Phase MI-6 — Lifecycle state-machine + suggestNextState tests.
//  Pure functions, no Prisma.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import { canTransition, isTerminal, suggestNextState } from "../lifecycle";

describe("canTransition — forward funnel", () => {
  test("EMERGING → EARLY_SIGNAL allowed", () => {
    expect(canTransition("EMERGING", "EARLY_SIGNAL").ok).toBe(true);
  });
  test("EARLY_SIGNAL → PRE_ENTITLEMENT allowed", () => {
    expect(canTransition("EARLY_SIGNAL", "PRE_ENTITLEMENT").ok).toBe(true);
  });
  test("PRE_CONSTRUCTION → ACTIVE_CONSTRUCTION allowed", () => {
    expect(canTransition("PRE_CONSTRUCTION", "ACTIVE_CONSTRUCTION").ok).toBe(true);
  });
  test("ACTIVE_CONSTRUCTION → COMPLETED allowed", () => {
    expect(canTransition("ACTIVE_CONSTRUCTION", "COMPLETED").ok).toBe(true);
  });
});

describe("canTransition — skipping refused", () => {
  test("EMERGING → ENTITLEMENT refused (skips PRE_ENTITLEMENT)", () => {
    expect(canTransition("EMERGING", "ENTITLEMENT").ok).toBe(false);
  });
  test("PRE_ENTITLEMENT → ACTIVE_CONSTRUCTION refused", () => {
    expect(canTransition("PRE_ENTITLEMENT", "ACTIVE_CONSTRUCTION").ok).toBe(false);
  });
});

describe("canTransition — sideways exits", () => {
  test("EMERGING → STALLED allowed", () => {
    expect(canTransition("EMERGING", "STALLED").ok).toBe(true);
  });
  test("ACTIVE_CONSTRUCTION → STALLED allowed", () => {
    expect(canTransition("ACTIVE_CONSTRUCTION", "STALLED").ok).toBe(true);
  });
  test("EMERGING → ABANDONED allowed", () => {
    expect(canTransition("EMERGING", "ABANDONED").ok).toBe(true);
  });
});

describe("canTransition — STALLED revival", () => {
  test("STALLED → EARLY_SIGNAL allowed", () => {
    expect(canTransition("STALLED", "EARLY_SIGNAL").ok).toBe(true);
  });
  test("STALLED → ACTIVE_CONSTRUCTION allowed", () => {
    expect(canTransition("STALLED", "ACTIVE_CONSTRUCTION").ok).toBe(true);
  });
  test("STALLED → STALLED refused (same state)", () => {
    expect(canTransition("STALLED", "STALLED").ok).toBe(false);
  });
});

describe("canTransition — terminal states", () => {
  test("COMPLETED is terminal", () => expect(isTerminal("COMPLETED")).toBe(true));
  test("ABANDONED is terminal", () => expect(isTerminal("ABANDONED")).toBe(true));
  test("EMERGING is not terminal", () => expect(isTerminal("EMERGING")).toBe(false));
  test("COMPLETED → EMERGING refused without override", () => {
    expect(canTransition("COMPLETED", "EMERGING").ok).toBe(false);
  });
});

describe("suggestNextState — signal-driven heuristics", () => {
  const baseInput = {
    currentState: "EMERGING" as const,
    signalCount: 0,
    lastSignalAt: new Date("2026-05-19"),
    hasRezoningSignal: false,
    hasEntitlementApprovedSignal: false,
    hasUtilityOrGradingSignal: false,
    hasBuildingPermitSignal: false,
    hasActiveConstructionSignal: false,
    hasCompletionSignal: false,
    now: new Date("2026-05-19"),
  };

  test("1 signal → EMERGING", () => {
    const r = suggestNextState({ ...baseInput, signalCount: 1 });
    expect(r.suggested).toBe("EMERGING");
  });
  test("2 signals → EARLY_SIGNAL", () => {
    const r = suggestNextState({ ...baseInput, signalCount: 2 });
    expect(r.suggested).toBe("EARLY_SIGNAL");
  });
  test("rezoning signal → PRE_ENTITLEMENT", () => {
    const r = suggestNextState({ ...baseInput, hasRezoningSignal: true });
    expect(r.suggested).toBe("PRE_ENTITLEMENT");
  });
  test("entitlement-approved → ENTITLEMENT", () => {
    const r = suggestNextState({ ...baseInput, hasEntitlementApprovedSignal: true, hasRezoningSignal: true });
    expect(r.suggested).toBe("ENTITLEMENT");
  });
  test("utility/grading → SITE_PREP", () => {
    const r = suggestNextState({ ...baseInput, hasUtilityOrGradingSignal: true });
    expect(r.suggested).toBe("SITE_PREP");
  });
  test("building permit → PRE_CONSTRUCTION", () => {
    const r = suggestNextState({ ...baseInput, hasBuildingPermitSignal: true });
    expect(r.suggested).toBe("PRE_CONSTRUCTION");
  });
  test("active construction → ACTIVE_CONSTRUCTION", () => {
    const r = suggestNextState({ ...baseInput, hasActiveConstructionSignal: true });
    expect(r.suggested).toBe("ACTIVE_CONSTRUCTION");
  });
  test("completion → COMPLETED", () => {
    const r = suggestNextState({ ...baseInput, hasCompletionSignal: true });
    expect(r.suggested).toBe("COMPLETED");
  });
});

describe("suggestNextState — stall detection", () => {
  test("> 180 days since last signal → STALLED", () => {
    const r = suggestNextState({
      currentState: "EARLY_SIGNAL",
      signalCount: 3,
      lastSignalAt: new Date("2025-01-01"),
      hasRezoningSignal: false,
      hasEntitlementApprovedSignal: false,
      hasUtilityOrGradingSignal: false,
      hasBuildingPermitSignal: false,
      hasActiveConstructionSignal: false,
      hasCompletionSignal: false,
      now: new Date("2026-05-19"),
    });
    expect(r.suggested).toBe("STALLED");
  });
  test("< 180 days → not STALLED", () => {
    const r = suggestNextState({
      currentState: "EARLY_SIGNAL",
      signalCount: 3,
      lastSignalAt: new Date("2026-04-01"),
      hasRezoningSignal: false,
      hasEntitlementApprovedSignal: false,
      hasUtilityOrGradingSignal: false,
      hasBuildingPermitSignal: false,
      hasActiveConstructionSignal: false,
      hasCompletionSignal: false,
      now: new Date("2026-05-19"),
    });
    expect(r.suggested).not.toBe("STALLED");
  });
});

describe("suggestNextState — terminal states hold", () => {
  test("COMPLETED stays COMPLETED", () => {
    const r = suggestNextState({
      currentState: "COMPLETED",
      signalCount: 0,
      lastSignalAt: null,
      hasRezoningSignal: false,
      hasEntitlementApprovedSignal: false,
      hasUtilityOrGradingSignal: false,
      hasBuildingPermitSignal: false,
      hasActiveConstructionSignal: false,
      hasCompletionSignal: false,
      now: new Date(),
    });
    expect(r.suggested).toBe("COMPLETED");
  });
  test("ABANDONED stays ABANDONED", () => {
    const r = suggestNextState({
      currentState: "ABANDONED",
      signalCount: 5,
      lastSignalAt: new Date(),
      hasRezoningSignal: true,
      hasEntitlementApprovedSignal: false,
      hasUtilityOrGradingSignal: false,
      hasBuildingPermitSignal: false,
      hasActiveConstructionSignal: false,
      hasCompletionSignal: false,
      now: new Date(),
    });
    expect(r.suggested).toBe("ABANDONED");
  });
});

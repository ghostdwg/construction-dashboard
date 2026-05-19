// Phase MI-8 — Trajectory state-machine + acceleration tests.

import { describe, expect, test } from "vitest";
import {
  computeAcceleration,
  classifyTrajectory,
  detectEmergenceDecay,
  detectMomentumShift,
  type ScoreObservation,
} from "../trajectory";
import { TRAJECTORY_THRESHOLDS } from "../types";

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

describe("computeAcceleration", () => {
  test("empty history returns zeroes", () => {
    const r = computeAcceleration("PROJECT", "p1", [], 0);
    expect(r.accelerationIndex).toBe(0);
    expect(r.momentumScore).toBe(0);
    expect(r.decayScore).toBe(0);
  });

  test("monotonically increasing series has positive momentum", () => {
    const obs: ScoreObservation[] = [
      { score: 0.1, observedAt: daysAgo(90) },
      { score: 0.3, observedAt: daysAgo(60) },
      { score: 0.5, observedAt: daysAgo(30) },
      { score: 0.7, observedAt: daysAgo(0) },
    ];
    const r = computeAcceleration("PROJECT", "p1", obs, 0);
    expect(r.shortTermDelta).toBeGreaterThan(0);
    expect(r.momentumScore).toBeGreaterThan(0);
    expect(r.decayScore).toBeLessThanOrEqual(0.001);
  });

  test("monotonically decreasing series has positive decayScore", () => {
    const obs: ScoreObservation[] = [
      { score: 0.7, observedAt: daysAgo(90) },
      { score: 0.5, observedAt: daysAgo(60) },
      { score: 0.3, observedAt: daysAgo(30) },
      { score: 0.1, observedAt: daysAgo(0) },
    ];
    const r = computeAcceleration("PROJECT", "p1", obs, 0);
    expect(r.shortTermDelta).toBeLessThan(0);
    expect(r.decayScore).toBeGreaterThan(0);
    expect(r.momentumScore).toBeLessThanOrEqual(0.001);
  });

  test("reversal flags shiftDetected", () => {
    const obs: ScoreObservation[] = [
      { score: 0.1, observedAt: daysAgo(90) },
      { score: 0.3, observedAt: daysAgo(60) },
      { score: 0.6, observedAt: daysAgo(30) }, // prior trend: 0.3 → 0.6 = +0.3 (up)
      { score: 0.2, observedAt: daysAgo(0) },  // current:   0.6 → 0.2 = -0.4 (down)
    ];
    const r = computeAcceleration("PROJECT", "p1", obs, 0);
    expect(r.shiftDetected).toBe(true);
    expect(r.shiftReason).toBe("positive_to_negative_reversal");
  });

  test("dormant (very stale) overrides positive deltas", () => {
    const obs: ScoreObservation[] = [
      { score: 0.1, observedAt: daysAgo(90) },
      { score: 0.5, observedAt: daysAgo(60) },
      { score: 0.6, observedAt: daysAgo(30) },
      { score: 0.7, observedAt: daysAgo(0) },
    ];
    const r = computeAcceleration("PROJECT", "p1", obs, TRAJECTORY_THRESHOLDS.DORMANT_DAYS + 100);
    expect(r.momentumScore).toBe(0);
    expect(r.decayScore).toBeGreaterThanOrEqual(0.5);
  });
});

describe("classifyTrajectory", () => {
  function buildAccel(overrides: Partial<{
    shortTermDelta: number;
    longTermDelta: number;
    accelerationIndex: number;
    shiftDetected: boolean;
    shiftReason: string | null;
    momentumScore: number;
    decayScore: number;
  }> = {}) {
    return {
      subjectKind: "PROJECT" as const,
      subjectId: "p1",
      shortTermDelta: 0,
      longTermDelta: 0,
      accelerationIndex: 0,
      shiftDetected: false,
      shiftReason: null,
      momentumScore: 0,
      decayScore: 0,
      windowDays: 30,
      ...overrides,
    };
  }

  test("low score + flat → STALLED", () => {
    const d = classifyTrajectory({
      emergenceScore: 0.05,
      acceleration: buildAccel(),
      previousState: null,
      previousStreakLength: 0,
      daysSinceLastSignal: 30,
    });
    expect(d.state).toBe("STALLED");
  });

  test("low score + small positive delta → EMERGING", () => {
    const d = classifyTrajectory({
      emergenceScore: 0.10,
      acceleration: buildAccel({ shortTermDelta: 0.1 }),
      previousState: null,
      previousStreakLength: 0,
      daysSinceLastSignal: 10,
    });
    expect(d.state).toBe("EMERGING");
  });

  test("high score + strong positive accel + cold prev → IGNITING", () => {
    const d = classifyTrajectory({
      emergenceScore: 0.55,
      acceleration: buildAccel({ accelerationIndex: 0.20 }),
      previousState: "STALLED",
      previousStreakLength: 5,
      daysSinceLastSignal: 5,
    });
    expect(d.state).toBe("IGNITING");
  });

  test("high score + sustained positive accel + already moving → ACCELERATING", () => {
    const d = classifyTrajectory({
      emergenceScore: 0.65,
      acceleration: buildAccel({ accelerationIndex: 0.20 }),
      previousState: "ACCELERATING",
      previousStreakLength: 3,
      daysSinceLastSignal: 5,
    });
    expect(d.state).toBe("ACCELERATING");
    expect(d.streakLength).toBe(4);
  });

  test("high score + flat → STEADY", () => {
    const d = classifyTrajectory({
      emergenceScore: 0.55,
      acceleration: buildAccel(),
      previousState: "STEADY",
      previousStreakLength: 2,
      daysSinceLastSignal: 10,
    });
    expect(d.state).toBe("STEADY");
    expect(d.streakLength).toBe(3);
  });

  test("strong negative accel → DECAYING", () => {
    const d = classifyTrajectory({
      emergenceScore: 0.45,
      acceleration: buildAccel({ accelerationIndex: -0.25, shortTermDelta: -0.2 }),
      previousState: "STEADY",
      previousStreakLength: 3,
      daysSinceLastSignal: 10,
    });
    expect(d.state).toBe("DECAYING");
  });

  test("very stale → DORMANT", () => {
    const d = classifyTrajectory({
      emergenceScore: 0.3,
      acceleration: buildAccel(),
      previousState: "STEADY",
      previousStreakLength: 2,
      daysSinceLastSignal: TRAJECTORY_THRESHOLDS.DORMANT_DAYS + 30,
    });
    expect(d.state).toBe("DORMANT");
  });

  test("streak resets to 1 on state change", () => {
    const d = classifyTrajectory({
      emergenceScore: 0.50,
      acceleration: buildAccel({ accelerationIndex: 0.20 }),
      previousState: "STEADY",
      previousStreakLength: 5,
      daysSinceLastSignal: 5,
    });
    expect(d.state).toBe("ACCELERATING");
    expect(d.streakLength).toBe(1);
  });
});

describe("detectEmergenceDecay + detectMomentumShift", () => {
  test("DECAYING / STALLED / DORMANT detected as decay", () => {
    for (const state of ["DECELERATING", "DECAYING", "STALLED", "DORMANT"] as const) {
      expect(
        detectEmergenceDecay({
          state,
          previousState: null,
          streakLength: 1,
          shiftDetected: false,
          shiftReason: null,
        })
      ).toBe(true);
    }
  });

  test("ACCELERATING / IGNITING / STEADY are not decay", () => {
    for (const state of ["ACCELERATING", "IGNITING", "STEADY", "EMERGING"] as const) {
      expect(
        detectEmergenceDecay({
          state,
          previousState: null,
          streakLength: 1,
          shiftDetected: false,
          shiftReason: null,
        })
      ).toBe(false);
    }
  });

  test("detectMomentumShift respects shiftDetected", () => {
    expect(detectMomentumShift({
      state: "STEADY",
      previousState: null,
      streakLength: 1,
      shiftDetected: true,
      shiftReason: "ignition_from_flat",
    })).toBe(true);
  });
});

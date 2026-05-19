// Phase MI-10 — Alert rule evaluator tests.

import { describe, expect, test } from "vitest";
import { evaluateAlertRule } from "../alerts";
import type { AlertEvaluationContext } from "../types";

function ctx(overrides: Partial<AlertEvaluationContext>): AlertEvaluationContext {
  return {
    rule: {
      id: "r1",
      triggerKind: "PROBABILITY_SPIKE",
      severityFloor: "WATCH",
      criteria: { triggerKind: "PROBABILITY_SPIKE", minDelta: 0.20, windowDays: 7 },
      cooldownMinutes: 1440,
      lastFiredAt: null,
    },
    subject: {
      subjectKind: "PROJECT",
      subjectId: "p1",
      projectId: "p1",
      parcelId: null,
    },
    recentScores: [],
    latestSnapshotId: null,
    ...overrides,
  };
}

function daysAgo(d: number): Date {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000);
}

describe("evaluateAlertRule — cooldown", () => {
  test("does not fire while within cooldown window", () => {
    const r = evaluateAlertRule(ctx({
      rule: {
        id: "r1",
        triggerKind: "PROBABILITY_SPIKE",
        severityFloor: "WATCH",
        criteria: { triggerKind: "PROBABILITY_SPIKE", minDelta: 0.20, windowDays: 7 },
        cooldownMinutes: 1440,
        lastFiredAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
      },
      recentScores: [
        { score: 0.20, at: daysAgo(7), trajectoryState: "STEADY" },
        { score: 0.60, at: daysAgo(0), trajectoryState: "ACCELERATING" },
      ],
    }));
    expect(r.shouldFire).toBe(false);
    expect(r.rationale).toBe("cooldown_active");
  });

  test("fires after cooldown expires", () => {
    const r = evaluateAlertRule(ctx({
      rule: {
        id: "r1",
        triggerKind: "PROBABILITY_SPIKE",
        severityFloor: "WATCH",
        criteria: { triggerKind: "PROBABILITY_SPIKE", minDelta: 0.20, windowDays: 7 },
        cooldownMinutes: 60,
        lastFiredAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
      },
      recentScores: [
        { score: 0.20, at: daysAgo(7), trajectoryState: "STEADY" },
        { score: 0.60, at: daysAgo(0), trajectoryState: "ACCELERATING" },
      ],
    }));
    expect(r.shouldFire).toBe(true);
  });
});

describe("evaluateAlertRule — PROBABILITY_SPIKE", () => {
  test("fires when delta exceeds threshold", () => {
    const r = evaluateAlertRule(ctx({
      recentScores: [
        { score: 0.20, at: daysAgo(7), trajectoryState: "STEADY" },
        { score: 0.55, at: daysAgo(0), trajectoryState: "ACCELERATING" },
      ],
    }));
    expect(r.shouldFire).toBe(true);
    expect(r.capturedScore).toBeCloseTo(0.55);
    expect(r.capturedTrajectory).toBe("ACCELERATING");
    expect(r.factors.length).toBeGreaterThan(0);
  });

  test("does not fire when delta below threshold", () => {
    const r = evaluateAlertRule(ctx({
      recentScores: [
        { score: 0.20, at: daysAgo(7), trajectoryState: "STEADY" },
        { score: 0.30, at: daysAgo(0), trajectoryState: "STEADY" },
      ],
    }));
    expect(r.shouldFire).toBe(false);
    expect(r.rationale).toContain("below");
  });

  test("does not fire with empty history", () => {
    const r = evaluateAlertRule(ctx({}));
    expect(r.shouldFire).toBe(false);
    expect(r.rationale).toBe("not_enough_history");
  });
});

describe("evaluateAlertRule — TRAJECTORY_SHIFT", () => {
  test("fires when state transitions into a target state", () => {
    const r = evaluateAlertRule(ctx({
      rule: {
        id: "r2",
        triggerKind: "TRAJECTORY_SHIFT",
        severityFloor: "WATCH",
        criteria: { triggerKind: "TRAJECTORY_SHIFT", states: ["IGNITING", "ACCELERATING"] },
        cooldownMinutes: 0,
        lastFiredAt: null,
      },
      recentScores: [
        { score: 0.30, at: daysAgo(3), trajectoryState: "STEADY" },
        { score: 0.50, at: daysAgo(0), trajectoryState: "IGNITING" },
      ],
    }));
    expect(r.shouldFire).toBe(true);
    expect(r.headline).toContain("IGNITING");
  });

  test("does not fire when latest state already same as previous", () => {
    const r = evaluateAlertRule(ctx({
      rule: {
        id: "r2",
        triggerKind: "TRAJECTORY_SHIFT",
        severityFloor: "WATCH",
        criteria: { triggerKind: "TRAJECTORY_SHIFT", states: ["IGNITING"] },
        cooldownMinutes: 0,
        lastFiredAt: null,
      },
      recentScores: [
        { score: 0.50, at: daysAgo(3), trajectoryState: "STEADY" },
        { score: 0.52, at: daysAgo(0), trajectoryState: "STEADY" },
      ],
    }));
    expect(r.shouldFire).toBe(false);
  });
});

describe("evaluateAlertRule — CORRIDOR_IGNITION", () => {
  test("fires when corridor heat + acceleration both above thresholds", () => {
    const r = evaluateAlertRule(ctx({
      rule: {
        id: "r3",
        triggerKind: "CORRIDOR_IGNITION",
        severityFloor: "WATCH",
        criteria: { triggerKind: "CORRIDOR_IGNITION", minHeatScore: 0.5, minAcceleration: 0.15 },
        cooldownMinutes: 0,
        lastFiredAt: null,
      },
      subject: { subjectKind: "CORRIDOR", subjectId: "corridor:test", projectId: null, parcelId: null },
      corridorHeat: { heatScore: 0.70, acceleration: 0.30 },
    }));
    expect(r.shouldFire).toBe(true);
    expect(r.severity).toBe("URGENT");
  });

  test("does not fire when accel below threshold", () => {
    const r = evaluateAlertRule(ctx({
      rule: {
        id: "r3",
        triggerKind: "CORRIDOR_IGNITION",
        severityFloor: "WATCH",
        criteria: { triggerKind: "CORRIDOR_IGNITION", minHeatScore: 0.5, minAcceleration: 0.15 },
        cooldownMinutes: 0,
        lastFiredAt: null,
      },
      subject: { subjectKind: "CORRIDOR", subjectId: "corridor:test", projectId: null, parcelId: null },
      corridorHeat: { heatScore: 0.70, acceleration: 0.05 },
    }));
    expect(r.shouldFire).toBe(false);
  });
});

describe("evaluateAlertRule — HIGH_CONFIDENCE_EMERGENCE", () => {
  test("fires when latest score crosses threshold", () => {
    const r = evaluateAlertRule(ctx({
      rule: {
        id: "r4",
        triggerKind: "HIGH_CONFIDENCE_EMERGENCE",
        severityFloor: "WATCH",
        criteria: { triggerKind: "HIGH_CONFIDENCE_EMERGENCE", minScore: 0.70, requiredConfidence: "HIGH" },
        cooldownMinutes: 0,
        lastFiredAt: null,
      },
      recentScores: [
        { score: 0.75, at: daysAgo(0), trajectoryState: "ACCELERATING" },
      ],
    }));
    expect(r.shouldFire).toBe(true);
  });

  test("does not fire below threshold", () => {
    const r = evaluateAlertRule(ctx({
      rule: {
        id: "r4",
        triggerKind: "HIGH_CONFIDENCE_EMERGENCE",
        severityFloor: "WATCH",
        criteria: { triggerKind: "HIGH_CONFIDENCE_EMERGENCE", minScore: 0.70, requiredConfidence: "HIGH" },
        cooldownMinutes: 0,
        lastFiredAt: null,
      },
      recentScores: [
        { score: 0.60, at: daysAgo(0), trajectoryState: "STEADY" },
      ],
    }));
    expect(r.shouldFire).toBe(false);
  });
});

describe("evaluateAlertRule — runner-dependent triggers", () => {
  test("TIMELINE_PULL_IN returns not-firing in PR-1", () => {
    const r = evaluateAlertRule(ctx({
      rule: {
        id: "r5",
        triggerKind: "TIMELINE_PULL_IN",
        severityFloor: "WATCH",
        criteria: { triggerKind: "TIMELINE_PULL_IN", milestoneKind: "CONSTRUCTION_START", minDaysPulledIn: 30 },
        cooldownMinutes: 0,
        lastFiredAt: null,
      },
    }));
    expect(r.shouldFire).toBe(false);
  });

  test("CUSTOM is no-op in PR-1", () => {
    const r = evaluateAlertRule(ctx({
      rule: {
        id: "r6",
        triggerKind: "CUSTOM",
        severityFloor: "WATCH",
        criteria: { triggerKind: "CUSTOM", description: "test" },
        cooldownMinutes: 0,
        lastFiredAt: null,
      },
    }));
    expect(r.shouldFire).toBe(false);
  });
});

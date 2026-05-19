// Phase MI-9 — Forecast accuracy + Brier + timeline/trajectory tests.

import { describe, expect, test } from "vitest";
import {
  evaluateForecastAccuracy,
  computeProbabilityAccuracy,
  computeTimelineAccuracy,
  computeTrajectoryAccuracy,
  computeOutcomeKindAccuracy,
} from "../accuracy";
import { classifyPosture, type ForecastAssertion, type ObservedOutcome } from "../types";

function fc(overrides: Partial<ForecastAssertion> = {}): ForecastAssertion {
  return {
    forecastSnapshotId: "fs1",
    predictedScore: 0.5,
    predictedTrajectory: "STEADY",
    predictedAt: new Date("2026-01-01T00:00:00Z"),
    confidence: "MEDIUM",
    ...overrides,
  };
}

function out(overrides: Partial<ObservedOutcome> = {}): ObservedOutcome {
  return {
    outcomeId: "o1",
    outcomeKind: "CONSTRUCTION_STARTED",
    occurredAt: new Date("2026-03-01T00:00:00Z"),
    ...overrides,
  };
}

describe("classifyPosture", () => {
  test("buckets thresholds correctly", () => {
    expect(classifyPosture(0.05)).toBe("UNPREDICTED");
    expect(classifyPosture(0.20)).toBe("LOW_CONF_PREDICTED");
    expect(classifyPosture(0.40)).toBe("MEDIUM_CONF_PREDICTED");
    expect(classifyPosture(0.75)).toBe("HIGH_CONF_PREDICTED");
  });
});

describe("computeProbabilityAccuracy (Brier)", () => {
  test("perfect prediction (score 1, positive outcome) scores 1.0", () => {
    const r = computeProbabilityAccuracy(fc({ predictedScore: 1 }), out());
    expect(r.accuracyScore).toBe(1);
    expect(r.brierScore).toBe(0);
  });

  test("perfect prediction (score 0, project_abandoned) scores 1.0", () => {
    const r = computeProbabilityAccuracy(
      fc({ predictedScore: 0 }),
      out({ outcomeKind: "PROJECT_ABANDONED" })
    );
    expect(r.accuracyScore).toBe(1);
    expect(r.brierScore).toBe(0);
  });

  test("worst prediction (score 1, project_abandoned) scores 0.0", () => {
    const r = computeProbabilityAccuracy(
      fc({ predictedScore: 1 }),
      out({ outcomeKind: "PROJECT_ABANDONED" })
    );
    expect(r.accuracyScore).toBe(0);
    expect(r.brierScore).toBe(1);
  });

  test("middle-ground predictions get middle-ground scores", () => {
    const r = computeProbabilityAccuracy(fc({ predictedScore: 0.5 }), out());
    expect(r.accuracyScore).toBeGreaterThan(0.2);
    expect(r.accuracyScore).toBeLessThan(0.8);
  });
});

describe("computeOutcomeKindAccuracy", () => {
  test("predicts-positive + positive-outcome scores 1", () => {
    const r = computeOutcomeKindAccuracy(fc({ predictedScore: 0.7 }), out({ outcomeKind: "CONSTRUCTION_STARTED" }));
    expect(r.accuracyScore).toBe(1);
  });

  test("predicts-positive + disconfirming-outcome scores 0", () => {
    const r = computeOutcomeKindAccuracy(fc({ predictedScore: 0.7 }), out({ outcomeKind: "PROJECT_ABANDONED" }));
    expect(r.accuracyScore).toBe(0);
  });

  test("predicts-negative + disconfirming-outcome scores 1", () => {
    const r = computeOutcomeKindAccuracy(fc({ predictedScore: 0.1 }), out({ outcomeKind: "PROJECT_ABANDONED" }));
    expect(r.accuracyScore).toBe(1);
  });
});

describe("computeTimelineAccuracy", () => {
  const earliestAt = new Date("2026-03-01T00:00:00Z");
  const expectedAt = new Date("2026-04-01T00:00:00Z");
  const latestAt = new Date("2026-05-01T00:00:00Z");

  test("actual within band scores 1.0", () => {
    const r = computeTimelineAccuracy({
      milestoneKind: "CONSTRUCTION_START",
      earliestAt, expectedAt, latestAt,
      actualAt: new Date("2026-04-10T00:00:00Z"),
    });
    expect(r.withinBand).toBe(true);
    expect(r.accuracyScore).toBe(1);
  });

  test("actual far outside band scores low", () => {
    const r = computeTimelineAccuracy({
      milestoneKind: "CONSTRUCTION_START",
      earliestAt, expectedAt, latestAt,
      actualAt: new Date("2026-12-01T00:00:00Z"),
    });
    expect(r.withinBand).toBe(false);
    expect(r.accuracyScore).toBeLessThan(0.3);
    expect(r.errorDays).toBeGreaterThan(200);
  });

  test("jurisdictionAdjustedErrorDays subtracts jurisdiction lag", () => {
    const r = computeTimelineAccuracy({
      milestoneKind: "CONSTRUCTION_START",
      earliestAt, expectedAt, latestAt,
      actualAt: new Date("2026-05-10T00:00:00Z"),
      jurisdictionLagDays: 30,
    });
    expect(r.jurisdictionAdjustedErrorDays).toBeCloseTo(r.errorDays - 30);
  });
});

describe("computeTrajectoryAccuracy", () => {
  test("exact state match scores 1.0 and ALIGNED", () => {
    const r = computeTrajectoryAccuracy({
      predictedState: "ACCELERATING",
      actualState: "ACCELERATING",
      engineFlaggedShift: false,
      outcomeImpliesShift: false,
    });
    expect(r.alignment).toBe("ALIGNED");
    expect(r.accuracyScore).toBe(1);
  });

  test("same-regime divergence scores 0.5", () => {
    const r = computeTrajectoryAccuracy({
      predictedState: "ACCELERATING",
      actualState: "STEADY",
      engineFlaggedShift: false,
      outcomeImpliesShift: false,
    });
    expect(r.alignment).toBe("DIVERGED");
    expect(r.accuracyScore).toBe(0.5);
  });

  test("opposite-regime divergence scores 0", () => {
    const r = computeTrajectoryAccuracy({
      predictedState: "ACCELERATING",
      actualState: "DECAYING",
      engineFlaggedShift: false,
      outcomeImpliesShift: false,
    });
    expect(r.alignment).toBe("DIVERGED");
    expect(r.accuracyScore).toBe(0);
  });

  test("correct shift flag bumps to EARLY_SHIFT + ≥ 0.8", () => {
    const r = computeTrajectoryAccuracy({
      predictedState: "ACCELERATING",
      actualState: "STEADY",
      engineFlaggedShift: true,
      outcomeImpliesShift: true,
    });
    expect(r.alignment).toBe("EARLY_SHIFT");
    expect(r.accuracyScore).toBeGreaterThanOrEqual(0.8);
    expect(r.shiftCorrect).toBe(true);
  });

  test("missed shift drops accuracy ≤ 0.3", () => {
    const r = computeTrajectoryAccuracy({
      predictedState: "STEADY",
      actualState: "DECAYING",
      engineFlaggedShift: false,
      outcomeImpliesShift: true,
    });
    expect(r.alignment).toBe("MISSED_SHIFT");
    expect(r.accuracyScore).toBeLessThanOrEqual(0.3);
    expect(r.shiftMissed).toBe(true);
  });
});

describe("evaluateForecastAccuracy composite", () => {
  test("strong correct prediction resolves CONFIRMED", () => {
    const r = evaluateForecastAccuracy({
      forecast: fc({ predictedScore: 0.95 }),
      outcome: out({ outcomeKind: "CONSTRUCTION_STARTED" }),
    });
    expect(r.resolutionState).toBe("CONFIRMED");
    expect(r.compositeAccuracy).toBeGreaterThan(0.8);
    expect(r.accuracies.length).toBeGreaterThanOrEqual(3); // probability + outcome_kind + composite
  });

  test("strong wrong prediction resolves DISCONFIRMED", () => {
    const r = evaluateForecastAccuracy({
      forecast: fc({ predictedScore: 0.95 }),
      outcome: out({ outcomeKind: "PROJECT_ABANDONED" }),
    });
    expect(r.resolutionState).toBe("DISCONFIRMED");
    expect(r.compositeAccuracy).toBeLessThan(0.2);
  });

  test("middle-ground resolves PARTIAL", () => {
    const r = evaluateForecastAccuracy({
      forecast: fc({ predictedScore: 0.45 }),
      outcome: out({ outcomeKind: "CONSTRUCTION_STARTED" }),
    });
    expect(r.resolutionState).toBe("PARTIAL");
  });

  test("includes trajectory when provided", () => {
    const r = evaluateForecastAccuracy({
      forecast: fc({ predictedScore: 0.9 }),
      outcome: out(),
      trajectory: {
        predictedState: "ACCELERATING",
        actualState: "ACCELERATING",
        engineFlaggedShift: false,
        outcomeImpliesShift: false,
      },
    });
    expect(r.accuracies.find((a) => a.accuracyKind === "TRAJECTORY")).toBeTruthy();
  });

  test("includes timeline rows when expectedTimeline + observedMilestones present", () => {
    const r = evaluateForecastAccuracy({
      forecast: fc({
        predictedScore: 0.8,
        expectedTimeline: {
          CONSTRUCTION_START: {
            earliest: new Date("2026-02-15T00:00:00Z"),
            expected: new Date("2026-03-01T00:00:00Z"),
            latest: new Date("2026-03-15T00:00:00Z"),
          },
        },
      }),
      outcome: out({
        observedMilestones: {
          CONSTRUCTION_START: new Date("2026-03-05T00:00:00Z"),
        },
      }),
    });
    expect(r.accuracies.find((a) => a.accuracyKind === "TIMELINE")).toBeTruthy();
  });

  test("evaluationVersion is tagged 'v1'", () => {
    const r = evaluateForecastAccuracy({
      forecast: fc(),
      outcome: out(),
    });
    expect(r.evaluationVersion).toBe("v1");
  });
});

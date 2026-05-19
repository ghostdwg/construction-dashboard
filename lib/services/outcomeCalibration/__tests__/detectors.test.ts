// Phase MI-9 — False-positive + false-negative detector tests.

import { describe, expect, test } from "vitest";
import { detectFalsePositive, detectFalseNegative } from "../detectors";
import type { ForecastAssertion, ObservedOutcome } from "../types";

function fc(overrides: Partial<ForecastAssertion> = {}): ForecastAssertion {
  return {
    forecastSnapshotId: "fs1",
    predictedScore: 0.8,
    predictedTrajectory: "ACCELERATING",
    predictedAt: new Date("2026-01-01T00:00:00Z"),
    confidence: "HIGH",
    ...overrides,
  };
}

describe("detectFalsePositive", () => {
  test("returns false when score too low to qualify", () => {
    const r = detectFalsePositive({
      forecast: fc({ predictedScore: 0.2 }),
      expectedByLatest: new Date("2026-03-01T00:00:00Z"),
      referenceDate: new Date("2026-04-01T00:00:00Z"),
      outcomesSincePrediction: [],
    });
    expect(r.isFalsePositive).toBe(false);
  });

  test("returns false when confirming outcome present", () => {
    const r = detectFalsePositive({
      forecast: fc(),
      expectedByLatest: new Date("2026-03-01T00:00:00Z"),
      referenceDate: new Date("2026-04-01T00:00:00Z"),
      outcomesSincePrediction: [
        { outcomeId: "o1", outcomeKind: "PERMIT_ISSUED", occurredAt: new Date("2026-02-20T00:00:00Z") },
      ],
    });
    expect(r.isFalsePositive).toBe(false);
  });

  test("returns true when deadline passed with no confirming outcome", () => {
    const r = detectFalsePositive({
      forecast: fc(),
      expectedByLatest: new Date("2026-03-01T00:00:00Z"),
      referenceDate: new Date("2026-04-01T00:00:00Z"),
      outcomesSincePrediction: [],
    });
    expect(r.isFalsePositive).toBe(true);
  });

  test("returns true when disconfirming outcome present (no deadline check)", () => {
    const r = detectFalsePositive({
      forecast: fc(),
      expectedByLatest: new Date("2026-12-01T00:00:00Z"), // future
      referenceDate: new Date("2026-04-01T00:00:00Z"),
      outcomesSincePrediction: [
        { outcomeId: "o1", outcomeKind: "PROJECT_ABANDONED", occurredAt: new Date("2026-02-20T00:00:00Z") },
      ],
    });
    expect(r.isFalsePositive).toBe(true);
    expect(r.disconfirmingOutcomeId).toBe("o1");
  });

  test("hints choose the most-specific reasonClass", () => {
    const r = detectFalsePositive({
      forecast: fc(),
      expectedByLatest: new Date("2026-03-01T00:00:00Z"),
      referenceDate: new Date("2026-04-01T00:00:00Z"),
      outcomesSincePrediction: [],
      hints: { shellClusterMisread: true, overweightDeveloper: true },
    });
    expect(r.reasonClass).toBe("SHELL_CLUSTER_MISREAD");
  });

  test("returns false when deadline not yet reached", () => {
    const r = detectFalsePositive({
      forecast: fc(),
      expectedByLatest: new Date("2026-12-01T00:00:00Z"),
      referenceDate: new Date("2026-04-01T00:00:00Z"),
      outcomesSincePrediction: [],
    });
    expect(r.isFalsePositive).toBe(false);
  });
});

describe("detectFalseNegative", () => {
  function out(overrides: Partial<ObservedOutcome> = {}): ObservedOutcome {
    return {
      outcomeId: "o1",
      outcomeKind: "CONSTRUCTION_STARTED",
      occurredAt: new Date("2026-03-01T00:00:00Z"),
      ...overrides,
    };
  }

  test("returns false for non-positive outcome kinds", () => {
    const r = detectFalseNegative({
      outcome: out({ outcomeKind: "PROJECT_ABANDONED" }),
      precedingForecast: null,
    });
    expect(r.isFalseNegative).toBe(false);
  });

  test("returns false when preceding HIGH_CONF forecast existed", () => {
    const r = detectFalseNegative({
      outcome: out(),
      precedingForecast: {
        forecastSnapshotId: "fs1",
        predictedScore: 0.85,
        predictedTrajectory: "ACCELERATING",
        predictedAt: new Date("2026-02-01T00:00:00Z"),
        confidence: "HIGH",
      },
    });
    expect(r.isFalseNegative).toBe(false);
  });

  test("returns true when no preceding forecast", () => {
    const r = detectFalseNegative({
      outcome: out(),
      precedingForecast: null,
    });
    expect(r.isFalseNegative).toBe(true);
    expect(r.missedByDays).toBeNull();
  });

  test("returns true when preceding score was LOW", () => {
    const r = detectFalseNegative({
      outcome: out(),
      precedingForecast: {
        forecastSnapshotId: "fs1",
        predictedScore: 0.20,
        predictedTrajectory: "STALLED",
        predictedAt: new Date("2026-02-01T00:00:00Z"),
        confidence: "LOW",
      },
    });
    expect(r.isFalseNegative).toBe(true);
    expect(r.missedByDays).toBeGreaterThan(0);
  });

  test("hints pick reason class", () => {
    const r = detectFalseNegative({
      outcome: out(),
      precedingForecast: null,
      hints: { missedCorridorIgnition: true, underweightParcel: true },
    });
    expect(r.reasonClass).toBe("MISSED_CORRIDOR_IGNITION");
  });
});

// Phase MI-9 — Jurisdiction + corridor calibration tests.

import { describe, expect, test } from "vitest";
import {
  computeJurisdictionCalibration,
  computeCorridorCalibration,
  calibrateForecastWeights,
} from "../calibration";
import type { ResolutionAggregateRow } from "../calibration";

function row(overrides: Partial<ResolutionAggregateRow> = {}): ResolutionAggregateRow {
  return {
    resolutionId: "r1",
    resolutionState: "CONFIRMED",
    probabilityAccuracy: 0.85,
    brierScore: 0.05,
    timelineErrorDays: null,
    trajectoryAlignment: "ALIGNED",
    isFalsePositive: false,
    isFalseNegative: false,
    outcomeKind: "CONSTRUCTION_STARTED",
    predictedScore: 0.85,
    ...overrides,
  };
}

describe("computeJurisdictionCalibration", () => {
  test("empty jurisdiction returns zero counts", () => {
    const r = computeJurisdictionCalibration({
      jurisdictionKey: "ghost town",
      resolutions: [],
    });
    expect(r.resolutionCount).toBe(0);
    expect(r.confirmedCount).toBe(0);
    expect(r.typicalLagDays).toBeNull();
    expect(r.recommendedAdjustments.length).toBe(0);
  });

  test("median lag drives LAG_DAYS recommendation when ≥ 14 days", () => {
    const resolutions = [
      row({ resolutionId: "r1", resolutionState: "CONFIRMED", timelineErrorDays: 35 }),
      row({ resolutionId: "r2", resolutionState: "CONFIRMED", timelineErrorDays: 45 }),
      row({ resolutionId: "r3", resolutionState: "PARTIAL", timelineErrorDays: 40 }),
      row({ resolutionId: "r4", resolutionState: "CONFIRMED", timelineErrorDays: 50 }),
    ];
    const r = computeJurisdictionCalibration({
      jurisdictionKey: "slow town",
      resolutions,
    });
    expect(r.typicalLagDays).toBeCloseTo(42.5, 1);
    expect(r.recommendedAdjustments.find((a) => a.adjustmentKind === "LAG_DAYS")).toBeTruthy();
  });

  test("high FP rate triggers downweight recommendations", () => {
    const resolutions = [
      row({ resolutionId: "r1", isFalsePositive: true, resolutionState: "DISCONFIRMED" }),
      row({ resolutionId: "r2", isFalsePositive: true, resolutionState: "DISCONFIRMED" }),
      row({ resolutionId: "r3", isFalsePositive: true, resolutionState: "DISCONFIRMED" }),
      row({ resolutionId: "r4", resolutionState: "CONFIRMED" }),
      row({ resolutionId: "r5", resolutionState: "PARTIAL" }),
    ];
    const r = computeJurisdictionCalibration({
      jurisdictionKey: "overconfident",
      resolutions,
    });
    expect(r.falsePositiveCount).toBe(3);
    const downweights = r.recommendedAdjustments.filter((a) => a.adjustmentKind === "WEIGHT_MULTIPLIER" && a.value < 1);
    expect(downweights.length).toBeGreaterThanOrEqual(2);
  });

  test("high FN rate triggers upweight recommendations", () => {
    const resolutions = [
      row({ resolutionId: "r1", isFalseNegative: true }),
      row({ resolutionId: "r2", isFalseNegative: true }),
      row({ resolutionId: "r3", isFalseNegative: true }),
      row({ resolutionId: "r4", resolutionState: "CONFIRMED" }),
    ];
    const r = computeJurisdictionCalibration({
      jurisdictionKey: "underconfident",
      resolutions,
    });
    expect(r.falseNegativeCount).toBe(3);
    const upweights = r.recommendedAdjustments.filter((a) => a.adjustmentKind === "WEIGHT_MULTIPLIER" && a.value > 1);
    expect(upweights.length).toBeGreaterThanOrEqual(2);
  });

  test("balanced FP/FN → no weight adjustments", () => {
    const resolutions = [
      row({ resolutionId: "r1", isFalsePositive: true, resolutionState: "DISCONFIRMED" }),
      row({ resolutionId: "r2", isFalseNegative: true }),
      row({ resolutionId: "r3", resolutionState: "CONFIRMED" }),
      row({ resolutionId: "r4", resolutionState: "CONFIRMED" }),
    ];
    const r = computeJurisdictionCalibration({
      jurisdictionKey: "balanced",
      resolutions,
    });
    const weightAdjustments = r.recommendedAdjustments.filter((a) => a.adjustmentKind === "WEIGHT_MULTIPLIER");
    expect(weightAdjustments.length).toBe(0);
  });

  test("trajectory alignment rate computed correctly", () => {
    const resolutions = [
      row({ resolutionId: "r1", trajectoryAlignment: "ALIGNED", resolutionState: "CONFIRMED" }),
      row({ resolutionId: "r2", trajectoryAlignment: "EARLY_SHIFT", resolutionState: "CONFIRMED" }),
      row({ resolutionId: "r3", trajectoryAlignment: "DIVERGED", resolutionState: "DISCONFIRMED" }),
      row({ resolutionId: "r4", trajectoryAlignment: "MISSED_SHIFT", resolutionState: "DISCONFIRMED" }),
    ];
    const r = computeJurisdictionCalibration({
      jurisdictionKey: "mixed",
      resolutions,
    });
    expect(r.trajectoryAlignmentRate).toBeCloseTo(0.5);
  });
});

describe("computeCorridorCalibration", () => {
  test("low shell realization rate triggers shellPatternBoost downweight", () => {
    const resolutions: ResolutionAggregateRow[] = [
      row({ outcomeKind: "SHELL_REALIZED", resolutionState: "DISCONFIRMED" }),
      row({ outcomeKind: "SHELL_REALIZED", resolutionState: "DISCONFIRMED" }),
      row({ outcomeKind: "SHELL_REALIZED", resolutionState: "DISCONFIRMED" }),
      row({ outcomeKind: "SHELL_REALIZED", resolutionState: "CONFIRMED" }),
      row({ outcomeKind: "SHELL_REALIZED", resolutionState: "DISCONFIRMED" }),
    ];
    const r = computeCorridorCalibration({
      corridorKey: "corridor:noisy",
      resolutions,
    });
    expect(r.shellRealizationRate).toBeCloseTo(0.2);
    expect(r.recommendedAdjustments.find((a) => a.factorName === "shellPatternBoost")).toBeTruthy();
  });

  test("high FP rate triggers corridorBoost downweight", () => {
    const resolutions: ResolutionAggregateRow[] = Array.from({ length: 10 }, (_, i) =>
      row({
        resolutionId: `r${i}`,
        isFalsePositive: i < 5,
        resolutionState: i < 5 ? "DISCONFIRMED" : "CONFIRMED",
      })
    );
    const r = computeCorridorCalibration({
      corridorKey: "corridor:overhyped",
      resolutions,
    });
    expect(r.falsePositiveRate).toBeCloseTo(0.5);
    expect(r.recommendedAdjustments.find((a) => a.factorName === "corridorBoost")).toBeTruthy();
  });

  test("highly predictive corridor produces no adjustments", () => {
    const resolutions: ResolutionAggregateRow[] = Array.from({ length: 10 }, (_, i) =>
      row({ resolutionId: `r${i}`, probabilityAccuracy: 0.9 })
    );
    const r = computeCorridorCalibration({
      corridorKey: "corridor:reliable",
      resolutions,
    });
    expect(r.recommendedAdjustments.length).toBe(0);
    expect(r.reasonLog.join(" ")).toContain("highly predictive");
  });
});

describe("calibrateForecastWeights", () => {
  test("groups by jurisdiction + corridor, skips thin samples", () => {
    const make = (i: number, jur: string | null, cor: string | null, overrides: Partial<ResolutionAggregateRow> = {}): ResolutionAggregateRow & { jurisdictionKey: string | null; corridorKey: string | null } => ({
      ...row({ resolutionId: `r${i}`, ...overrides }),
      jurisdictionKey: jur,
      corridorKey: cor,
    });

    const resolutions = [
      // Jurisdiction A — 5 disconfirmations with same lag (above threshold for LAG_DAYS)
      ...Array.from({ length: 5 }, (_, i) => make(i, "city a", null, { resolutionState: "CONFIRMED", timelineErrorDays: 50, isFalsePositive: false })),
      // Jurisdiction B — only 2 rows (skipped)
      ...Array.from({ length: 2 }, (_, i) => make(i + 5, "city b", null)),
      // Corridor X — 6 false positives (recommendation)
      ...Array.from({ length: 6 }, (_, i) => make(i + 7, null, "corridor:x", {
        resolutionState: "DISCONFIRMED",
        isFalsePositive: true,
      })),
    ];

    const r = calibrateForecastWeights({ resolutions });
    // Jurisdiction A should produce LAG_DAYS rec
    expect(r.recommendations.find((rec) => rec.scope === "JURISDICTION" && rec.scopeKey === "city a" && rec.adjustmentKind === "LAG_DAYS")).toBeTruthy();
    // Jurisdiction B should NOT appear (under 5-sample threshold)
    expect(r.recommendations.find((rec) => rec.scopeKey === "city b")).toBeFalsy();
    // Corridor X should produce a corridorBoost downweight
    expect(r.recommendations.find((rec) => rec.scope === "CORRIDOR" && rec.scopeKey === "corridor:x" && rec.factorName === "corridorBoost")).toBeTruthy();
  });
});

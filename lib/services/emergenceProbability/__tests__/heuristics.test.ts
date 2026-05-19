// Phase MI-8 — Forecast heuristics + composite-score tests.

import { describe, expect, test } from "vitest";
import {
  computeAllFactors,
  computeRecencyMultiplier,
  scoreBaselineProbability,
  scoreSignalVolume,
  scoreSignalDiversity,
  scoreDeveloperRecurrence,
  scoreBrokerRecurrence,
  scoreContinuancePressure,
  scoreUtilityExpansion,
  scoreParcelPressure,
  scorePressuredNeighborCount,
  scoreShellPatternBoost,
  scoreCorridorBoost,
  scoreInfrastructureBoost,
} from "../heuristics";
import { computeEmergenceScore } from "../forecast";
import type { ForecastSubjectContext } from "../types";
import { RECENCY_HALF_LIFE_DAYS } from "../types";

function baseCtx(overrides: Partial<ForecastSubjectContext> = {}): ForecastSubjectContext {
  return {
    subjectKind: "PROJECT",
    subjectId: "subj1",
    projectId: "proj1",
    parcelId: null,
    jurisdictionKey: null,
    latestProjectProbability: null,
    latestParcelPressureMean: null,
    probabilityMean30d: null,
    probabilityMean90d: null,
    probabilityMean365d: null,
    signalCountLast30d: 0,
    signalCountLast90d: 0,
    signalCountLast365d: 0,
    developerEntityIds: [],
    brokerEntityIds: [],
    continuanceCount: 0,
    activeUtilityExpansions: 0,
    pressuredNeighborCount: 0,
    onCorridor: false,
    hasInfrastructureInvestment: false,
    daysSinceLastSignal: 9999,
    hasShellBuildingPattern: false,
    ...overrides,
  };
}

describe("computeRecencyMultiplier", () => {
  test("returns 1 for fresh", () => {
    expect(computeRecencyMultiplier(0)).toBe(1);
  });

  test("returns 0.5 at half-life", () => {
    expect(computeRecencyMultiplier(RECENCY_HALF_LIFE_DAYS)).toBeCloseTo(0.5);
  });

  test("decays toward 0", () => {
    expect(computeRecencyMultiplier(RECENCY_HALF_LIFE_DAYS * 6)).toBeLessThan(0.02);
  });
});

describe("individual factor scorers", () => {
  test("baselineProbability passes through MI-6 score", () => {
    expect(scoreBaselineProbability(baseCtx({ latestProjectProbability: 0.42 }))).toBeCloseTo(0.42);
    expect(scoreBaselineProbability(baseCtx({ latestProjectProbability: null }))).toBe(0);
    expect(scoreBaselineProbability(baseCtx({ latestProjectProbability: -0.5 }))).toBe(0);
    expect(scoreBaselineProbability(baseCtx({ latestProjectProbability: 1.5 }))).toBe(1);
  });

  test("signalVolume saturates exponentially", () => {
    expect(scoreSignalVolume(baseCtx({ signalCountLast90d: 0 }))).toBe(0);
    expect(scoreSignalVolume(baseCtx({ signalCountLast90d: 5 }))).toBeGreaterThan(0.5);
    expect(scoreSignalVolume(baseCtx({ signalCountLast90d: 50 }))).toBeGreaterThan(0.99);
  });

  test("signalDiversity saturates linearly at 4", () => {
    expect(scoreSignalDiversity(baseCtx({ signalCountLast30d: 4 }))).toBe(1);
    expect(scoreSignalDiversity(baseCtx({ signalCountLast30d: 2 }))).toBeCloseTo(0.5);
  });

  test("developerRecurrence saturates at 2", () => {
    expect(scoreDeveloperRecurrence(baseCtx({ developerEntityIds: ["a", "b"] }))).toBe(1);
  });

  test("brokerRecurrence saturates at 2", () => {
    expect(scoreBrokerRecurrence(baseCtx({ brokerEntityIds: ["a", "b"] }))).toBe(1);
  });

  test("continuancePressure discrete steps", () => {
    expect(scoreContinuancePressure(baseCtx({ continuanceCount: 1 }))).toBeCloseTo(0.3);
    expect(scoreContinuancePressure(baseCtx({ continuanceCount: 3 }))).toBe(1);
  });

  test("utilityExpansion saturates at 2", () => {
    expect(scoreUtilityExpansion(baseCtx({ activeUtilityExpansions: 2 }))).toBe(1);
  });

  test("parcelPressure passes through MI-7 mean", () => {
    expect(scoreParcelPressure(baseCtx({ latestParcelPressureMean: 0.65 }))).toBeCloseTo(0.65);
    expect(scoreParcelPressure(baseCtx({ latestParcelPressureMean: null }))).toBe(0);
  });

  test("pressuredNeighborCount saturates exponentially", () => {
    expect(scorePressuredNeighborCount(baseCtx({ pressuredNeighborCount: 5 }))).toBeGreaterThan(0.9);
  });

  test("boolean boosts return 0 or 1", () => {
    expect(scoreShellPatternBoost(baseCtx({ hasShellBuildingPattern: true }))).toBe(1);
    expect(scoreShellPatternBoost(baseCtx())).toBe(0);
    expect(scoreCorridorBoost(baseCtx({ onCorridor: true }))).toBe(1);
    expect(scoreInfrastructureBoost(baseCtx({ hasInfrastructureInvestment: true }))).toBe(1);
  });
});

describe("computeAllFactors", () => {
  test("returns every factor as a number in [0, 1]", () => {
    const factors = computeAllFactors(baseCtx({
      daysSinceLastSignal: 0,
      latestProjectProbability: 0.5,
      signalCountLast90d: 10,
      developerEntityIds: ["a", "b"],
    }));
    for (const value of Object.values(factors)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("computeEmergenceScore composite", () => {
  test("cold project scores near zero", () => {
    const result = computeEmergenceScore(baseCtx());
    expect(result.emergenceScore).toBeLessThan(0.001);
    expect(result.contributions.length).toBeLessThanOrEqual(1); // only recency entry, if at all
  });

  test("hot project with all signals scores > 0.6", () => {
    const result = computeEmergenceScore(baseCtx({
      daysSinceLastSignal: 0,
      latestProjectProbability: 0.7,
      latestParcelPressureMean: 0.7,
      signalCountLast30d: 5,
      signalCountLast90d: 12,
      developerEntityIds: ["a", "b"],
      brokerEntityIds: ["c"],
      continuanceCount: 2,
      activeUtilityExpansions: 2,
      pressuredNeighborCount: 3,
      onCorridor: true,
      hasInfrastructureInvestment: true,
      hasShellBuildingPattern: true,
    }));
    expect(result.emergenceScore).toBeGreaterThan(0.6);
    expect(result.contributions.length).toBeGreaterThan(8);
    expect(result.reasonLog.length).toBeGreaterThan(8);
    expect(result.forecastVersion).toBe("v1");
  });

  test("score remains in [0, 1] across extreme inputs", () => {
    const configs: Partial<ForecastSubjectContext>[] = [
      { daysSinceLastSignal: 0 },
      {
        daysSinceLastSignal: 0,
        latestProjectProbability: 1.5,
        signalCountLast90d: 1000,
        developerEntityIds: Array.from({ length: 50 }, (_, i) => `e${i}`),
        pressuredNeighborCount: 1000,
      },
    ];
    for (const overrides of configs) {
      const r = computeEmergenceScore(baseCtx(overrides));
      expect(r.emergenceScore).toBeGreaterThanOrEqual(0);
      expect(r.emergenceScore).toBeLessThanOrEqual(1);
    }
  });

  test("stale parcel (no recent signals) decays heavily", () => {
    const fresh = computeEmergenceScore(baseCtx({
      daysSinceLastSignal: 0,
      latestProjectProbability: 0.5,
      signalCountLast90d: 5,
    }));
    const stale = computeEmergenceScore(baseCtx({
      daysSinceLastSignal: RECENCY_HALF_LIFE_DAYS * 4,
      latestProjectProbability: 0.5,
      signalCountLast90d: 5,
    }));
    expect(stale.emergenceScore).toBeLessThan(fresh.emergenceScore);
    expect(stale.emergenceScore).toBeLessThan(fresh.emergenceScore * 0.1);
  });
});

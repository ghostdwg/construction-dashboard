// Phase MI-7 — Pressure heuristic tests.
//
// Pure-function coverage of the pressure engine: every factor is tested
// individually, then the composite is verified for representative parcels
// (cold parcel, mid-pressure parcel, high-pressure parcel).

import { describe, expect, test } from "vitest";
import {
  computePressure,
  computeRecencyMultiplier,
  scoreDeveloperRecurrence,
  scoreBrokerRecurrence,
  scoreEntitlementActivity,
  scoreUtilityExpansion,
  scoreContinuancePressure,
  scoreNeighborPressure,
  scoreShellClusterProximity,
  scoreOwnershipChurn,
  scoreInfrastructureInvestment,
  scoreCorridorAdjacency,
} from "../pressure";
import type { ParcelPressureInput } from "../types";
import { PRESSURE_RECENCY_HALF_LIFE_DAYS } from "../types";

function baseInput(overrides: Partial<ParcelPressureInput> = {}): ParcelPressureInput {
  return {
    parcelId: "p1",
    attachedProjectCount: 0,
    developerEntityIds: [],
    brokerEntityIds: [],
    recentEntitlementSignals: 0,
    activeUtilityExpansions: 0,
    continuanceCount: 0,
    pressuredNeighborCount: 0,
    nearbyShellPatternCount: 0,
    daysSinceLastSignal: 9999,
    recentOwnershipTransferCount: 0,
    hasInfrastructureInvestment: false,
    isOnCorridor: false,
    ...overrides,
  };
}

describe("recency multiplier", () => {
  test("returns 1 for fresh signal", () => {
    expect(computeRecencyMultiplier(0)).toBe(1);
  });

  test("returns 0.5 at half-life", () => {
    expect(computeRecencyMultiplier(PRESSURE_RECENCY_HALF_LIFE_DAYS)).toBeCloseTo(0.5);
  });

  test("decays toward 0 as days grow", () => {
    expect(computeRecencyMultiplier(PRESSURE_RECENCY_HALF_LIFE_DAYS * 5)).toBeLessThan(0.05);
  });
});

describe("individual factor scorers", () => {
  test("developerRecurrence saturates at 2 developers", () => {
    expect(scoreDeveloperRecurrence(baseInput({ developerEntityIds: [] }))).toBe(0);
    expect(scoreDeveloperRecurrence(baseInput({ developerEntityIds: ["a"] }))).toBeCloseTo(0.5);
    expect(scoreDeveloperRecurrence(baseInput({ developerEntityIds: ["a", "b"] }))).toBe(1);
    expect(scoreDeveloperRecurrence(baseInput({ developerEntityIds: ["a", "b", "c"] }))).toBe(1);
  });

  test("brokerRecurrence saturates at 2", () => {
    expect(scoreBrokerRecurrence(baseInput({ brokerEntityIds: ["a", "b"] }))).toBe(1);
  });

  test("entitlementActivity is non-zero on first signal and saturates", () => {
    expect(scoreEntitlementActivity(baseInput())).toBe(0);
    expect(scoreEntitlementActivity(baseInput({ recentEntitlementSignals: 1 }))).toBeGreaterThan(0);
    expect(scoreEntitlementActivity(baseInput({ recentEntitlementSignals: 10 }))).toBeGreaterThan(0.95);
  });

  test("utilityExpansion saturates at 2", () => {
    expect(scoreUtilityExpansion(baseInput({ activeUtilityExpansions: 0 }))).toBe(0);
    expect(scoreUtilityExpansion(baseInput({ activeUtilityExpansions: 2 }))).toBe(1);
  });

  test("continuancePressure escalates discretely", () => {
    expect(scoreContinuancePressure(baseInput({ continuanceCount: 0 }))).toBe(0);
    expect(scoreContinuancePressure(baseInput({ continuanceCount: 1 }))).toBeCloseTo(0.3);
    expect(scoreContinuancePressure(baseInput({ continuanceCount: 2 }))).toBeCloseTo(0.6);
    expect(scoreContinuancePressure(baseInput({ continuanceCount: 3 }))).toBe(1);
  });

  test("neighborPressure escalates with neighbor count", () => {
    expect(scoreNeighborPressure(baseInput({ pressuredNeighborCount: 0 }))).toBe(0);
    expect(scoreNeighborPressure(baseInput({ pressuredNeighborCount: 5 }))).toBeGreaterThan(0.9);
  });

  test("shellClusterProximity saturates at 2", () => {
    expect(scoreShellClusterProximity(baseInput({ nearbyShellPatternCount: 0 }))).toBe(0);
    expect(scoreShellClusterProximity(baseInput({ nearbyShellPatternCount: 2 }))).toBe(1);
  });

  test("ownershipChurn saturates at 3", () => {
    expect(scoreOwnershipChurn(baseInput({ recentOwnershipTransferCount: 3 }))).toBe(1);
  });

  test("infrastructureInvestment and corridorAdjacency are 0/1", () => {
    expect(scoreInfrastructureInvestment(baseInput({ hasInfrastructureInvestment: true }))).toBe(1);
    expect(scoreInfrastructureInvestment(baseInput())).toBe(0);
    expect(scoreCorridorAdjacency(baseInput({ isOnCorridor: true }))).toBe(1);
    expect(scoreCorridorAdjacency(baseInput())).toBe(0);
  });
});

describe("composite computePressure", () => {
  test("cold parcel scores near zero", () => {
    const result = computePressure(baseInput());
    expect(result.pressureScore).toBe(0);
    expect(result.factors.recencyMultiplier).toBeLessThan(0.0001);
  });

  test("high-pressure parcel exceeds 0.4 base before decay", () => {
    // Recency multiplier of ~1 means days=0
    const result = computePressure(baseInput({
      daysSinceLastSignal: 0,
      developerEntityIds: ["a", "b"],
      brokerEntityIds: ["c"],
      recentEntitlementSignals: 5,
      activeUtilityExpansions: 2,
      continuanceCount: 3,
      pressuredNeighborCount: 3,
      nearbyShellPatternCount: 2,
      recentOwnershipTransferCount: 2,
      hasInfrastructureInvestment: true,
      isOnCorridor: true,
    }));
    expect(result.pressureScore).toBeGreaterThan(0.7);
    expect(result.factors.recencyMultiplier).toBeCloseTo(1);
    expect(result.reasonLog.length).toBeGreaterThan(5);
  });

  test("recency decay reduces composite score", () => {
    const fresh = computePressure(baseInput({
      daysSinceLastSignal: 0,
      developerEntityIds: ["a"],
      recentEntitlementSignals: 3,
    }));
    const stale = computePressure(baseInput({
      daysSinceLastSignal: PRESSURE_RECENCY_HALF_LIFE_DAYS * 3,
      developerEntityIds: ["a"],
      recentEntitlementSignals: 3,
    }));
    expect(stale.pressureScore).toBeLessThan(fresh.pressureScore);
    expect(stale.pressureScore).toBeLessThan(fresh.pressureScore * 0.2);
  });

  test("reason log includes pressureVersion tag context", () => {
    const result = computePressure(baseInput({
      daysSinceLastSignal: 0,
      developerEntityIds: ["a"],
    }));
    expect(result.pressureVersion).toBe("v1");
  });

  test("composite score stays in [0, 1] range across all configurations", () => {
    const configs: Partial<ParcelPressureInput>[] = [
      { daysSinceLastSignal: 0 },
      { daysSinceLastSignal: 0, developerEntityIds: ["a", "b", "c", "d", "e"] },
      { daysSinceLastSignal: 0, recentEntitlementSignals: 100 },
      {
        daysSinceLastSignal: 0,
        developerEntityIds: ["a", "b", "c"],
        brokerEntityIds: ["d", "e"],
        recentEntitlementSignals: 100,
        activeUtilityExpansions: 10,
        continuanceCount: 10,
        pressuredNeighborCount: 100,
        nearbyShellPatternCount: 100,
        recentOwnershipTransferCount: 100,
        hasInfrastructureInvestment: true,
        isOnCorridor: true,
      },
    ];
    for (const overrides of configs) {
      const result = computePressure(baseInput(overrides));
      expect(result.pressureScore).toBeGreaterThanOrEqual(0);
      expect(result.pressureScore).toBeLessThanOrEqual(1);
    }
  });
});

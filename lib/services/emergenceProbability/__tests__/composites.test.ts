// Phase MI-8 — Composite-metric tests (corridor / jurisdiction / developer)
// and expected-timeline tests.

import { describe, expect, test } from "vitest";
import { computeCorridorHeat, classifyCorridorHeat } from "../corridorHeat";
import { computeJurisdictionVelocity, classifyCadence } from "../jurisdictionVelocity";
import { computeDevelopmentMomentum, classifyDeveloperMomentum } from "../developmentMomentum";
import { computeExpectedTimeline } from "../timeline";

describe("computeCorridorHeat", () => {
  test("empty corridor scores 0 and classifies COOLING", () => {
    const r = computeCorridorHeat({
      corridorKey: "corridor:test",
      corridorLabel: "Test",
      members: [],
    });
    expect(r.heatScore).toBe(0);
    expect(r.classification).toBe("COOLING");
  });

  test("hot corridor (high pressure, active members) classifies HOT", () => {
    const r = computeCorridorHeat({
      corridorKey: "corridor:hot",
      corridorLabel: "Hot",
      members: [
        { parcelId: "p1", latestPressureScore: 0.8, pressureScore60dAgo: 0.7, hasRecentEmergenceSignal: true },
        { parcelId: "p2", latestPressureScore: 0.7, pressureScore60dAgo: 0.6, hasRecentEmergenceSignal: true },
        { parcelId: "p3", latestPressureScore: 0.6, pressureScore60dAgo: 0.5, hasRecentEmergenceSignal: true },
      ],
    });
    expect(r.heatScore).toBeGreaterThanOrEqual(0.65);
    expect(r.classification).toBe("HOT");
    expect(r.acceleration).toBeGreaterThan(0);
  });

  test("igniting corridor (high accel, modest pressure)", () => {
    const r = computeCorridorHeat({
      corridorKey: "corridor:ignite",
      corridorLabel: "Ignite",
      members: [
        { parcelId: "p1", latestPressureScore: 0.4, pressureScore60dAgo: 0.05, hasRecentEmergenceSignal: true },
        { parcelId: "p2", latestPressureScore: 0.35, pressureScore60dAgo: 0.1, hasRecentEmergenceSignal: true },
      ],
    });
    expect(r.classification).toBe("IGNITING");
  });

  test("cooling corridor (declining acceleration)", () => {
    expect(classifyCorridorHeat(0.3, -0.2)).toBe("COOLING");
  });

  test("truncates member list past cap", () => {
    const members = Array.from({ length: 250 }, (_, i) => ({
      parcelId: `p${i}`,
      latestPressureScore: 0.5,
      pressureScore60dAgo: 0.5,
      hasRecentEmergenceSignal: false,
    }));
    const r = computeCorridorHeat({ corridorKey: "c", corridorLabel: "X", members });
    expect(r.memberSetTruncated).toBe(true);
    expect(r.memberParcelIds.length).toBe(200);
  });
});

describe("computeJurisdictionVelocity", () => {
  test("hot jurisdiction (high counts) classifies HOT", () => {
    const r = computeJurisdictionVelocity({
      jurisdictionKey: "west des moines",
      jurisdictionLabel: "West Des Moines",
      newProjectsLast30d: 5,
      newProjectsLast90d: 15,
      newProjectsLast365d: 60,
      newSignalsLast30d: 20,
      newSignalsLast90d: 60,
    });
    expect(r.cadenceClass).toBe("HOT");
    expect(r.velocityScore).toBeGreaterThan(0.7);
  });

  test("cold jurisdiction classifies COLD", () => {
    const r = computeJurisdictionVelocity({
      jurisdictionKey: "ghost town",
      jurisdictionLabel: "Ghost Town",
      newProjectsLast30d: 0,
      newProjectsLast90d: 0,
      newProjectsLast365d: 1,
      newSignalsLast30d: 0,
      newSignalsLast90d: 0,
    });
    expect(r.cadenceClass).toBe("COLD");
  });

  test("classifyCadence: COOLING when acceleration sharply negative", () => {
    expect(classifyCadence(0.30, -0.40)).toBe("COOLING");
  });

  test("acceleration uses prior-window when provided", () => {
    const r = computeJurisdictionVelocity({
      jurisdictionKey: "k", jurisdictionLabel: "K",
      newProjectsLast30d: 6,
      newProjectsLast90d: 10,
      newProjectsLast365d: 30,
      newSignalsLast30d: 3,
      newSignalsLast90d: 8,
      newProjectsPriorWindow: 2,
    });
    expect(r.acceleration).toBeGreaterThan(0);
  });
});

describe("computeDevelopmentMomentum", () => {
  test("accelerating developer", () => {
    const r = computeDevelopmentMomentum({
      developerEntityId: "e1",
      developerNameCache: "Hubbell Realty",
      newProjectsLast30d: 4,
      newProjectsLast90d: 8,
      newProjectsLast365d: 20,
      newParcelsLast90d: 6,
      newProjectsPriorWindow: 1,
    });
    expect(r.momentumScore).toBeGreaterThan(0.5);
    expect(r.classification).toBe("ACCELERATING");
    expect(r.acceleration).toBeGreaterThan(0.10);
  });

  test("dormant developer (no projects in 365d) classifies DORMANT", () => {
    const r = computeDevelopmentMomentum({
      developerEntityId: "e1",
      newProjectsLast30d: 0,
      newProjectsLast90d: 0,
      newProjectsLast365d: 0,
      newParcelsLast90d: 0,
    });
    expect(r.classification).toBe("DORMANT");
  });

  test("fading developer", () => {
    expect(classifyDeveloperMomentum(0.05, -0.30, 3)).toBe("FADING");
  });

  test("sustained developer", () => {
    expect(classifyDeveloperMomentum(0.40, 0, 10)).toBe("SUSTAINED");
  });
});

describe("computeExpectedTimeline", () => {
  test("EMERGING project produces all milestones with widening uncertainty", () => {
    const points = computeExpectedTimeline({
      lifecycleState: "EMERGING",
      emergenceScore: 0.4,
      trajectoryState: "EMERGING",
      referenceDate: new Date("2026-05-19T00:00:00Z"),
    });
    expect(points.length).toBe(6);
    for (const p of points) {
      expect(p.earliestEstimate).not.toBeNull();
      expect(p.expectedEstimate).not.toBeNull();
      expect(p.latestEstimate).not.toBeNull();
      // earliest < expected < latest
      expect(p.earliestEstimate!.getTime()).toBeLessThanOrEqual(p.expectedEstimate!.getTime());
      expect(p.expectedEstimate!.getTime()).toBeLessThanOrEqual(p.latestEstimate!.getTime());
    }
  });

  test("higher emergence score pulls expected date in", () => {
    const ref = new Date("2026-05-19T00:00:00Z");
    const cold = computeExpectedTimeline({
      lifecycleState: "EMERGING",
      emergenceScore: 0.1,
      trajectoryState: "EMERGING",
      referenceDate: ref,
    });
    const hot = computeExpectedTimeline({
      lifecycleState: "EMERGING",
      emergenceScore: 0.9,
      trajectoryState: "ACCELERATING",
      referenceDate: ref,
    });
    const coldStart = cold.find((p) => p.milestoneKind === "CONSTRUCTION_START")?.expectedEstimate!;
    const hotStart = hot.find((p) => p.milestoneKind === "CONSTRUCTION_START")?.expectedEstimate!;
    expect(hotStart.getTime()).toBeLessThan(coldStart.getTime());
  });

  test("DORMANT trajectory yields LOW confidence", () => {
    const points = computeExpectedTimeline({
      lifecycleState: "STALLED",
      emergenceScore: 0.05,
      trajectoryState: "DORMANT",
      referenceDate: new Date("2026-05-19T00:00:00Z"),
    });
    expect(points.length).toBeGreaterThan(0);
    expect(points[0].confidence).toBe("LOW");
  });

  test("ACTIVE_CONSTRUCTION emits no entitlement milestones", () => {
    const points = computeExpectedTimeline({
      lifecycleState: "ACTIVE_CONSTRUCTION",
      emergenceScore: 0.8,
      trajectoryState: "STEADY",
      referenceDate: new Date("2026-05-19T00:00:00Z"),
    });
    const kinds = new Set(points.map((p) => p.milestoneKind));
    expect(kinds.has("ENTITLEMENT_DECISION")).toBe(false);
    expect(kinds.has("COMPLETION")).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectBackfill/__tests__/collisions.test.ts
//  Phase MI-6 PR2 — Project-collision detector tests.
//  Pure functions, no Prisma.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import {
  findLikelyDuplicates,
  findOverMergedClusters,
  findWeaklyRelatedSignals,
  findJurisdictionDrift,
  findParcelDivergence,
  detectProjectCollisions,
  type ProjectSnapshot,
  type ProjectParcelSnapshot,
} from "../collisions";

function snap(over: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    id: "p1",
    workingTitle: "Untitled",
    jurisdiction: null,
    reviewStatus: "AUTO_AGGREGATED",
    parcelIds: [],
    developerIds: [],
    signalScores: [],
    signalJurisdictions: [],
    ...over,
  };
}

describe("findLikelyDuplicates", () => {
  test("parcel-overlapping projects flagged", () => {
    const out = findLikelyDuplicates([
      snap({ id: "a", workingTitle: "Walnut Creek 3", parcelIds: ["1234567890"] }),
      snap({ id: "b", workingTitle: "Walnut Crk Plat 3", parcelIds: ["1234567890"] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("likely_duplicate_pair");
    expect(out[0].projectIds).toEqual(["a", "b"]);
  });

  test("developer-overlap + high title similarity flagged", () => {
    const out = findLikelyDuplicates([
      snap({ id: "a", workingTitle: "Hubbell Industrial Phase 1", developerIds: ["h1"] }),
      snap({ id: "b", workingTitle: "Hubbell Industrial Phase 1 ", developerIds: ["h1"] }),
    ]);
    expect(out.length).toBeGreaterThan(0);
  });

  test("developer-overlap with low title similarity NOT flagged (legit phasing)", () => {
    const out = findLikelyDuplicates([
      snap({ id: "a", workingTitle: "Hubbell Tower One", developerIds: ["h1"] }),
      snap({ id: "b", workingTitle: "Casey's Distribution Center", developerIds: ["h1"] }),
    ]);
    expect(out).toHaveLength(0);
  });

  test("REJECTED / MERGED projects skipped", () => {
    const out = findLikelyDuplicates([
      snap({ id: "a", parcelIds: ["1234567890"] }),
      snap({ id: "b", parcelIds: ["1234567890"], reviewStatus: "REJECTED" }),
    ]);
    expect(out).toHaveLength(0);
  });
});

describe("findOverMergedClusters", () => {
  test("flags project with high score spread + ≥6 signals", () => {
    const out = findOverMergedClusters([
      snap({ id: "a", signalScores: [0.95, 0.92, 0.88, 0.85, 0.30, 0.25] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("over_merged_cluster");
  });

  test("does not flag tight cluster", () => {
    const out = findOverMergedClusters([
      snap({ id: "a", signalScores: [0.88, 0.85, 0.86, 0.87, 0.83, 0.81] }),
    ]);
    expect(out).toHaveLength(0);
  });

  test("does not flag below minimum signal count", () => {
    const out = findOverMergedClusters([
      snap({ id: "a", signalScores: [0.95, 0.10] }),
    ]);
    expect(out).toHaveLength(0);
  });
});

describe("findWeaklyRelatedSignals", () => {
  test("flags low-median project", () => {
    const out = findWeaklyRelatedSignals([
      snap({ id: "a", signalScores: [0.30, 0.20, 0.25, 0.10] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("weakly_related_signals");
  });

  test("does not flag project with healthy median", () => {
    const out = findWeaklyRelatedSignals([
      snap({ id: "a", signalScores: [0.85, 0.70, 0.60] }),
    ]);
    expect(out).toHaveLength(0);
  });
});

describe("findJurisdictionDrift", () => {
  test("flags multi-jurisdiction signals", () => {
    const out = findJurisdictionDrift([
      snap({ id: "a", signalJurisdictions: ["Des Moines", "Ankeny", "Bondurant"] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("jurisdiction_drift");
  });

  test("does not flag single-jurisdiction project", () => {
    const out = findJurisdictionDrift([
      snap({ id: "a", signalJurisdictions: ["Des Moines", "Des Moines"] }),
    ]);
    expect(out).toHaveLength(0);
  });

  test("empty jurisdictions ignored", () => {
    const out = findJurisdictionDrift([
      snap({ id: "a", signalJurisdictions: ["", "Des Moines"] }),
    ]);
    expect(out).toHaveLength(0);
  });
});

describe("findParcelDivergence", () => {
  function snap(over: Partial<ProjectParcelSnapshot> = {}): ProjectParcelSnapshot {
    return {
      id: "p1",
      workingTitle: "Untitled",
      reviewStatus: "AUTO_AGGREGATED",
      parcels: [],
      ...over,
    };
  }

  test("flags 4 parcels from same source", () => {
    const out = findParcelDivergence([
      snap({
        parcels: [
          { parcelId: "1", parcelSource: "assessor" },
          { parcelId: "2", parcelSource: "assessor" },
          { parcelId: "3", parcelSource: "assessor" },
          { parcelId: "4", parcelSource: "assessor" },
        ],
      }),
    ]);
    expect(out.length).toBeGreaterThan(0);
  });

  test("does not flag 2 parcels from same source", () => {
    const out = findParcelDivergence([
      snap({
        parcels: [
          { parcelId: "1", parcelSource: "assessor" },
          { parcelId: "2", parcelSource: "assessor" },
        ],
      }),
    ]);
    expect(out).toHaveLength(0);
  });

  test("flags 3 parcels from 2 sources", () => {
    const out = findParcelDivergence([
      snap({
        parcels: [
          { parcelId: "1", parcelSource: "assessor" },
          { parcelId: "2", parcelSource: "manual" },
          { parcelId: "3", parcelSource: "assessor" },
        ],
      }),
    ]);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("detectProjectCollisions composite", () => {
  test("aggregates findings from all detectors", () => {
    const projects: ProjectSnapshot[] = [
      snap({ id: "dup-a", parcelIds: ["1234567890"], workingTitle: "Site A" }),
      snap({ id: "dup-b", parcelIds: ["1234567890"], workingTitle: "Site A " }),
      snap({ id: "drift", signalJurisdictions: ["DSM", "Ankeny", "Bondurant"] }),
    ];
    const findings = detectProjectCollisions({
      projects,
      parcelSnapshots: [
        { id: "dup-a", workingTitle: "Site A", reviewStatus: "AUTO_AGGREGATED", parcels: [] },
        { id: "dup-b", workingTitle: "Site A ", reviewStatus: "AUTO_AGGREGATED", parcels: [] },
        { id: "drift", workingTitle: "Drift", reviewStatus: "AUTO_AGGREGATED", parcels: [] },
      ],
    });
    const kinds = findings.map((f) => f.kind);
    expect(kinds).toContain("likely_duplicate_pair");
    expect(kinds).toContain("jurisdiction_drift");
  });
});

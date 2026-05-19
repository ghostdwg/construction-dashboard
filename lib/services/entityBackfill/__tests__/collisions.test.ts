// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityBackfill/__tests__/collisions.test.ts
//  Phase MI-3 — Collision detection tests.
//
//  Pure-function tests on fixture entity / alias arrays. No Prisma.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import {
  findSharedNormalizedAcrossTypes,
  findVeryClosePairs,
  findAliasLoops,
  findPendingReviewClusters,
  detectCollisions,
} from "../collisions";
import type { EntityRecord, AliasRecord } from "@/lib/services/entityResolver";

function makeEntity(
  id: string,
  canonicalName: string,
  normalizedName: string,
  entityType: string,
  reviewStatus = "VERIFIED"
): EntityRecord {
  return {
    id,
    canonicalName,
    normalizedName,
    entityType,
    reviewStatus,
    confidence: "VERIFIED",
    source: null,
  };
}

function makeAlias(id: string, entityId: string, alias: string, normalizedAlias: string): AliasRecord {
  return { id, entityId, alias, normalizedAlias, confidence: "HIGH" };
}

describe("findSharedNormalizedAcrossTypes", () => {
  test("returns nothing when each normalizedName is unique", () => {
    const result = findSharedNormalizedAcrossTypes([
      makeEntity("e1", "Hubbell", "hubbell", "Developer"),
      makeEntity("e2", "Weitz", "weitz", "GC"),
    ]);
    expect(result).toHaveLength(0);
  });

  test("flags same normalizedName across different entityTypes", () => {
    const result = findSharedNormalizedAcrossTypes([
      makeEntity("e1", "Polk County", "polk", "Municipality"),
      makeEntity("e2", "Polk Inc", "polk", "Developer"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("shared_normalized_form_across_types");
    expect(result[0].entityIds).toEqual(["e1", "e2"]);
  });

  test("ignores REJECTED entities", () => {
    const result = findSharedNormalizedAcrossTypes([
      makeEntity("e1", "Polk County", "polk", "Municipality"),
      makeEntity("e2", "Polk Inc", "polk", "Developer", "REJECTED"),
    ]);
    expect(result).toHaveLength(0);
  });
});

describe("findVeryClosePairs", () => {
  test("flags two very-similar canonical names of the same type (test threshold 0.85)", () => {
    const result = findVeryClosePairs(
      [
        makeEntity("e1", "Hubbell Realty", "hubbellrealty", "Developer"),
        makeEntity("e2", "Hubbell Realtee", "hubbellrealtee", "Developer"),
      ],
      0.85
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].kind).toBe("very_close_canonical_pair");
  });

  test("does not flag near-duplicates of different types (low cross-type risk)", () => {
    const result = findVeryClosePairs(
      [
        makeEntity("e1", "Hubbell", "hubbell", "Developer"),
        makeEntity("e2", "Hubbel", "hubbel", "GC"),
      ],
      0.85
    );
    expect(result).toHaveLength(0);
  });

  test("respects production-strict 0.92 default threshold", () => {
    // The 0.88-ish pair above is BELOW the default 0.92 threshold, so
    // the operator-facing report wouldn't flag it unless the resolver
    // version changed and a re-scan called this function explicitly.
    const result = findVeryClosePairs([
      makeEntity("e1", "Hubbell Realty", "hubbellrealty", "Developer"),
      makeEntity("e2", "Hubbell Realtee", "hubbellrealtee", "Developer"),
    ]);
    expect(result).toHaveLength(0);
  });
});

describe("findAliasLoops", () => {
  test("returns nothing when no alias matches another entity's canonical", () => {
    const result = findAliasLoops(
      [
        makeEntity("e1", "Hubbell Realty Company", "hubbell", "Developer"),
        makeEntity("e2", "Weitz Company", "weitz", "GC"),
      ],
      [makeAlias("a1", "e1", "Hubbell Holdings", "hubbellholdings")]
    );
    expect(result).toHaveLength(0);
  });

  test("flags alias whose normalizedAlias matches another entity's canonical", () => {
    const result = findAliasLoops(
      [
        makeEntity("e1", "Hubbell Realty Company", "hubbell", "Developer"),
        makeEntity("e2", "Hubbell Construction Group", "hubbellconstruction", "GC"),
      ],
      [makeAlias("a1", "e1", "Hubbell Construction", "hubbellconstruction")]
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].kind).toBe("alias_loop");
    expect(result[0].entityIds).toContain("e1");
    expect(result[0].entityIds).toContain("e2");
  });
});

describe("findPendingReviewClusters", () => {
  test("returns nothing when cluster size below threshold", () => {
    const pending = Array.from({ length: 3 }, (_, i) =>
      makeEntity(`e${i}`, `Hubbell V${i}`, `hubbellv${i}`, "Developer", "PENDING_REVIEW")
    );
    const result = findPendingReviewClusters(pending, 5);
    expect(result).toHaveLength(0);
  });

  test("flags a cluster of ≥ N similar PENDING_REVIEW entities", () => {
    const pending = [
      makeEntity("e1", "Hubbell Realty V1", "hubbellrealtyv1", "Developer", "PENDING_REVIEW"),
      makeEntity("e2", "Hubbell Realty V2", "hubbellrealtyv2", "Developer", "PENDING_REVIEW"),
      makeEntity("e3", "Hubbell Realty V3", "hubbellrealtyv3", "Developer", "PENDING_REVIEW"),
      makeEntity("e4", "Hubbell Realty V4", "hubbellrealtyv4", "Developer", "PENDING_REVIEW"),
      makeEntity("e5", "Hubbell Realty V5", "hubbellrealtyv5", "Developer", "PENDING_REVIEW"),
    ];
    const result = findPendingReviewClusters(pending, 5, 0.75);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].kind).toBe("pending_review_cluster");
    expect(result[0].entityIds.length).toBeGreaterThanOrEqual(5);
  });
});

describe("detectCollisions — composite", () => {
  test("aggregates output of all detectors that fire", () => {
    const entities = [
      // shared normalized form across types — fires findSharedNormalizedAcrossTypes
      makeEntity("e1", "Polk County", "polk", "Municipality"),
      makeEntity("e2", "Polk Inc", "polk", "Developer"),
      // alias loop — fires findAliasLoops
      makeEntity("e3", "Hubbell Realty Company", "hubbell", "Developer"),
      makeEntity("e4", "Hubbell Construction Group", "hubbellconstruction", "GC"),
    ];
    const aliases: AliasRecord[] = [
      makeAlias("a1", "e3", "Hubbell Construction", "hubbellconstruction"),
    ];
    const result = detectCollisions(entities, aliases);
    const kinds = result.map((c) => c.kind);
    expect(kinds).toContain("shared_normalized_form_across_types");
    expect(kinds).toContain("alias_loop");
  });
});

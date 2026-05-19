// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectAggregation/__tests__/heuristics.test.ts
//  Phase MI-6 — Per-factor heuristic tests. Pure functions, no Prisma.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import {
  scoreParcelMatch,
  scoreDeveloperMatch,
  scoreEngineerMatch,
  scoreBrokerMatch,
  scoreJurisdictionMatch,
  scoreZoningContinuity,
  scoreUtilityExtension,
  scoreTemporalProximity,
  scoreTitleSimilarity,
  scoreAgendaContinuity,
  scoreContinuanceCount,
  scoreShellBuildingPattern,
} from "../heuristics";
import type { ProjectContext, SignalInput } from "../types";

function signal(over: Partial<SignalInput> = {}): SignalInput {
  return {
    kind: "MARKET_SIGNAL",
    sourceId: "sig1",
    title: null,
    occurredAt: new Date("2026-05-01"),
    jurisdiction: null,
    parcelIds: [],
    entityIds: [],
    address: null,
    tags: [],
    ...over,
  };
}

function project(over: Partial<ProjectContext> = {}): ProjectContext {
  return {
    id: "p1",
    workingTitle: "test project",
    jurisdiction: null,
    lifecycleState: "EMERGING",
    firstSignalAt: null,
    lastSignalAt: null,
    parcelIds: [],
    entityIdsByRole: {
      DEVELOPER: [], OWNER: [], GC: [], ARCHITECT: [], ENGINEER: [],
      BROKER: [], TENANT: [], LENDER: [], MUNICIPALITY: [], AGENCY: [], OTHER: [],
    },
    recentTags: [],
    continuanceCount: 0,
    hasShellBuildingPattern: false,
    ...over,
  };
}

describe("scoreParcelMatch", () => {
  test("matching parcel returns 1", () => {
    const r = scoreParcelMatch(
      signal({ parcelIds: ["12345"] }),
      project({ parcelIds: ["12345"] })
    );
    expect(r).toBe(1);
  });
  test("disjoint parcels return 0", () => {
    expect(
      scoreParcelMatch(signal({ parcelIds: ["A"] }), project({ parcelIds: ["B"] }))
    ).toBe(0);
  });
  test("either side empty returns 0", () => {
    expect(scoreParcelMatch(signal(), project({ parcelIds: ["A"] }))).toBe(0);
    expect(scoreParcelMatch(signal({ parcelIds: ["A"] }), project())).toBe(0);
  });
});

describe("scoreDeveloperMatch", () => {
  test("matching developer returns 1", () => {
    const r = scoreDeveloperMatch(
      signal({ entityIds: [{ entityId: "e1", role: "DEVELOPER" }] }),
      project({ entityIdsByRole: { ...project().entityIdsByRole, DEVELOPER: ["e1"] } })
    );
    expect(r).toBe(1);
  });
  test("matching owner counts as 0.85", () => {
    const r = scoreDeveloperMatch(
      signal({ entityIds: [{ entityId: "e1", role: "OWNER" }] }),
      project({ entityIdsByRole: { ...project().entityIdsByRole, OWNER: ["e1"] } })
    );
    expect(r).toBe(0.85);
  });
});

describe("scoreEngineerMatch / scoreBrokerMatch", () => {
  test("matching engineer returns 1", () => {
    expect(
      scoreEngineerMatch(
        signal({ entityIds: [{ entityId: "snyder", role: "ENGINEER" }] }),
        project({
          entityIdsByRole: { ...project().entityIdsByRole, ENGINEER: ["snyder"] },
        })
      )
    ).toBe(1);
  });
  test("non-matching broker returns 0", () => {
    expect(
      scoreBrokerMatch(
        signal({ entityIds: [{ entityId: "b1", role: "BROKER" }] }),
        project({ entityIdsByRole: { ...project().entityIdsByRole, BROKER: ["b2"] } })
      )
    ).toBe(0);
  });
});

describe("scoreJurisdictionMatch", () => {
  test("exact match returns 1", () => {
    expect(
      scoreJurisdictionMatch(
        signal({ jurisdiction: "Des Moines" }),
        project({ jurisdiction: "Des Moines" })
      )
    ).toBe(1);
  });
  test("case + whitespace tolerant", () => {
    expect(
      scoreJurisdictionMatch(
        signal({ jurisdiction: "  des moines " }),
        project({ jurisdiction: "Des Moines" })
      )
    ).toBe(1);
  });
  test("different jurisdictions return 0", () => {
    expect(
      scoreJurisdictionMatch(
        signal({ jurisdiction: "Ankeny" }),
        project({ jurisdiction: "Des Moines" })
      )
    ).toBe(0);
  });
});

describe("scoreZoningContinuity", () => {
  test("matching zoning tag scores 1", () => {
    const r = scoreZoningContinuity(
      signal({ tags: ["rezoning", "industrial"] }),
      project({ recentTags: ["rezoning"] })
    );
    expect(r).toBe(1);
  });
  test("both have zoning context but different designations scores 0.4", () => {
    const r = scoreZoningContinuity(
      signal({ tags: ["pud"] }),
      project({ recentTags: ["m-1"] })
    );
    expect(r).toBe(0.4);
  });
  test("signal has no zoning tag → 0", () => {
    expect(
      scoreZoningContinuity(signal({ tags: ["press release"] }), project({ recentTags: ["pud"] }))
    ).toBe(0);
  });
});

describe("scoreUtilityExtension", () => {
  test("utility tag + project history scores 1", () => {
    const r = scoreUtilityExtension(
      signal({ tags: ["water main"] }),
      project({ recentTags: ["sewer main"] })
    );
    expect(r).toBe(1);
  });
  test("utility tag with no project history scores 0.7", () => {
    expect(
      scoreUtilityExtension(signal({ tags: ["lift station"] }), project())
    ).toBe(0.7);
  });
  test("no utility tag scores 0", () => {
    expect(scoreUtilityExtension(signal(), project())).toBe(0);
  });
});

describe("scoreTemporalProximity", () => {
  test("same day scores 1", () => {
    const d = new Date("2026-05-01");
    expect(
      scoreTemporalProximity(signal({ occurredAt: d }), project({ lastSignalAt: d }))
    ).toBe(1);
  });
  test("60 days apart (half-life) scores ~0.5", () => {
    const r = scoreTemporalProximity(
      signal({ occurredAt: new Date("2026-05-01") }),
      project({ lastSignalAt: new Date("2026-03-02") })
    );
    expect(r).toBeGreaterThan(0.45);
    expect(r).toBeLessThan(0.55);
  });
  test("no project reference returns 0", () => {
    expect(
      scoreTemporalProximity(signal({ occurredAt: new Date() }), project())
    ).toBe(0);
  });
});

describe("scoreTitleSimilarity", () => {
  test("identical titles score high", () => {
    expect(
      scoreTitleSimilarity(
        signal({ title: "Walnut Creek Plat 3" }),
        project({ workingTitle: "Walnut Creek Plat 3" })
      )
    ).toBe(1);
  });
  test("very different titles score low", () => {
    expect(
      scoreTitleSimilarity(
        signal({ title: "Casey's expansion" }),
        project({ workingTitle: "Walnut Creek Plat 3" })
      )
    ).toBeLessThan(0.3);
  });
});

describe("scoreAgendaContinuity", () => {
  test("continued + same jurisdiction → 1", () => {
    expect(
      scoreAgendaContinuity(
        signal({ tags: ["continued"], jurisdiction: "Des Moines" }),
        project({ jurisdiction: "Des Moines" })
      )
    ).toBe(1);
  });
  test("continued + different jurisdiction → 0.5", () => {
    expect(
      scoreAgendaContinuity(
        signal({ tags: ["continued"], jurisdiction: "Ankeny" }),
        project({ jurisdiction: "Des Moines" })
      )
    ).toBe(0.5);
  });
});

describe("scoreContinuanceCount", () => {
  test("≥3 continuances → 1", () => {
    expect(scoreContinuanceCount(signal(), project({ continuanceCount: 3 }))).toBe(1);
    expect(scoreContinuanceCount(signal(), project({ continuanceCount: 5 }))).toBe(1);
  });
  test("2 continuances → 0.7", () => {
    expect(scoreContinuanceCount(signal(), project({ continuanceCount: 2 }))).toBe(0.7);
  });
  test("0 continuances → 0", () => {
    expect(scoreContinuanceCount(signal(), project({ continuanceCount: 0 }))).toBe(0);
  });
});

describe("scoreShellBuildingPattern", () => {
  test("project has pattern + signal has shell tag → 1", () => {
    expect(
      scoreShellBuildingPattern(
        signal({ tags: ["distribution"] }),
        project({ hasShellBuildingPattern: true })
      )
    ).toBe(1);
  });
  test("project has pattern + industrial tag → 0.6", () => {
    expect(
      scoreShellBuildingPattern(
        signal({ tags: ["m-1"] }),
        project({ hasShellBuildingPattern: true })
      )
    ).toBe(0.6);
  });
  test("project doesn't have pattern → 0", () => {
    expect(
      scoreShellBuildingPattern(
        signal({ tags: ["distribution"] }),
        project({ hasShellBuildingPattern: false })
      )
    ).toBe(0);
  });
});

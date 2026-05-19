// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectAggregation/__tests__/similarity.test.ts
//  Phase MI-6 — Composite similarity + detection-decision tests. Pure
//  functions, no Prisma.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import { scoreProjectSimilarity, scoreAgainstCandidates } from "../similarity";
import { detectProjectContinuation } from "../aggregator";
import type { ProjectContext, SignalInput } from "../types";

function emptyRoles() {
  return {
    DEVELOPER: [], OWNER: [], GC: [], ARCHITECT: [], ENGINEER: [],
    BROKER: [], TENANT: [], LENDER: [], MUNICIPALITY: [], AGENCY: [], OTHER: [],
  };
}

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
    workingTitle: "p1 title",
    jurisdiction: null,
    lifecycleState: "EMERGING",
    firstSignalAt: null,
    lastSignalAt: null,
    parcelIds: [],
    entityIdsByRole: emptyRoles(),
    recentTags: [],
    continuanceCount: 0,
    hasShellBuildingPattern: false,
    ...over,
  };
}

describe("scoreProjectSimilarity", () => {
  test("zero-overlap signal + project returns 0", () => {
    const r = scoreProjectSimilarity(signal(), project());
    expect(r.score).toBe(0);
    expect(r.reasonLog).toEqual([]);
  });

  test("matching parcel + matching developer scores high (≥ 0.4)", () => {
    const r = scoreProjectSimilarity(
      signal({
        parcelIds: ["12345"],
        entityIds: [{ entityId: "hubbell", role: "DEVELOPER" }],
        jurisdiction: "Des Moines",
        occurredAt: new Date("2026-05-01"),
      }),
      project({
        parcelIds: ["12345"],
        jurisdiction: "Des Moines",
        entityIdsByRole: { ...emptyRoles(), DEVELOPER: ["hubbell"] },
        lastSignalAt: new Date("2026-05-01"),
      })
    );
    expect(r.score).toBeGreaterThan(0.4);
    expect(r.reasonLog.some((l) => l.includes("parcelMatch"))).toBe(true);
    expect(r.reasonLog.some((l) => l.includes("developerMatch"))).toBe(true);
  });

  test("fully matching signal + project hits high attach threshold", () => {
    const fullMatchSignal = signal({
      parcelIds: ["12345"],
      entityIds: [
        { entityId: "hubbell", role: "DEVELOPER" },
        { entityId: "snyder", role: "ENGINEER" },
      ],
      jurisdiction: "Des Moines",
      occurredAt: new Date("2026-05-01"),
      title: "Walnut Creek Plat 3",
      tags: ["rezoning", "continued"],
    });
    const fullMatchProject = project({
      parcelIds: ["12345"],
      jurisdiction: "Des Moines",
      entityIdsByRole: {
        ...emptyRoles(),
        DEVELOPER: ["hubbell"],
        ENGINEER: ["snyder"],
      },
      workingTitle: "Walnut Creek Plat 3",
      recentTags: ["rezoning"],
      lastSignalAt: new Date("2026-05-01"),
      continuanceCount: 2,
    });
    const r = scoreProjectSimilarity(fullMatchSignal, fullMatchProject);
    expect(r.score).toBeGreaterThan(0.5);
  });
});

describe("scoreAgainstCandidates ordering", () => {
  test("returns candidates sorted descending by score", () => {
    const ranked = scoreAgainstCandidates(
      signal({ parcelIds: ["A"], jurisdiction: "X" }),
      [
        project({ id: "no-match", jurisdiction: "Y", parcelIds: ["B"] }),
        project({ id: "parcel-match", jurisdiction: "Z", parcelIds: ["A"] }),
        project({ id: "jurisdiction-match", jurisdiction: "X", parcelIds: ["C"] }),
      ]
    );
    expect(ranked[0].candidateProjectId).toBe("parcel-match");
    // Composite at scoreParcelMatch=1 weighted 5 vs jurisdictionMatch=1 weighted 2:
    // parcel-match composite > jurisdiction-match composite > no-match
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});

describe("detectProjectContinuation decision logic", () => {
  test("empty candidate pool → create_new", () => {
    const decision = detectProjectContinuation({ signal: signal(), candidates: [] });
    expect(decision.kind).toBe("create_new");
  });

  test("no candidate clears review threshold → create_new", () => {
    const decision = detectProjectContinuation({
      signal: signal({ jurisdiction: "X" }),
      candidates: [
        project({ id: "p1", parcelIds: ["B"], jurisdiction: "Y" }),
      ],
    });
    expect(decision.kind).toBe("create_new");
  });

  test("strong-match candidate → attach_to_existing", () => {
    const decision = detectProjectContinuation({
      signal: signal({
        parcelIds: ["12345"],
        entityIds: [{ entityId: "h", role: "DEVELOPER" }],
        jurisdiction: "DSM",
        occurredAt: new Date("2026-05-01"),
        tags: ["continued"],
      }),
      candidates: [
        project({
          id: "strong",
          parcelIds: ["12345"],
          jurisdiction: "DSM",
          entityIdsByRole: { ...emptyRoles(), DEVELOPER: ["h"] },
          lastSignalAt: new Date("2026-05-01"),
          continuanceCount: 3,
        }),
      ],
      thresholdsOverride: { attachAuto: 0.5, review: 0.3 },
    });
    expect(decision.kind).toBe("attach_to_existing");
    if (decision.kind === "attach_to_existing") {
      expect(decision.project.candidateProjectId).toBe("strong");
    }
  });

  test("middling-match candidate → needs_review", () => {
    const decision = detectProjectContinuation({
      signal: signal({ jurisdiction: "DSM", parcelIds: ["X"] }),
      candidates: [
        project({ id: "mid", jurisdiction: "DSM", parcelIds: ["Y"] }),
      ],
      thresholdsOverride: { attachAuto: 0.5, review: 0.05 },
    });
    expect(decision.kind).toBe("needs_review");
  });
});

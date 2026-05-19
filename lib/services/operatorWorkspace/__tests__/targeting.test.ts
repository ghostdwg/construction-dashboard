// Phase MI-10 — Targeting pattern evaluator tests.

import { describe, expect, test } from "vitest";
import {
  evalDeveloperEntersCorridor,
  evalRecurringGcDeveloper,
  evalFranchiseRollout,
} from "../targeting";

describe("evalDeveloperEntersCorridor", () => {
  test("matches when new developer parcels overlap a corridor", () => {
    const matches = evalDeveloperEntersCorridor({
      developerEntityId: "dev1",
      corridorMembersByCorridor: {
        "corridor:a": ["p1", "p2", "p3"],
        "corridor:b": ["p9", "p10"],
      },
      developerNewParcelsLast90d: ["p2", "p11"],
    });
    expect(matches.length).toBe(1);
    expect(matches[0].factors.corridorKey).toBe("corridor:a");
    expect(matches[0].factors.hitCount).toBe(1);
  });

  test("returns empty when no overlap", () => {
    const matches = evalDeveloperEntersCorridor({
      developerEntityId: "dev1",
      corridorMembersByCorridor: { "corridor:a": ["p1"] },
      developerNewParcelsLast90d: ["p9"],
    });
    expect(matches.length).toBe(0);
  });
});

describe("evalRecurringGcDeveloper", () => {
  test("matches pairs meeting minProjects", () => {
    const matches = evalRecurringGcDeveloper({
      pairCounts: {
        "gc1|dev1": { gcEntityId: "gc1", developerEntityId: "dev1", projectCount: 5 },
        "gc2|dev2": { gcEntityId: "gc2", developerEntityId: "dev2", projectCount: 2 },
      },
      minProjects: 3,
    });
    expect(matches.length).toBe(1);
    expect(matches[0].subjectId).toBe("dev1");
  });
});

describe("evalFranchiseRollout", () => {
  test("matches brands above jurisdiction floor", () => {
    const matches = evalFranchiseRollout({
      brandActivityByJurisdiction: {
        "Brand A": [
          { jurisdictionKey: "city a", projectCount: 2 },
          { jurisdictionKey: "city b", projectCount: 1 },
          { jurisdictionKey: "city c", projectCount: 3 },
        ],
        "Brand B": [
          { jurisdictionKey: "city d", projectCount: 1 },
        ],
      },
      minJurisdictions: 3,
    });
    expect(matches.length).toBe(1);
    expect(matches[0].subjectId).toBe("Brand A");
    expect(matches[0].factors.jurisdictionCount).toBe(3);
    expect(matches[0].factors.totalProjects).toBe(6);
  });

  test("excludes brands with insufficient jurisdiction count", () => {
    const matches = evalFranchiseRollout({
      brandActivityByJurisdiction: {
        "Brand A": [{ jurisdictionKey: "city a", projectCount: 10 }],
      },
      minJurisdictions: 2,
    });
    expect(matches.length).toBe(0);
  });

  test("counts only active jurisdictions (projectCount > 0)", () => {
    const matches = evalFranchiseRollout({
      brandActivityByJurisdiction: {
        "Brand A": [
          { jurisdictionKey: "city a", projectCount: 5 },
          { jurisdictionKey: "city b", projectCount: 0 },
          { jurisdictionKey: "city c", projectCount: 3 },
        ],
      },
      minJurisdictions: 3,
    });
    expect(matches.length).toBe(0); // only 2 active jurisdictions
  });
});

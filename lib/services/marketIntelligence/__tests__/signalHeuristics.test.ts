// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/__tests__/signalHeuristics.test.ts
//  Phase O2.2 PR2 — Heuristic classifier tests.
//
//  Determinism: every assertion is on exact values (no fuzz, no tolerance).
//  Same input → same output is guaranteed by the module's pure-function design.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import {
  classifySignal,
  tokenSetSimilarity,
  HEURISTICS_VERSION,
  __internals,
  type HeuristicInput,
} from "../signalHeuristics";

function inputOf(partial: Partial<HeuristicInput>): HeuristicInput {
  return {
    headline: partial.headline ?? "Untitled",
    signalType: partial.signalType ?? "MEETING_MINUTE",
    signalSubtype: partial.signalSubtype ?? null,
    rawText: partial.rawText ?? null,
    metadata: partial.metadata ?? null,
    documentDate: partial.documentDate ?? null,
    jurisdiction: partial.jurisdiction ?? null,
    docPacketHash: partial.docPacketHash ?? null,
    context: partial.context,
  };
}

describe("classifySignal — version + result shape", () => {
  test("result includes HEURISTICS_VERSION constant (bumped to v2 in PR6)", () => {
    const r = classifySignal(inputOf({ headline: "Site plan for new warehouse" }));
    expect(r.heuristicsVersion).toBe(HEURISTICS_VERSION);
    expect(r.heuristicsVersion).toBe("v2");
  });

  test("score is clamped to [0, 1] and shouldDrop mirrors SUPPRESSED classification", () => {
    const r = classifySignal(inputOf({ headline: "Roll Call" }));
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.classification).toBe("SUPPRESSED");
    expect(r.shouldDrop).toBe(true);
  });

  test("baseline neutral signal lands in LOW_EMERGENCE", () => {
    // No subtype, no keywords, no recurrence → just base score.
    const r = classifySignal(inputOf({ headline: "Item 14: discussion regarding parking lot striping" }));
    expect(r.score).toBe(__internals.BASE_SCORE);
    expect(r.classification).toBe("LOW_EMERGENCE");
    expect(r.factors).toHaveLength(0);
  });
});

describe("ceremonial suppression", () => {
  const cases: Array<[string, string]> = [
    ["Roll Call",                                  "ROLL_CALL"],
    ["Approval of the Agenda",                     "AGENDA_APPROVAL"],
    ["Approval of Minutes from April 14",          "MINUTES_APPROVAL"],
    ["Consent Agenda Items 5A–5G",                 "CONSENT_BOILERPLATE"],
    ["Invocation by Pastor Smith",                 "CEREMONIAL_PATTERN"],
    ["Pledge of Allegiance",                       "CEREMONIAL_PATTERN"],
    ["Adjournment",                                "CEREMONIAL_PATTERN"],
    ["Public Notice of Hearing on May 21",         "ADMINISTRATIVE_NOTICE"],
  ];
  for (const [headline, expectedKind] of cases) {
    test(`"${headline}" → SUPPRESSED with factor ${expectedKind}`, () => {
      const r = classifySignal(inputOf({ headline }));
      expect(r.classification).toBe("SUPPRESSED");
      expect(r.shouldDrop).toBe(true);
      expect(r.factors.map((f) => f.kind)).toContain(expectedKind);
    });
  }

  test("hard-drop rule: a single -0.60 suppression forces SUPPRESSED regardless of stacked boosts", () => {
    const r = classifySignal(inputOf({
      headline: "Roll Call",
      signalSubtype: "ANNEXATION", // boost +0.30
      rawText: "sewer expansion and corridor study and warehouse distribution", // multiple boosts
    }));
    expect(r.classification).toBe("SUPPRESSED");
    expect(r.shouldDrop).toBe(true);
    // Even with the stacked boosts, the ROLL_CALL hard-drop wins.
    expect(r.factors.map((f) => f.kind)).toContain("ROLL_CALL");
  });
});

describe("subtype-driven boosts", () => {
  const subtypeCases: Array<[string, string]> = [
    ["ANNEXATION",          "ANNEXATION"],
    ["REZONING",            "REZONING"],
    ["PLAT",                "PLAT"],
    ["SITE_PLAN",           "SITE_PLAN"],
    ["COMPREHENSIVE_PLAN",  "COMPREHENSIVE_PLAN"],
    ["TIF",                 "TIF"],
    ["BOND",                "BOND"],
    ["UTILITY_EXPANSION",   "UTILITY_EXPANSION"],
    ["CORRIDOR_STUDY",      "CORRIDOR_STUDY"],
    ["INFRASTRUCTURE_PLAN", "INFRASTRUCTURE_PLAN"],
  ];
  for (const [subtype, expectedKind] of subtypeCases) {
    test(`subtype ${subtype} → factor ${expectedKind}`, () => {
      const r = classifySignal(inputOf({
        headline: "Generic substantive item",
        signalSubtype: subtype,
      }));
      expect(r.factors.map((f) => f.kind)).toContain(expectedKind);
      expect(r.score).toBeGreaterThan(__internals.BASE_SCORE);
    });
  }

  test("annexation subtype on a non-ceremonial headline classifies as MEDIUM or HIGH", () => {
    const r = classifySignal(inputOf({
      headline: "Annexation petition for 200 acres east of Highway 65",
      signalSubtype: "ANNEXATION",
    }));
    expect(["MEDIUM_EMERGENCE", "HIGH_EMERGENCE"]).toContain(r.classification);
    const ann = r.factors.find((f) => f.kind === "ANNEXATION");
    expect(ann).toBeDefined();
    expect(ann!.bucket).toBe("BOOST");
    expect(ann!.weight).toBeGreaterThan(0);
  });
});

describe("keyword-driven boosts", () => {
  test("utility-expansion keyword in headline (without UTILITY_EXPANSION subtype) still fires UTILITY_EXPANSION", () => {
    const r = classifySignal(inputOf({
      headline: "Sewer expansion to the Northgate Industrial Park",
      signalSubtype: "OTHER",
    }));
    const util = r.factors.find((f) => f.kind === "UTILITY_EXPANSION");
    expect(util).toBeDefined();
    expect(util!.weight).toBe(__internals.FACTOR_WEIGHTS.UTILITY_EXPANSION);
  });

  test("corridor-study keyword fires CORRIDOR_STUDY", () => {
    const r = classifySignal(inputOf({
      headline: "Adoption of the Northwest Growth Corridor Study",
    }));
    expect(r.factors.map((f) => f.kind)).toContain("CORRIDOR_STUDY");
  });

  test("logistics keyword in raw text fires LOGISTICS_HINT", () => {
    const r = classifySignal(inputOf({
      headline: "Site plan approval",
      rawText: "Proposed 450,000 sf distribution center with rail spur access",
    }));
    expect(r.factors.map((f) => f.kind)).toContain("LOGISTICS_HINT");
  });

  test("rezoning + industrial keyword fires INDUSTRIAL_REZONING (in addition to REZONING)", () => {
    const r = classifySignal(inputOf({
      headline: "Rezoning request from C-1 to I-2 for warehouse use",
      signalSubtype: "REZONING",
    }));
    const kinds = r.factors.map((f) => f.kind);
    expect(kinds).toContain("REZONING");
    expect(kinds).toContain("INDUSTRIAL_REZONING");
  });

  test("annexation keyword in raw text without ANNEXATION subtype still fires ANNEXATION", () => {
    const r = classifySignal(inputOf({
      headline: "Comprehensive plan amendment",
      signalSubtype: "COMPREHENSIVE_PLAN",
      rawText: "Includes annexation of 80 acres south of the highway",
    }));
    expect(r.factors.map((f) => f.kind)).toContain("ANNEXATION");
  });
});

describe("HIGH_VALUE detector", () => {
  test("estimated_value above threshold fires HIGH_VALUE", () => {
    const r = classifySignal(inputOf({
      headline: "Site plan for new headquarters",
      signalSubtype: "SITE_PLAN",
      metadata: { estimated_value: 25_000_000 },
    }));
    expect(r.factors.map((f) => f.kind)).toContain("HIGH_VALUE");
  });

  test("estimated_value below threshold does not fire HIGH_VALUE", () => {
    const r = classifySignal(inputOf({
      headline: "Site plan for small retail strip",
      signalSubtype: "SITE_PLAN",
      metadata: { estimated_value: 250_000 },
    }));
    expect(r.factors.map((f) => f.kind)).not.toContain("HIGH_VALUE");
  });
});

describe("RECURRING_DEVELOPER detector", () => {
  test("actor name (normalized) present in recentDeveloperNames fires RECURRING_DEVELOPER", () => {
    const recent = new Set<string>(["hubbellrealty"]); // pre-normalized
    const r = classifySignal(inputOf({
      headline: "Plat approval for Walnut Creek Plat 9",
      signalSubtype: "PLAT",
      metadata: { owner_name: "Hubbell Realty Company" },
      context: { recentDeveloperNames: recent },
    }));
    expect(r.factors.map((f) => f.kind)).toContain("RECURRING_DEVELOPER");
  });

  test("no prior actor → no RECURRING_DEVELOPER factor", () => {
    const r = classifySignal(inputOf({
      headline: "Plat approval for Walnut Creek Plat 9",
      signalSubtype: "PLAT",
      metadata: { owner_name: "Brand New LLC" },
      context: { recentDeveloperNames: new Set(["someoneelse"]) },
    }));
    expect(r.factors.map((f) => f.kind)).not.toContain("RECURRING_DEVELOPER");
  });

  test("name normalization strips LLC/Inc/Corp suffix so 'Acme LLC' matches normalized 'acme'", () => {
    const r = classifySignal(inputOf({
      headline: "Annexation petition",
      signalSubtype: "ANNEXATION",
      metadata: { developer_name: "Acme LLC" },
      context: { recentDeveloperNames: new Set(["acme"]) },
    }));
    expect(r.factors.map((f) => f.kind)).toContain("RECURRING_DEVELOPER");
  });
});

describe("RECURRING_PARCEL detector", () => {
  test("parcel_id in recentParcels fires RECURRING_PARCEL", () => {
    const r = classifySignal(inputOf({
      headline: "Site plan revision",
      signalSubtype: "SITE_PLAN",
      metadata: { parcel_id: "0903-12-345-001" },
      context: { recentParcels: new Set(["0903-12-345-001"]) },
    }));
    expect(r.factors.map((f) => f.kind)).toContain("RECURRING_PARCEL");
  });
});

describe("RECURRING_JURISDICTION detector", () => {
  test("jurisdiction count above threshold fires RECURRING_JURISDICTION", () => {
    const counts = new Map<string, number>([["Ankeny", 7]]);
    const r = classifySignal(inputOf({
      headline: "Generic site plan",
      signalSubtype: "SITE_PLAN",
      jurisdiction: "Ankeny",
      context: { recentJurisdictions: counts },
    }));
    expect(r.factors.map((f) => f.kind)).toContain("RECURRING_JURISDICTION");
  });

  test("jurisdiction count below threshold does not fire", () => {
    const counts = new Map<string, number>([["Ankeny", 2]]);
    const r = classifySignal(inputOf({
      headline: "Generic site plan",
      signalSubtype: "SITE_PLAN",
      jurisdiction: "Ankeny",
      context: { recentJurisdictions: counts },
    }));
    expect(r.factors.map((f) => f.kind)).not.toContain("RECURRING_JURISDICTION");
  });
});

describe("MULTI_MEETING_APPEARANCE detector", () => {
  test("project key seen in >= 3 distinct meetings fires MULTI_MEETING_APPEARANCE", () => {
    const counts = new Map<string, number>([["parcel:0903-12-345-001", 4]]);
    const r = classifySignal(inputOf({
      headline: "Continued discussion of plat",
      signalSubtype: "PLAT",
      metadata: { parcel_id: "0903-12-345-001" },
      context: { projectKeyMeetingCounts: counts },
    }));
    expect(r.factors.map((f) => f.kind)).toContain("MULTI_MEETING_APPEARANCE");
  });

  test("fewer than 3 meetings does not fire", () => {
    const counts = new Map<string, number>([["parcel:X", 2]]);
    const r = classifySignal(inputOf({
      headline: "Plat discussion",
      signalSubtype: "PLAT",
      metadata: { parcel_id: "X" },
      context: { projectKeyMeetingCounts: counts },
    }));
    expect(r.factors.map((f) => f.kind)).not.toContain("MULTI_MEETING_APPEARANCE");
  });
});

describe("DUPLICATE_CONTINUANCE detector", () => {
  test("identical headline among recentHeadlines fires DUPLICATE_CONTINUANCE", () => {
    const r = classifySignal(inputOf({
      headline: "Variance request for setback at 1234 Oak St",
      signalSubtype: "VARIANCE",
      context: { recentHeadlines: ["Variance request for setback at 1234 Oak St"] },
    }));
    expect(r.factors.map((f) => f.kind)).toContain("DUPLICATE_CONTINUANCE");
  });

  test("near-identical headline (≥ 0.80 Jaccard) fires DUPLICATE_CONTINUANCE", () => {
    const prior = "Variance request for setback at 1234 Oak Street";
    const current = "Variance request for setback at 1234 Oak Street (continued)";
    expect(tokenSetSimilarity(current, prior)).toBeGreaterThanOrEqual(__internals.CONTINUANCE_SIMILARITY_THRESHOLD);
    const r = classifySignal(inputOf({
      headline: current,
      signalSubtype: "VARIANCE",
      context: { recentHeadlines: [prior] },
    }));
    expect(r.factors.map((f) => f.kind)).toContain("DUPLICATE_CONTINUANCE");
  });

  test("dissimilar headline does not fire DUPLICATE_CONTINUANCE", () => {
    const r = classifySignal(inputOf({
      headline: "Annexation petition for property east of I-35",
      signalSubtype: "ANNEXATION",
      context: { recentHeadlines: ["Variance request for setback at 1234 Oak Street"] },
    }));
    expect(r.factors.map((f) => f.kind)).not.toContain("DUPLICATE_CONTINUANCE");
  });

  test("empty recentHeadlines → no DUPLICATE_CONTINUANCE", () => {
    const r = classifySignal(inputOf({
      headline: "Plat approval",
      signalSubtype: "PLAT",
      context: { recentHeadlines: [] },
    }));
    expect(r.factors.map((f) => f.kind)).not.toContain("DUPLICATE_CONTINUANCE");
  });
});

describe("DUPLICATE_PACKET detector", () => {
  test("docPacketHash already in recentDocHashes fires DUPLICATE_PACKET (hard-drop)", () => {
    const r = classifySignal(inputOf({
      headline: "Multiple items",
      signalSubtype: "SITE_PLAN",
      docPacketHash: "sha1abc123",
      context: { recentDocHashes: new Set(["sha1abc123", "sha1deadbeef"]) },
    }));
    expect(r.factors.map((f) => f.kind)).toContain("DUPLICATE_PACKET");
    expect(r.classification).toBe("SUPPRESSED");
    expect(r.shouldDrop).toBe(true);
  });

  test("docPacketHash not in recentDocHashes does not fire", () => {
    const r = classifySignal(inputOf({
      headline: "Site plan approval",
      signalSubtype: "SITE_PLAN",
      docPacketHash: "sha1NEW",
      context: { recentDocHashes: new Set(["sha1abc123"]) },
    }));
    expect(r.factors.map((f) => f.kind)).not.toContain("DUPLICATE_PACKET");
  });
});

describe("factor stacking + classification bands", () => {
  test("annexation + utility expansion + recurring developer + high value → HIGH_EMERGENCE", () => {
    const r = classifySignal(inputOf({
      headline: "Annexation petition + sewer extension for 200-acre industrial park",
      signalSubtype: "ANNEXATION",
      rawText: "Includes sewer extension and corridor study",
      metadata: { estimated_value: 50_000_000, developer_name: "Knapp Properties" },
      context: { recentDeveloperNames: new Set(["knappproperties"]) },
    }));
    expect(r.classification).toBe("HIGH_EMERGENCE");
    expect(r.factors.map((f) => f.kind)).toEqual(
      expect.arrayContaining(["ANNEXATION", "UTILITY_EXPANSION", "CORRIDOR_STUDY", "HIGH_VALUE", "RECURRING_DEVELOPER"]),
    );
  });

  test("single mild boost → MEDIUM_EMERGENCE", () => {
    const r = classifySignal(inputOf({
      headline: "Plat approval for 12-lot subdivision",
      signalSubtype: "PLAT",
    }));
    expect(r.classification).toBe("MEDIUM_EMERGENCE");
  });

  test("conflicting factors: weak boost vs strong suppression resolves to SUPPRESSED via hard-drop", () => {
    const r = classifySignal(inputOf({
      headline: "Approval of the Agenda",
      signalSubtype: "REZONING", // would normally be +0.20
    }));
    expect(r.classification).toBe("SUPPRESSED");
    expect(r.shouldDrop).toBe(true);
  });

  test("dedup: ANNEXATION fires from BOTH subtype and keyword but only one factor is kept", () => {
    const r = classifySignal(inputOf({
      headline: "Annexation petition for east-side parcel",
      signalSubtype: "ANNEXATION",
      rawText: "Property to be annexed into city limits",
    }));
    const annexationFactors = r.factors.filter((f) => f.kind === "ANNEXATION");
    expect(annexationFactors).toHaveLength(1);
  });
});

describe("tokenSetSimilarity (exported helper)", () => {
  test("identical strings → 1.0", () => {
    expect(tokenSetSimilarity("foo bar baz", "foo bar baz")).toBe(1);
  });
  test("disjoint strings → 0.0", () => {
    expect(tokenSetSimilarity("alpha beta", "gamma delta")).toBe(0);
  });
  test("empty input → 0.0", () => {
    expect(tokenSetSimilarity("", "abc")).toBe(0);
  });
  test("token shorter than 3 chars is ignored (stopword-lite)", () => {
    // "a" and "is" are ignored; only "house" overlaps.
    expect(tokenSetSimilarity("a house", "is house")).toBe(1);
  });
});

describe("explainability — factor structure invariants", () => {
  test("every factor has kind + signed weight + bucket + detail", () => {
    const r = classifySignal(inputOf({
      headline: "Annexation petition",
      signalSubtype: "ANNEXATION",
    }));
    for (const f of r.factors) {
      expect(typeof f.kind).toBe("string");
      expect(typeof f.weight).toBe("number");
      expect(["BOOST", "SUPPRESS"]).toContain(f.bucket);
      expect(typeof f.detail).toBe("string");
      expect(f.detail.length).toBeGreaterThan(0);
      // bucket and weight sign must agree.
      if (f.bucket === "BOOST") expect(f.weight).toBeGreaterThan(0);
      if (f.bucket === "SUPPRESS") expect(f.weight).toBeLessThan(0);
    }
  });

  test("determinism: classifying the same input twice yields equal results", () => {
    const input = inputOf({
      headline: "Site plan approval for distribution center",
      signalSubtype: "SITE_PLAN",
      rawText: "200,000 sf logistics facility with rail spur",
      metadata: { estimated_value: 12_000_000, owner_name: "FedEx Ground" },
      jurisdiction: "Ankeny",
      context: {
        recentDeveloperNames: new Set(["fedexground"]),
        recentJurisdictions: new Map([["Ankeny", 6]]),
      },
    });
    const r1 = classifySignal(input);
    const r2 = classifySignal(input);
    expect(r2).toEqual(r1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/__tests__/signalHeuristicsGovernance.test.ts
//  Phase O2.2 PR6 — Governance-subtype + governance-suppression tests for v2.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import {
  classifySignal,
  HEURISTICS_VERSION,
  __internals,
  type HeuristicInput,
} from "../signalHeuristics";

function inputOf(p: Partial<HeuristicInput>): HeuristicInput {
  return {
    headline: p.headline ?? "Untitled",
    signalType: p.signalType ?? "MEETING_MINUTE",
    signalSubtype: p.signalSubtype ?? null,
    rawText: p.rawText ?? null,
    metadata: p.metadata ?? null,
    documentDate: p.documentDate ?? null,
    jurisdiction: p.jurisdiction ?? null,
    docPacketHash: p.docPacketHash ?? null,
    context: p.context,
  };
}

describe("PR6 version bump", () => {
  test("HEURISTICS_VERSION is v2", () => {
    expect(HEURISTICS_VERSION).toBe("v2");
  });
});

describe("Governance subtype boosts (PR6)", () => {
  const subtypeCases: Array<[string, string, number]> = [
    ["CODE_ADOPTION",          "CODE_ADOPTION",          0.20],
    ["ORDINANCE_CHANGE",       "ORDINANCE_CHANGE",       0.15],
    ["ZONING_REWRITE",         "ZONING_REWRITE",         0.35],
    ["DENSITY_EXPANSION",      "DENSITY_EXPANSION",      0.30],
    ["TIF_APPROVAL",           "TIF_APPROVAL",           0.30],
    ["MORATORIUM",             "MORATORIUM",             0.15],
    ["INFRASTRUCTURE_FUNDING", "INFRASTRUCTURE_FUNDING", 0.35],
  ];

  for (const [subtype, expectedKind, expectedWeight] of subtypeCases) {
    test(`subtype ${subtype} → factor ${expectedKind} (+${expectedWeight})`, () => {
      const r = classifySignal(inputOf({
        headline: `Governance signal: ${subtype.toLowerCase()} item`,
        signalSubtype: subtype,
      }));
      const factor = r.factors.find((f) => f.kind === expectedKind);
      expect(factor).toBeDefined();
      expect(factor!.bucket).toBe("BOOST");
      expect(factor!.weight).toBeCloseTo(expectedWeight, 5);
    });
  }

  test("ZONING_REWRITE classifies as HIGH_EMERGENCE on its own (+0.35 ≥ HIGH threshold)", () => {
    const r = classifySignal(inputOf({
      headline: "Comprehensive Zoning Ordinance Rewrite — adopted",
      signalSubtype: "ZONING_REWRITE",
    }));
    expect(r.classification).toBe("HIGH_EMERGENCE");
  });

  test("INFRASTRUCTURE_FUNDING classifies as HIGH_EMERGENCE on its own", () => {
    const r = classifySignal(inputOf({
      headline: "Federal infrastructure grant award announcement",
      signalSubtype: "INFRASTRUCTURE_FUNDING",
    }));
    expect(r.classification).toBe("HIGH_EMERGENCE");
  });

  test("MORATORIUM alone lands in MEDIUM_EMERGENCE (positive but modest)", () => {
    const r = classifySignal(inputOf({
      headline: "Moratorium imposed on industrial rezoning until 2027",
      signalSubtype: "MORATORIUM",
    }));
    expect(["MEDIUM_EMERGENCE", "LOW_EMERGENCE"]).toContain(r.classification);
    const f = r.factors.find((x) => x.kind === "MORATORIUM");
    expect(f).toBeDefined();
    expect(f!.weight).toBeGreaterThan(0);
  });
});

describe("Governance keyword detection — fires WITHOUT subtype", () => {
  test("ZONING_REWRITE keyword in headline fires even when subtype is OTHER", () => {
    const r = classifySignal(inputOf({
      headline: "Comprehensive Zoning Rewrite — Phase 2 community engagement",
      signalSubtype: "OTHER",
    }));
    expect(r.factors.map((f) => f.kind)).toContain("ZONING_REWRITE");
  });

  test("DENSITY_EXPANSION keyword in raw text fires", () => {
    const r = classifySignal(inputOf({
      headline: "Code amendment discussion",
      signalSubtype: "ORDINANCE_CHANGE",
      rawText: "Amends Chapter 27 to introduce ADU allowance and increase FAR from 0.5 to 0.8",
    }));
    expect(r.factors.map((f) => f.kind)).toContain("DENSITY_EXPANSION");
  });

  test("MORATORIUM keyword detected from headline", () => {
    const r = classifySignal(inputOf({
      headline: "Temporary pause on industrial rezoning applications",
      signalSubtype: "OTHER",
    }));
    expect(r.factors.map((f) => f.kind)).toContain("MORATORIUM");
  });

  test("TIF_APPROVAL phrase pattern detected", () => {
    const r = classifySignal(inputOf({
      headline: "TIF district approved for Riverwalk redevelopment",
      signalSubtype: "TIF",  // generic TIF subtype — keyword promotes to TIF_APPROVAL too
    }));
    const kinds = r.factors.map((f) => f.kind);
    expect(kinds).toContain("TIF");           // subtype boost
    expect(kinds).toContain("TIF_APPROVAL");  // keyword promotion
  });

  test("INFRASTRUCTURE_FUNDING detected from federal-grant language", () => {
    const r = classifySignal(inputOf({
      headline: "Public works director report",
      rawText: "City has received a federal grant award of $4.2M for the corridor reconstruction project.",
    }));
    expect(r.factors.map((f) => f.kind)).toContain("INFRASTRUCTURE_FUNDING");
  });

  test("CODE_ADOPTION detected from IBC adoption language", () => {
    const r = classifySignal(inputOf({
      headline: "Adopting the 2024 International Building Code",
      signalSubtype: "OTHER",
    }));
    expect(r.factors.map((f) => f.kind)).toContain("CODE_ADOPTION");
  });

  test("ORDINANCE_CHANGE detected from amendment language (but NOT when more specific subtype fires)", () => {
    const r = classifySignal(inputOf({
      headline: "Ordinance amendment to chapter 5 of the municipal code",
      signalSubtype: "OTHER",
    }));
    expect(r.factors.map((f) => f.kind)).toContain("ORDINANCE_CHANGE");
  });
});

describe("Governance dedup — same kind doesn't double-fire", () => {
  test("ZONING_REWRITE subtype + matching keyword → single ZONING_REWRITE factor (dedup)", () => {
    const r = classifySignal(inputOf({
      headline: "Comprehensive Zoning Rewrite adopted",
      signalSubtype: "ZONING_REWRITE",
      rawText: "Citywide zoning code rewrite approved.",
    }));
    const z = r.factors.filter((f) => f.kind === "ZONING_REWRITE");
    expect(z).toHaveLength(1);
  });
});

describe("Governance suppression (PR6)", () => {
  test("\"First Reading of Ordinance ...\" → PROCEDURAL_READING factor", () => {
    const r = classifySignal(inputOf({
      headline: "First Reading of Ordinance 24-15 — Annual Budget",
      signalSubtype: "ORDINANCE_CHANGE",  // would normally boost +0.15
    }));
    const kinds = r.factors.map((f) => f.kind);
    expect(kinds).toContain("PROCEDURAL_READING");
    // -0.30 procedural + 0.15 ordinance = -0.15 → 0.35 base + -0.15 = 0.20 → LOW_EMERGENCE
    expect(["LOW_EMERGENCE", "SUPPRESSED"]).toContain(r.classification);
  });

  test("\"Second Reading\" fires PROCEDURAL_READING", () => {
    const r = classifySignal(inputOf({
      headline: "Second Reading of Ordinance 24-22",
    }));
    expect(r.factors.map((f) => f.kind)).toContain("PROCEDURAL_READING");
  });

  test("\"Resolution in support of ...\" → NON_DEVELOPMENT_RESOLUTION (heavy suppression)", () => {
    const r = classifySignal(inputOf({
      headline: "Resolution in support of National Veterans Recognition Week",
    }));
    expect(r.factors.map((f) => f.kind)).toContain("NON_DEVELOPMENT_RESOLUTION");
    expect(r.classification).toBe("SUPPRESSED");
    expect(r.shouldDrop).toBe(true);
  });

  test("\"Resolution recognizing ...\" → NON_DEVELOPMENT_RESOLUTION → SUPPRESSED", () => {
    const r = classifySignal(inputOf({
      headline: "Resolution recognizing the contributions of the Public Works staff",
    }));
    expect(r.classification).toBe("SUPPRESSED");
  });

  test("\"Resolution proclaiming ...\" → NON_DEVELOPMENT_RESOLUTION", () => {
    const r = classifySignal(inputOf({
      headline: "Resolution proclaiming Earth Day in the city",
    }));
    expect(r.factors.map((f) => f.kind)).toContain("NON_DEVELOPMENT_RESOLUTION");
  });

  test("substantive resolution (no recognition language) does NOT fire NON_DEVELOPMENT_RESOLUTION", () => {
    const r = classifySignal(inputOf({
      headline: "Resolution approving the construction contract for Library expansion",
    }));
    expect(r.factors.map((f) => f.kind)).not.toContain("NON_DEVELOPMENT_RESOLUTION");
  });

  test("Hard-drop rule: NON_DEVELOPMENT_RESOLUTION at -0.45 does NOT trigger hard-drop on its own (above -0.50 threshold), but the score band still classifies SUPPRESSED", () => {
    const r = classifySignal(inputOf({
      headline: "Resolution honoring the retirement of the City Clerk",
    }));
    // -0.45 weight: 0.35 base + -0.45 = -0.10 → clamped 0 → SUPPRESSED
    expect(r.classification).toBe("SUPPRESSED");
    expect(r.score).toBeLessThan(__internals.SUPPRESS_BELOW);
  });
});

describe("Governance + substantive stacking", () => {
  test("ZONING_REWRITE + DENSITY_EXPANSION + INFRASTRUCTURE_FUNDING → HIGH_EMERGENCE (caps at 1.0)", () => {
    const r = classifySignal(inputOf({
      headline: "Adopting the comprehensive zoning rewrite with density bonus + federal infrastructure grant alignment",
      signalSubtype: "ZONING_REWRITE",
      rawText: "Includes density bonus for missing middle housing. Tied to federal grant award.",
    }));
    expect(r.classification).toBe("HIGH_EMERGENCE");
    expect(r.score).toBeLessThanOrEqual(1.0);  // clamp invariant
    expect(r.score).toBeGreaterThanOrEqual(0.70);
  });

  test("governance subtypes + ceremonial pattern → ceremonial does NOT hard-drop unless ≤ -0.50", () => {
    // Ceremonial is -0.30 → no hard-drop. ZONING_REWRITE (+0.35) overcomes it.
    const r = classifySignal(inputOf({
      headline: "Invocation by Pastor Smith — followed by comprehensive zoning rewrite discussion",
      signalSubtype: "ZONING_REWRITE",
    }));
    // 0.35 base + 0.35 ZONING_REWRITE - 0.30 CEREMONIAL_PATTERN = 0.40 → MEDIUM_EMERGENCE
    expect(["MEDIUM_EMERGENCE", "HIGH_EMERGENCE"]).toContain(r.classification);
  });

  test("governance subtype + AGENDA_APPROVAL (hard-drop -0.60) → SUPPRESSED regardless", () => {
    const r = classifySignal(inputOf({
      headline: "Approval of the Agenda — comprehensive zoning rewrite included",
      signalSubtype: "ZONING_REWRITE",
    }));
    expect(r.classification).toBe("SUPPRESSED");
    expect(r.shouldDrop).toBe(true);
  });
});

describe("Explainability — every governance factor carries kind/weight/bucket/detail", () => {
  test("classification result is structurally sound for governance signals", () => {
    const r = classifySignal(inputOf({
      headline: "TIF district approved for Riverwalk redevelopment",
      signalSubtype: "TIF_APPROVAL",
    }));
    for (const f of r.factors) {
      expect(typeof f.kind).toBe("string");
      expect(typeof f.weight).toBe("number");
      expect(["BOOST", "SUPPRESS"]).toContain(f.bucket);
      expect(typeof f.detail).toBe("string");
      expect(f.detail.length).toBeGreaterThan(0);
    }
  });
});

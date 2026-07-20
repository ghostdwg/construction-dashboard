// ──────────────────────────────────────────────────────────────────────────────
//  Safe-field mapping tests.
//
//  These are the confidentiality tests. They assert what the mapper DOESN'T
//  emit as strictly as what it does, because the failure mode that matters is
//  a new market column silently reaching a pursuit.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import {
  leadSourceContext,
  mapLeadToDraft,
  mapProjectToDraft,
  notCarriedFields,
  projectSourceContext,
  PROMOTION_FORBIDDEN_SOURCE_FIELDS,
  PROMOTION_WRITABLE_BID_FIELDS,
} from "../mapping";
import { marketSourceHref, pursuitHref } from "../types";

const FULL_LEAD = {
  id: "lead_1",
  title: "  Riverside Medical Office Building  ",
  location: "1200 Riverside Dr",
  jurisdiction: "Tulsa County",
  projectType: "medical office",
  estimatedValue: 8_400_000,
  sourceUrl: "https://city.example.gov/minutes/2026-05.pdf",
  sourceDocId: "doc_9",
};

const FULL_PROJECT = {
  id: "proj_1",
  workingTitle: "Eastgate Logistics Campus",
  jurisdiction: "Broken Arrow",
  projectType: "industrial",
  estimatedValue: 22_000_000,
  estimatedSqft: 310_000,
  source: "aggregated",
};

describe("mapLeadToDraft", () => {
  test("carries exactly the writable Bid fields and nothing else", () => {
    const draft = mapLeadToDraft(FULL_LEAD);
    expect(Object.keys(draft).sort()).toEqual([...PROMOTION_WRITABLE_BID_FIELDS].sort());
  });

  test("maps public source fields onto their Bid columns", () => {
    const draft = mapLeadToDraft(FULL_LEAD);
    expect(draft.projectName).toBe("Riverside Medical Office Building"); // trimmed
    expect(draft.location).toBe("1200 Riverside Dr");
    // MarketLead.projectType is a building use, NOT the Bid.projectType enum.
    expect(draft.buildingType).toBe("medical office");
    expect(draft.approxSqft).toBeNull();
  });

  test("falls back to jurisdiction when the lead has no specific location", () => {
    const draft = mapLeadToDraft({ ...FULL_LEAD, location: null });
    expect(draft.location).toBe("Tulsa County");
  });

  test("treats whitespace-only values as absent", () => {
    const draft = mapLeadToDraft({
      ...FULL_LEAD,
      title: "   ",
      location: "  ",
      jurisdiction: "  ",
      projectType: "",
    });
    expect(draft.projectName).toBe("Untitled pursuit");
    expect(draft.location).toBeNull();
    expect(draft.buildingType).toBeNull();
  });

  test("never emits an AI-derived or internal field, even when present on input", () => {
    const draft = mapLeadToDraft({
      ...FULL_LEAD,
      // Deliberately over-supplied — the mapper's allowlist must ignore these.
      aiSummary: "Claude thinks this is a strong opportunity",
      aiInsights: JSON.stringify({ risks: ["schedule"] }),
      aiScore: 91,
      rawText: "…8000 characters of scraped minutes…",
      notes: "internal desk note",
      pricingData: "CONFIDENTIAL",
      isPreferred: true,
    } as never);

    const serialized = JSON.stringify(draft);
    for (const forbidden of PROMOTION_FORBIDDEN_SOURCE_FIELDS) {
      expect(Object.keys(draft)).not.toContain(forbidden);
    }
    expect(serialized).not.toContain("Claude thinks");
    expect(serialized).not.toContain("CONFIDENTIAL");
    expect(serialized).not.toContain("scraped minutes");
    expect(serialized).not.toContain("internal desk note");
  });
});

describe("mapProjectToDraft", () => {
  test("carries exactly the writable Bid fields", () => {
    const draft = mapProjectToDraft(FULL_PROJECT);
    expect(Object.keys(draft).sort()).toEqual([...PROMOTION_WRITABLE_BID_FIELDS].sort());
  });

  test("uses jurisdiction as the only public locator and carries sqft", () => {
    const draft = mapProjectToDraft(FULL_PROJECT);
    expect(draft.projectName).toBe("Eastgate Logistics Campus");
    expect(draft.location).toBe("Broken Arrow");
    expect(draft.buildingType).toBe("industrial");
    expect(draft.approxSqft).toBe(310_000);
  });

  test("rejects non-positive and non-finite sqft rather than writing nonsense", () => {
    expect(mapProjectToDraft({ ...FULL_PROJECT, estimatedSqft: 0 }).approxSqft).toBeNull();
    expect(mapProjectToDraft({ ...FULL_PROJECT, estimatedSqft: -5 }).approxSqft).toBeNull();
    expect(
      mapProjectToDraft({ ...FULL_PROJECT, estimatedSqft: Number.NaN }).approxSqft
    ).toBeNull();
  });

  test("never emits emergence probability or desk notes", () => {
    const draft = mapProjectToDraft({
      ...FULL_PROJECT,
      emergenceProbability: 0.82,
      notes: "aggregator confidence low",
    } as never);
    expect(JSON.stringify(draft)).not.toContain("0.82");
    expect(JSON.stringify(draft)).not.toContain("aggregator confidence");
  });
});

describe("source context", () => {
  test("lead context exposes only public provenance pointers", () => {
    const ctx = leadSourceContext(FULL_LEAD);
    expect(ctx).toEqual({
      sourceKind: "LEAD",
      sourceId: "lead_1",
      sourceTitle: "Riverside Medical Office Building",
      sourceUrl: "https://city.example.gov/minutes/2026-05.pdf",
      sourceDocId: "doc_9",
      estimatedValue: 8_400_000,
      jurisdiction: "Tulsa County",
    });
  });

  test("project context carries no URL — Project.source is a label, not a link", () => {
    const ctx = projectSourceContext(FULL_PROJECT);
    expect(ctx.sourceKind).toBe("PROJECT");
    expect(ctx.sourceUrl).toBeNull();
    expect(ctx.sourceDocId).toBeNull();
    expect(ctx.estimatedValue).toBe(22_000_000);
  });
});

describe("notCarriedFields", () => {
  test("surfaces public values that have no Bid column so they are not silently dropped", () => {
    const fields = notCarriedFields(leadSourceContext(FULL_LEAD));
    expect(fields.map((f) => f.field)).toEqual(["Estimated value", "Source URL"]);
    expect(fields[0].value).toBe("$8,400,000");
  });

  test("omits absent values", () => {
    const fields = notCarriedFields(
      leadSourceContext({ ...FULL_LEAD, estimatedValue: null, sourceUrl: null })
    );
    expect(fields).toEqual([]);
  });
});

describe("navigation targets", () => {
  test("pursuit href points at the bid detail route", () => {
    expect(pursuitHref(412)).toBe("/bids/412");
  });

  test("market href distinguishes leads from project aggregates", () => {
    expect(marketSourceHref("LEAD", "lead_1")).toBe("/market-intelligence/lead_1");
    expect(marketSourceHref("PROJECT", "proj_1")).toBe(
      "/market-intelligence/projects/proj_1"
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/__tests__/sidecarMarket.test.ts
//  O2.2 PR1 — Verify persistSidecarPayload populates the new createdSignalIds
//  / createdLeadIds / createdEdgeIds arrays so the scrape bridge can consume
//  them.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

const { store } = vi.hoisted(() => ({
  store: { counter: 0 },
}));

function nextId(prefix: string): string {
  store.counter += 1;
  return `${prefix}_${store.counter}`;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketLead: {
      create: vi.fn(async () => ({ id: nextId("lead") })),
    },
    marketSignal: {
      create: vi.fn(async () => ({ id: nextId("sig") })),
    },
    relationshipEdge: {
      create: vi.fn(async () => ({ id: nextId("edge") })),
    },
  },
}));

import { persistSidecarPayload } from "../sidecarMarket";

beforeEach(() => {
  store.counter = 0;
});

describe("persistSidecarPayload — created IDs", () => {
  test("returns the IDs of every freshly-created MarketSignal in insertion order", async () => {
    const result = await persistSidecarPayload({
      signals: [
        { signal_type: "meeting_minute", headline: "First",  relevance_score: 90 },
        { signal_type: "meeting_minute", headline: "Second", relevance_score: 85 },
        { signal_type: "meeting_minute", headline: "Third",  relevance_score: 70 },
      ],
      relationships: [],
      jurisdiction: "Ankeny",
      documentDate: "2026-05-21",
      sourceUrl: "https://example.gov/x.pdf",
      sourceLabel: "Ankeny P&Z",
      tuning: { minRelevanceScore: 60 },
    });

    expect(result.signalsCreated).toBe(3);
    expect(result.createdSignalIds).toHaveLength(3);
    expect(result.createdSignalIds.every((id) => id.startsWith("sig_"))).toBe(true);
    expect(result.createdLeadIds.length).toBe(result.leadsCreated);
    expect(result.createdEdgeIds).toEqual([]);
  });

  test("returns lead IDs for high-relevance signals that crossed the lead threshold", async () => {
    const result = await persistSidecarPayload({
      signals: [
        { signal_type: "meeting_minute", headline: "low score",  relevance_score: 50 },
        { signal_type: "meeting_minute", headline: "high score", relevance_score: 85 },
      ],
      relationships: [],
      jurisdiction: "Polk County",
      documentDate: null,
      sourceUrl: null,
      sourceLabel: "Polk P&Z",
      tuning: { minRelevanceScore: 40 },
    });

    // Both signals persisted (both >= 40 minRelevance).
    expect(result.signalsCreated).toBe(2);
    expect(result.createdSignalIds).toHaveLength(2);
    // Only the >=60 (and effectively >=80-ish given Math.max(40,60)) signal becomes a lead.
    expect(result.leadsCreated).toBe(1);
    expect(result.createdLeadIds).toHaveLength(1);
  });

  test("returns relationship-edge IDs for every persisted edge", async () => {
    const result = await persistSidecarPayload({
      signals: [],
      relationships: [
        { from_type: "DEVELOPER", from_name: "Acme Dev", to_type: "GC", to_name: "BuildCo", relationship_type: "BUILT" },
        { from_type: "OWNER",     from_name: "Owner X",  to_type: "ARCHITECT", to_name: "Studio A", relationship_type: "DESIGNED" },
      ],
      jurisdiction: "Des Moines",
      documentDate: null,
      sourceUrl: null,
      sourceLabel: "scan-test",
    });

    expect(result.relationshipsCreated).toBe(2);
    expect(result.createdEdgeIds).toHaveLength(2);
    expect(result.createdSignalIds).toEqual([]);
    expect(result.createdLeadIds).toEqual([]);
  });

  test("empty input → empty ID arrays (no nulls, no undefineds)", async () => {
    const result = await persistSidecarPayload({
      signals: [],
      relationships: [],
      jurisdiction: null,
      documentDate: null,
      sourceUrl: null,
      sourceLabel: "empty",
    });

    expect(result.signalsCreated).toBe(0);
    expect(result.leadsCreated).toBe(0);
    expect(result.relationshipsCreated).toBe(0);
    expect(result.createdSignalIds).toEqual([]);
    expect(result.createdLeadIds).toEqual([]);
    expect(result.createdEdgeIds).toEqual([]);
  });

  test("PR5 subtype coverage: UTILITY_EXPANSION / CORRIDOR_STUDY / INFRASTRUCTURE_PLAN / INDUSTRIAL_REZONING are preserved (not coerced to OTHER)", async () => {
    // VALID_SUBTYPES is private; we verify the behavior via the public
    // persistSidecarPayload + MarketSignal.signalSubtype round trip. The
    // prisma mock captures `.create({data})` calls.
    type CapturedCreate = { data: Record<string, unknown> };
    const captured: CapturedCreate[] = [];
    const { prisma } = await import("@/lib/prisma");
    const originalCreate = prisma.marketSignal.create;
    (prisma.marketSignal.create as unknown as ReturnType<typeof vi.fn>) = vi.fn(async (args: CapturedCreate) => {
      captured.push(args);
      return { id: `subtype-${captured.length}` };
    });

    try {
      await persistSidecarPayload({
        signals: [
          { signal_type: "meeting_minute", signal_subtype: "UTILITY_EXPANSION",   headline: "sewer extension", relevance_score: 80 },
          { signal_type: "meeting_minute", signal_subtype: "CORRIDOR_STUDY",      headline: "corridor study",  relevance_score: 80 },
          { signal_type: "meeting_minute", signal_subtype: "INFRASTRUCTURE_PLAN", headline: "CIP item",        relevance_score: 80 },
          { signal_type: "meeting_minute", signal_subtype: "INDUSTRIAL_REZONING", headline: "rezone to I-2",   relevance_score: 80 },
        ],
        relationships: [],
        jurisdiction: "Ankeny",
        documentDate: null,
        sourceUrl: null,
        sourceLabel: "test",
        skipHeuristics: true, // bypass classifier; we're only testing subtype normalization
      });

      expect(captured).toHaveLength(4);
      expect(captured[0].data.signalSubtype).toBe("UTILITY_EXPANSION");
      expect(captured[1].data.signalSubtype).toBe("CORRIDOR_STUDY");
      expect(captured[2].data.signalSubtype).toBe("INFRASTRUCTURE_PLAN");
      expect(captured[3].data.signalSubtype).toBe("INDUSTRIAL_REZONING");
    } finally {
      (prisma.marketSignal.create as unknown as typeof originalCreate) = originalCreate;
    }
  });

  test("dropped signals (below minRelevanceScore) are not added to createdSignalIds", async () => {
    const result = await persistSidecarPayload({
      signals: [
        { signal_type: "meeting_minute", headline: "drop me", relevance_score: 20 },
        { signal_type: "meeting_minute", headline: "keep me", relevance_score: 90 },
      ],
      relationships: [],
      jurisdiction: null,
      documentDate: null,
      sourceUrl: null,
      sourceLabel: "drop-test",
      tuning: { minRelevanceScore: 60 },
    });

    expect(result.signalsDroppedRelevance).toBe(1);
    expect(result.signalsCreated).toBe(1);
    expect(result.createdSignalIds).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/__tests__/heuristicsContext.test.ts
//  O2.2 PR3 — Verify the context loader queries only the bounded surface and
//  shapes results the classifier can consume.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

const { store } = vi.hoisted(() => ({
  store: {
    signals90: [] as Array<{ metadata: string | null; sourceDocId: string | null; sourceDoc: { jurisdiction: string | null } | null }>,
    signals30: [] as Array<{ sourceDoc: { jurisdiction: string | null } | null }>,
    docs: [] as Array<{ id: string; sourceId: string; scannedAt: Date; rawText: string | null }>,
    headlineRows: [] as Array<{ headline: string }>,
    counter: 0,
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketSignal: {
      findMany: vi.fn(async (args: { where: { createdAt?: { gte: Date }; sourceDocId?: { in: string[] } }; select?: Record<string, boolean> }) => {
        // Recent-90-day signal pull (has metadata + sourceDoc.jurisdiction selected)
        if (args.select?.metadata) return store.signals90;
        // Recent-30-day signal pull (has sourceDoc.jurisdiction only)
        if (args.where.createdAt && !args.where.sourceDocId) return store.signals30;
        // Recent-headlines pull (sourceDocId.in + headline selected)
        if (args.where.sourceDocId) return store.headlineRows;
        return [];
      }),
    },
    marketSourceDoc: {
      findMany: vi.fn(async () => store.docs),
    },
  },
}));

import { buildHeuristicsContext, computeDocPacketHash, normalizeName } from "../heuristicsContext";

beforeEach(() => {
  store.signals90 = [];
  store.signals30 = [];
  store.docs = [];
  store.headlineRows = [];
  store.counter = 0;
});

describe("computeDocPacketHash", () => {
  test("returns a 16-char hex string", () => {
    const h = computeDocPacketHash("hello world");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h.length).toBe(16);
  });

  test("deterministic: identical input → identical hash", () => {
    expect(computeDocPacketHash("abc")).toBe(computeDocPacketHash("abc"));
  });

  test("different input → different hash", () => {
    expect(computeDocPacketHash("abc")).not.toBe(computeDocPacketHash("abd"));
  });
});

describe("buildHeuristicsContext", () => {
  test("empty database → empty context (no nulls)", async () => {
    const ctx = await buildHeuristicsContext("src1");
    expect(ctx.recentDeveloperNames?.size).toBe(0);
    expect(ctx.recentParcels?.size).toBe(0);
    expect(ctx.recentJurisdictions?.size).toBe(0);
    expect(ctx.recentHeadlines).toEqual([]);
    expect(ctx.recentDocHashes?.size).toBe(0);
    expect(ctx.projectKeyMeetingCounts?.size).toBe(0);
  });

  test("recent developer names are normalized + deduped via normalizeName", async () => {
    store.signals90 = [
      { metadata: JSON.stringify({ owner_name: "Hubbell Realty Company" }), sourceDocId: "d1", sourceDoc: { jurisdiction: "Ankeny" } },
      { metadata: JSON.stringify({ developer_name: "Hubbell Realty LLC" }),  sourceDocId: "d2", sourceDoc: { jurisdiction: "Ankeny" } },
      { metadata: JSON.stringify({ owner_name: "Knapp Properties Inc." }),   sourceDocId: "d3", sourceDoc: { jurisdiction: "Ankeny" } },
    ];
    const ctx = await buildHeuristicsContext("src1");
    expect(ctx.recentDeveloperNames?.has("hubbellrealty")).toBe(true);
    expect(ctx.recentDeveloperNames?.has("knappproperties")).toBe(true);
    expect(ctx.recentDeveloperNames?.size).toBe(2); // hubbell appeared twice with different suffixes → 1 set entry
  });

  test("recent parcels extracted from metadata", async () => {
    store.signals90 = [
      { metadata: JSON.stringify({ parcel_id: "0903-12-345-001" }), sourceDocId: "d1", sourceDoc: null },
      { metadata: JSON.stringify({ parcel_id: "0903-12-345-002" }), sourceDocId: "d2", sourceDoc: null },
    ];
    const ctx = await buildHeuristicsContext("src1");
    expect(ctx.recentParcels?.size).toBe(2);
    expect(ctx.recentParcels?.has("0903-12-345-001")).toBe(true);
  });

  test("recent jurisdictions counted from 30-day signal pull", async () => {
    store.signals30 = [
      { sourceDoc: { jurisdiction: "Ankeny" } },
      { sourceDoc: { jurisdiction: "Ankeny" } },
      { sourceDoc: { jurisdiction: "Ankeny" } },
      { sourceDoc: { jurisdiction: "Waukee" } },
      { sourceDoc: { jurisdiction: null } }, // ignored
    ];
    const ctx = await buildHeuristicsContext("src1");
    expect(ctx.recentJurisdictions?.get("Ankeny")).toBe(3);
    expect(ctx.recentJurisdictions?.get("Waukee")).toBe(1);
    expect(ctx.recentJurisdictions?.size).toBe(2);
  });

  test("recent doc hashes computed from rawText of last N source docs", async () => {
    store.docs = [
      { id: "d1", sourceId: "src1", scannedAt: new Date(), rawText: "hello world" },
      { id: "d2", sourceId: "src1", scannedAt: new Date(), rawText: "another document" },
      { id: "d3", sourceId: "src1", scannedAt: new Date(), rawText: null }, // skipped
    ];
    const ctx = await buildHeuristicsContext("src1");
    expect(ctx.recentDocHashes?.size).toBe(2);
    expect(ctx.recentDocHashes?.has(computeDocPacketHash("hello world"))).toBe(true);
  });

  test("recent headlines pulled from signals tied to recent docs", async () => {
    store.docs = [
      { id: "d1", sourceId: "src1", scannedAt: new Date(), rawText: "x" },
    ];
    store.headlineRows = [
      { headline: "Variance request for 1234 Oak" },
      { headline: "Plat approval for Walnut Creek" },
    ];
    const ctx = await buildHeuristicsContext("src1");
    expect(ctx.recentHeadlines).toEqual([
      "Variance request for 1234 Oak",
      "Plat approval for Walnut Creek",
    ]);
  });

  test("project-key meeting counts: parcel key takes priority over actor key", async () => {
    store.signals90 = [
      { metadata: JSON.stringify({ parcel_id: "P-1", owner_name: "Acme LLC" }), sourceDocId: "doc1", sourceDoc: { jurisdiction: "Ankeny" } },
      { metadata: JSON.stringify({ parcel_id: "P-1", owner_name: "Acme LLC" }), sourceDocId: "doc2", sourceDoc: { jurisdiction: "Ankeny" } },
      { metadata: JSON.stringify({ parcel_id: "P-1", owner_name: "Acme LLC" }), sourceDocId: "doc3", sourceDoc: { jurisdiction: "Ankeny" } },
    ];
    const ctx = await buildHeuristicsContext("src1");
    expect(ctx.projectKeyMeetingCounts?.get("parcel:P-1")).toBe(3);
    expect(ctx.projectKeyMeetingCounts?.has("actor:acme")).toBe(false);
  });

  test("project-key falls back to actor when no parcel id", async () => {
    store.signals90 = [
      { metadata: JSON.stringify({ owner_name: "Knapp Properties" }), sourceDocId: "doc1", sourceDoc: { jurisdiction: "WDM" } },
      { metadata: JSON.stringify({ owner_name: "Knapp Properties" }), sourceDocId: "doc2", sourceDoc: { jurisdiction: "WDM" } },
    ];
    const ctx = await buildHeuristicsContext("src1");
    expect(ctx.projectKeyMeetingCounts?.get("actor:knappproperties")).toBe(2);
  });

  test("project-key falls back to jurisdiction when no parcel or actor", async () => {
    store.signals90 = [
      { metadata: JSON.stringify({}), sourceDocId: "doc1", sourceDoc: { jurisdiction: "Ankeny" } },
      { metadata: null,               sourceDocId: "doc2", sourceDoc: { jurisdiction: "Ankeny" } },
    ];
    const ctx = await buildHeuristicsContext("src1");
    expect(ctx.projectKeyMeetingCounts?.get("jurisdiction:ankeny")).toBe(2);
  });

  test("project-key meeting counts: same docId in two signals counts ONCE (set semantics)", async () => {
    store.signals90 = [
      { metadata: JSON.stringify({ parcel_id: "P-1" }), sourceDocId: "doc1", sourceDoc: null },
      { metadata: JSON.stringify({ parcel_id: "P-1" }), sourceDocId: "doc1", sourceDoc: null }, // same doc
    ];
    const ctx = await buildHeuristicsContext("src1");
    expect(ctx.projectKeyMeetingCounts?.get("parcel:P-1")).toBe(1);
  });

  test("malformed metadata JSON is silently skipped (no throw)", async () => {
    store.signals90 = [
      { metadata: "{not valid json", sourceDocId: "d1", sourceDoc: { jurisdiction: "X" } },
      { metadata: JSON.stringify({ owner_name: "Good Corp" }), sourceDocId: "d2", sourceDoc: { jurisdiction: "X" } },
    ];
    const ctx = await buildHeuristicsContext("src1");
    expect(ctx.recentDeveloperNames?.has("good")).toBe(true);
  });
});

describe("normalizeName re-export", () => {
  test("strips corporate suffixes and lowercases", () => {
    expect(normalizeName("Hubbell Realty Company")).toBe("hubbellrealty");
    expect(normalizeName("The Weitz Company, LLC")).toBe("weitz");
    expect(normalizeName("ACME-Industries, Inc.")).toBe("acmeindustries");
    expect(normalizeName(null)).toBe("");
    expect(normalizeName("")).toBe("");
  });
});

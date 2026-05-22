// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/__tests__/scrapeOneSourceHeuristics.test.ts
//  O2.2 PR3 — End-to-end wiring tests for hygiene + cadence integration.
//
//  Unlike scrapeOneSource.test.ts (which mocks persistSidecarPayload), this
//  file uses the REAL persistSidecarPayload + REAL classifySignal so the
//  classify → suppress → persist → bridge chain is exercised intact. Only the
//  outermost boundaries are mocked:
//    * sidecar HTTP (callSidecarScrape)
//    * liveIngestion entry points
//    * cadence DB helpers (recordDocDate / recomputeCadence / recordRunOutcome)
//    * heuristicsContext builder (buildHeuristicsContext) — so tests can pin
//      a deterministic context
//    * prisma surface used by persistence (marketSource/Doc/Signal/Lead/Edge)
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  callSidecarScrape,
  scrapeEnergovSource,
  buildHeuristicsContext,
  computeDocPacketHash,
  recordDocDate,
  recomputeCadence,
  recordRunOutcome,
  processNewMarketSignal,
  processNewMarketLead,
  processNewRelationshipEdge,
  recordSignalSuppression,
  recordSignalClassification,
  recordIngestionProcessed,
  recordIngestionDuration,
  recordIngestionPipelineError,
} = vi.hoisted(() => ({
  callSidecarScrape: vi.fn(),
  scrapeEnergovSource: vi.fn(),
  buildHeuristicsContext: vi.fn(),
  computeDocPacketHash: vi.fn((s: string) => "hash:" + s.slice(0, 8)),
  recordDocDate: vi.fn(),
  recomputeCadence: vi.fn(),
  recordRunOutcome: vi.fn(),
  processNewMarketSignal: vi.fn(),
  processNewMarketLead: vi.fn(),
  processNewRelationshipEdge: vi.fn(),
  recordSignalSuppression: vi.fn(),
  recordSignalClassification: vi.fn(),
  recordIngestionProcessed: vi.fn(),
  recordIngestionDuration: vi.fn(),
  recordIngestionPipelineError: vi.fn(),
}));

vi.mock("../sidecarMarket", async (importOriginal) => {
  const original = await importOriginal<typeof import("../sidecarMarket")>();
  return {
    ...original,
    callSidecarScrape,
  };
});

vi.mock("../energovAdapter", () => ({ scrapeEnergovSource }));

vi.mock("../heuristicsContext", () => ({
  buildHeuristicsContext,
  computeDocPacketHash,
}));

vi.mock("../sourceCadence", () => ({
  recordDocDate,
  recomputeCadence,
  recordRunOutcome,
}));

vi.mock("@/lib/services/liveIngestion", () => ({
  processNewMarketSignal,
  processNewMarketLead,
  processNewRelationshipEdge,
}));

vi.mock("@/lib/observability", () => ({
  recordSignalSuppression,
  recordSignalClassification,
  recordIngestionProcessed,
  recordIngestionDuration,
  recordIngestionPipelineError,
}));

// In-memory prisma mock — captures writes so we can assert the heuristics
// metadata is persisted on the MarketSignal row.
const { store } = vi.hoisted(() => ({
  store: {
    sources: new Map<string, Record<string, unknown>>(),
    docs: [] as Array<Record<string, unknown>>,
    signals: [] as Array<Record<string, unknown>>,
    leads: [] as Array<Record<string, unknown>>,
    edges: [] as Array<Record<string, unknown>>,
    counter: 0,
  },
}));

function nextId(): string {
  store.counter += 1;
  return `id${store.counter}`;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketSource: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => store.sources.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const src = store.sources.get(where.id);
        if (src) Object.assign(src, data);
        return { id: where.id, ...data };
      }),
    },
    marketSourceDoc: {
      findMany: vi.fn(async () => store.docs.map((d) => ({ docUrl: d.docUrl }))),
      upsert: vi.fn(async ({ where, create }: { where: { sourceId_docUrl: { sourceId: string; docUrl: string } }; create: Record<string, unknown> }) => {
        const id = nextId();
        const row = { id, ...create };
        store.docs.push(row);
        return row;
      }),
      update: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })),
    },
    marketSignal: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = nextId();
        const row = { id, ...data };
        store.signals.push(row);
        return row;
      }),
    },
    marketLead: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = nextId();
        const row = { id, ...data };
        store.leads.push(row);
        return row;
      }),
    },
    relationshipEdge: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = nextId();
        const row = { id, ...data };
        store.edges.push(row);
        return row;
      }),
    },
  },
}));

import { scrapeOneSource } from "../scrapeOneSource";

// ── Fixtures ────────────────────────────────────────────────────────────────

function seedSource(): string {
  const id = "src_test_1";
  store.sources.set(id, {
    id,
    name: "Ankeny P&Z",
    url: "https://example.gov",
    jurisdiction: "Ankeny",
    sourceType: "planning_commission",
    isActive: true,
    dateFrom: null,
    dateTo: null,
    minRelevanceScore: 60,
    minEstimatedValue: null,
    projectTypeAllowlist: null,
    prefilterMode: "off",
    prefilterCharThreshold: 30000,
    prefilterModel: null,
    publishStatus: "HEALTHY",
    consecutiveEmptyRuns: 0,
    lastEmptyRunAt: null,
    lastScannedAt: null,
    nextExpectedAt: null,
  });
  return id;
}

function mixedScrapeResponse() {
  return {
    docs_found: 1, docs_in_range: 1, docs_scanned: 1, docs_skipped: 0,
    docs_dropped_date: 0, docs_dropped_undated: 0,
    docs_prefilter_applied: 0, docs_prefilter_skipped: 0, docs_prefilter_failed: 0,
    total_chars_saved: 0, total_cost_usd: 0.05,
    results: [{
      doc_url: "u", doc_url_full: "u", title: "May 21 P&Z Agenda",
      jurisdiction: "Ankeny", document_date: "2026-05-21",
      raw_text: "Body content for hashing purposes",
      char_count: 100, cost_usd: 0.05, input_tokens: 0, output_tokens: 0,
      prefilter_used: "none" as const, prefilter_chars_in: 0, prefilter_chars_out: 0,
      signals: [
        // Substantive — should persist
        { signal_type: "meeting_minute", signal_subtype: "ANNEXATION", headline: "Annexation of 80 acres east of I-35", relevance_score: 85 },
        { signal_type: "meeting_minute", signal_subtype: "SITE_PLAN", headline: "Site plan approval for distribution center", relevance_score: 80,
          owner_name: "Knapp Properties" },
        // Ceremonial — should be suppressed by hard-drop rule
        { signal_type: "meeting_minute", signal_subtype: null, headline: "Roll Call", relevance_score: 70 },
        { signal_type: "meeting_minute", signal_subtype: null, headline: "Approval of the Agenda", relevance_score: 70 },
      ],
      relationships: [],
    }],
  };
}

beforeEach(() => {
  store.sources.clear();
  store.docs.length = 0;
  store.signals.length = 0;
  store.leads.length = 0;
  store.edges.length = 0;
  store.counter = 0;

  callSidecarScrape.mockReset();
  scrapeEnergovSource.mockReset();
  buildHeuristicsContext.mockReset();
  recordDocDate.mockReset();
  recomputeCadence.mockReset();
  recordRunOutcome.mockReset();
  processNewMarketSignal.mockReset();
  processNewMarketLead.mockReset();
  processNewRelationshipEdge.mockReset();
  recordSignalSuppression.mockClear();
  recordSignalClassification.mockClear();
  recordIngestionProcessed.mockClear();
  recordIngestionDuration.mockClear();
  recordIngestionPipelineError.mockClear();
  computeDocPacketHash.mockClear();

  // Sensible defaults.
  buildHeuristicsContext.mockResolvedValue({
    recentDeveloperNames: new Set<string>(),
    recentParcels: new Set<string>(),
    recentJurisdictions: new Map<string, number>(),
    recentHeadlines: [],
    recentDocHashes: new Set<string>(),
    projectKeyMeetingCounts: new Map<string, number>(),
  });
  recomputeCadence.mockResolvedValue({
    publishCadenceDays: null, confidence: null, sampleSize: 0,
    lastDocSeenAt: null, nextExpectedAt: null,
  });
  recordRunOutcome.mockResolvedValue({ publishStatus: "HEALTHY", consecutiveEmptyRuns: 0 });
  processNewMarketSignal.mockImplementation(async (id: string) => ({
    ok: true, sourceKind: "MARKET_SIGNAL", sourceId: id, decision: "create_new",
    projectId: "p1", projectSignalId: "ps1", createdNewProject: true,
    audit: { timestamp: new Date().toISOString(), sourceKind: "MARKET_SIGNAL", sourceId: id, decision: "create_new",
      projectId: "p1", attachScore: 1, reason: "test",
      ingestionVersion: "v1", resolverVersion: "v1", aggregatorVersion: "v1",
      actorUserId: null, actorEmail: null },
  }));
  processNewMarketLead.mockImplementation(async () => ({ ok: true, sourceKind: "MARKET_LEAD" }));
  processNewRelationshipEdge.mockImplementation(async () => ({ ok: true, sourceKind: "RELATIONSHIP_EDGE" }));

  process.env.SCRAPE_BRIDGE_AUDIT_QUIET = "true";
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("scrapeOneSource — heuristics integration (PR3)", () => {
  test("ceremonial signals suppressed; substantive signals persisted with heuristics metadata", async () => {
    seedSource();
    callSidecarScrape.mockResolvedValue(mixedScrapeResponse());

    const result = await scrapeOneSource("src_test_1");

    // 2 substantive signals persisted, 2 ceremonial suppressed.
    expect(store.signals).toHaveLength(2);
    expect(result.signalsCreated).toBe(2);
    expect(result.signalsSuppressedHeuristics).toBe(2);
    expect(result.heuristicsApplied).toBe(true);

    // Each persisted signal carries heuristics columns.
    for (const sig of store.signals) {
      expect(sig.heuristicsVersion).toBe("v2");
      expect(typeof sig.heuristicsScore).toBe("number");
      expect(typeof sig.heuristicsClassification).toBe("string");
      expect(["HIGH_EMERGENCE", "MEDIUM_EMERGENCE", "LOW_EMERGENCE"]).toContain(sig.heuristicsClassification as string);
      expect(typeof sig.heuristicsJson).toBe("string");
      // factor JSON is a valid array
      const factors = JSON.parse(sig.heuristicsJson as string);
      expect(Array.isArray(factors)).toBe(true);
    }

    // ANNEXATION signal classified HIGH (subtype boost + base 0.35 = 0.65 — actually
    // let's not pin exact band, just verify it's not SUPPRESSED).
    const annexationSig = store.signals.find((s) => (s.headline as string).includes("Annexation"));
    expect(annexationSig).toBeDefined();
    expect(annexationSig!.heuristicsClassification).not.toBe("SUPPRESSED");
  });

  test("suppression metric fires for each ceremonial signal; classification metric fires for each persisted signal", async () => {
    seedSource();
    callSidecarScrape.mockResolvedValue(mixedScrapeResponse());
    await scrapeOneSource("src_test_1");

    expect(recordSignalSuppression).toHaveBeenCalledTimes(2);
    expect(recordSignalSuppression).toHaveBeenCalledWith("SUPPRESSED");
    expect(recordSignalClassification).toHaveBeenCalledTimes(2);
  });

  test("live-ingestion bridge fires only for the 2 persisted signals (+ their 2 high-relevance leads), not the suppressed ones", async () => {
    seedSource();
    callSidecarScrape.mockResolvedValue(mixedScrapeResponse());
    const result = await scrapeOneSource("src_test_1");

    // Each substantive signal also creates a high-relevance MarketLead
    // (relevance ≥ 60 triggers lead creation in persistSidecarPayload).
    // Ceremonial signals are suppressed BEFORE the lead branch runs.
    expect(processNewMarketSignal).toHaveBeenCalledTimes(2);
    expect(processNewMarketLead).toHaveBeenCalledTimes(2);
    expect(result.ingestion.ingested).toBe(4); // 2 signals + 2 leads
    expect(result.ingestion.failed).toBe(0);
    expect(recordIngestionProcessed).toHaveBeenCalledTimes(4);
  });

  test("cadence: recordDocDate called per doc with documentDate; recomputeCadence + recordRunOutcome called once", async () => {
    seedSource();
    callSidecarScrape.mockResolvedValue(mixedScrapeResponse());
    await scrapeOneSource("src_test_1");

    expect(recordDocDate).toHaveBeenCalledTimes(1); // one doc with a date
    expect(recordDocDate).toHaveBeenCalledWith("src_test_1", new Date("2026-05-21"));
    expect(recomputeCadence).toHaveBeenCalledTimes(1);
    expect(recordRunOutcome).toHaveBeenCalledTimes(1);
    expect(recordRunOutcome).toHaveBeenCalledWith("src_test_1", /* foundNewDocs */ true);
  });

  test("recordRunOutcome's returned publishStatus appears on the result", async () => {
    seedSource();
    callSidecarScrape.mockResolvedValue(mixedScrapeResponse());
    recordRunOutcome.mockResolvedValue({ publishStatus: "STALE_PUBLISH", consecutiveEmptyRuns: 3 });
    const result = await scrapeOneSource("src_test_1");
    expect(result.publishStatus).toBe("STALE_PUBLISH");
    expect(result.consecutiveEmptyRuns).toBe(3);
  });

  test("buildHeuristicsContext called exactly once per source (not per doc)", async () => {
    seedSource();
    callSidecarScrape.mockResolvedValue({
      ...mixedScrapeResponse(),
      docs_found: 3, docs_in_range: 3, docs_scanned: 3,
      results: [
        ...mixedScrapeResponse().results,
        { ...mixedScrapeResponse().results[0], doc_url: "u2", doc_url_full: "u2" },
        { ...mixedScrapeResponse().results[0], doc_url: "u3", doc_url_full: "u3" },
      ],
    });
    await scrapeOneSource("src_test_1");
    expect(buildHeuristicsContext).toHaveBeenCalledTimes(1);
  });

  test("docPacketHash computed once per doc with rawText and passed through (DUPLICATE_PACKET hard-drop suppresses all signals)", async () => {
    seedSource();
    // Seed context so that DUPLICATE_PACKET fires for this doc's hash.
    buildHeuristicsContext.mockResolvedValue({
      recentDeveloperNames: new Set<string>(),
      recentParcels: new Set<string>(),
      recentJurisdictions: new Map(),
      recentHeadlines: [],
      recentDocHashes: new Set<string>(["hash:Body con"]), // matches computeDocPacketHash mock
      projectKeyMeetingCounts: new Map(),
    });
    callSidecarScrape.mockResolvedValue(mixedScrapeResponse());

    const result = await scrapeOneSource("src_test_1");

    // All 4 signals suppressed via DUPLICATE_PACKET hard-drop.
    expect(store.signals).toHaveLength(0);
    expect(result.signalsSuppressedHeuristics).toBe(4);
    expect(result.signalsCreated).toBe(0);
    expect(processNewMarketSignal).not.toHaveBeenCalled();
  });
});

describe("scrapeOneSource — skipHeuristics flag (PR3)", () => {
  test("skipHeuristics=true bypasses classifier entirely; all signals persisted, none suppressed, no heuristics columns", async () => {
    seedSource();
    callSidecarScrape.mockResolvedValue(mixedScrapeResponse());
    const result = await scrapeOneSource("src_test_1", { skipHeuristics: true });

    expect(buildHeuristicsContext).not.toHaveBeenCalled();
    expect(recordSignalSuppression).not.toHaveBeenCalled();
    expect(recordSignalClassification).not.toHaveBeenCalled();

    // All 4 signals persisted (ceremonial included — that's the point of the override).
    expect(store.signals).toHaveLength(4);
    expect(result.signalsCreated).toBe(4);
    expect(result.signalsSuppressedHeuristics).toBe(0);
    expect(result.heuristicsApplied).toBe(false);

    // No heuristics columns populated.
    for (const sig of store.signals) {
      expect(sig.heuristicsVersion).toBeNull();
      expect(sig.heuristicsScore).toBeNull();
      expect(sig.heuristicsClassification).toBeNull();
      expect(sig.heuristicsJson).toBeNull();
    }
  });

  test("cadence calls still fire when skipHeuristics=true (cadence is independent of hygiene)", async () => {
    seedSource();
    callSidecarScrape.mockResolvedValue(mixedScrapeResponse());
    await scrapeOneSource("src_test_1", { skipHeuristics: true });

    expect(recordDocDate).toHaveBeenCalledTimes(1);
    expect(recomputeCadence).toHaveBeenCalledTimes(1);
    expect(recordRunOutcome).toHaveBeenCalledTimes(1);
  });
});

describe("scrapeOneSource — empty scrape (PR3 cadence dormancy)", () => {
  test("zero new docs → recordRunOutcome called with foundNewDocs=false", async () => {
    seedSource();
    callSidecarScrape.mockResolvedValue({
      docs_found: 0, docs_in_range: 0, docs_scanned: 0, docs_skipped: 0,
      docs_dropped_date: 0, docs_dropped_undated: 0,
      docs_prefilter_applied: 0, docs_prefilter_skipped: 0, docs_prefilter_failed: 0,
      total_chars_saved: 0, total_cost_usd: 0,
      results: [],
    });
    await scrapeOneSource("src_test_1");

    expect(recordRunOutcome).toHaveBeenCalledWith("src_test_1", false);
    expect(recordDocDate).not.toHaveBeenCalled();
    expect(recomputeCadence).toHaveBeenCalledTimes(1); // still recomputed (cheap no-op)
  });
});

describe("scrapeOneSource — EnerGov path (PR3 cadence semantics)", () => {
  test("EnerGov bypasses heuristics in PR3; still calls recordRunOutcome for dormancy tracking", async () => {
    store.sources.set("src_energov_1", {
      id: "src_energov_1",
      name: "WDM EnerGov",
      url: "https://wdm.gov/energov",
      jurisdiction: "West Des Moines",
      sourceType: "energov",
      isActive: true,
      dateFrom: null, dateTo: null,
      publishStatus: "HEALTHY",
      consecutiveEmptyRuns: 0,
    });
    scrapeEnergovSource.mockResolvedValue({
      docsScanned: 3, signalsCreated: 3, leadsCreated: 1,
      highValueRecords: 1, rawRecordsReturned: 25,
      createdSignalIds: ["e1", "e2", "e3"],
      createdLeadIds: ["el1"],
    });
    const result = await scrapeOneSource("src_energov_1");

    expect(result.engine).toBe("energov");
    expect(result.heuristicsApplied).toBe(false);
    expect(result.signalsSuppressedHeuristics).toBe(0);
    expect(buildHeuristicsContext).not.toHaveBeenCalled();
    expect(recordDocDate).not.toHaveBeenCalled();
    expect(recomputeCadence).not.toHaveBeenCalled();
    // Dormancy detection still works on EnerGov.
    expect(recordRunOutcome).toHaveBeenCalledWith("src_energov_1", true);
  });
});

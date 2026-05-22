// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/__tests__/scrapeOneSource.test.ts
//  O2.2 PR1 — Verify the scrape→ingestion bridge.
//
//  Covered:
//   - sidecar path invokes persistSidecarPayload, then bridges every created
//     row to liveIngestion (processNewMarketSignal / Lead / Edge once each)
//   - EnerGov path invokes scrapeEnergovSource, then bridges
//   - ingestion failure (thrown OR ok:false) is tallied, never re-throws,
//     never blocks subsequent ingestions
//   - persisted MarketSignal row is preserved even when its ingestion call
//     throws (no rollback)
//   - empty scrape (zero new rows) → ingestion summary is empty, no
//     processNewMarketSignal call is made
//   - 404 / 400 mapping via ScrapeOneSourceError
//   - neuroglitch_ingestion_processed_total counter receives an increment
//     for every successful ingestion
// ──────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ── All mock fns hoisted so vi.mock factories can reference them safely ────
const {
  recordIngestionProcessed,
  recordIngestionDuration,
  recordIngestionPipelineError,
  processNewMarketSignal,
  processNewMarketLead,
  processNewRelationshipEdge,
  callSidecarScrape,
  persistSidecarPayload,
  scrapeEnergovSource,
} = vi.hoisted(() => ({
  recordIngestionProcessed: vi.fn(),
  recordIngestionDuration: vi.fn(),
  recordIngestionPipelineError: vi.fn(),
  processNewMarketSignal: vi.fn(),
  processNewMarketLead: vi.fn(),
  processNewRelationshipEdge: vi.fn(),
  callSidecarScrape: vi.fn(),
  persistSidecarPayload: vi.fn(),
  scrapeEnergovSource: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({
  recordIngestionProcessed,
  recordIngestionDuration,
  recordIngestionPipelineError,
}));

vi.mock("@/lib/services/liveIngestion", () => ({
  processNewMarketSignal,
  processNewMarketLead,
  processNewRelationshipEdge,
}));

vi.mock("../sidecarMarket", () => ({
  callSidecarScrape,
  persistSidecarPayload,
}));
vi.mock("../energovAdapter", () => ({
  scrapeEnergovSource,
}));

// ── Mock @/lib/prisma with the surface scrapeOneSource uses ────────────────
type SourceRow = {
  id: string;
  name: string;
  url: string;
  jurisdiction: string;
  sourceType: string;
  isActive: boolean;
  dateFrom: Date | null;
  dateTo: Date | null;
  minRelevanceScore: number;
  minEstimatedValue: number | null;
  projectTypeAllowlist: string | null;
  prefilterMode?: string;
  prefilterCharThreshold?: number;
  prefilterModel?: string | null;
};

const { store } = vi.hoisted(() => ({
  store: {
    sources: new Map<string, SourceRow>(),
    docs: [] as Array<{ id: string; sourceId: string; docUrl: string }>,
    sourceUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
    docUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
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
      // O2.2 PR3: the source row now carries publishStatus + consecutiveEmptyRuns
      // + nextExpectedAt — the cadence module reads those. Mock returns sensible
      // defaults when the original seed didn't set them.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const src = store.sources.get(where.id);
        if (!src) return null;
        return {
          ...src,
          publishStatus: (src as Record<string, unknown>).publishStatus ?? "HEALTHY",
          consecutiveEmptyRuns: (src as Record<string, unknown>).consecutiveEmptyRuns ?? 0,
          lastEmptyRunAt: (src as Record<string, unknown>).lastEmptyRunAt ?? null,
          lastScannedAt: (src as Record<string, unknown>).lastScannedAt ?? null,
          nextExpectedAt: (src as Record<string, unknown>).nextExpectedAt ?? null,
        };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        store.sourceUpdates.push({ id: where.id, data });
        // Apply update to the in-memory row so subsequent findUnique observes
        // the new publishStatus / consecutiveEmptyRuns values.
        const src = store.sources.get(where.id);
        if (src) Object.assign(src, data);
        return { id: where.id, ...data };
      }),
    },
    marketSourceDoc: {
      // The prior test used { where: { sourceId } } shape (PR1). The cadence
      // context builder also calls this with select+orderBy+take. We support
      // both shapes minimally.
      findMany: vi.fn(async (args: {
        where: { sourceId: string };
        select?: Record<string, boolean>;
        orderBy?: unknown;
        take?: number;
      }) => {
        const rows = store.docs
          .filter((d) => d.sourceId === args.where.sourceId)
          .slice(0, args.take ?? undefined);
        if (!args.select) {
          return rows.map((d) => ({ docUrl: d.docUrl }));
        }
        return rows.map((d) => {
          const out: Record<string, unknown> = {};
          if (args.select?.id) out.id = (d as Record<string, unknown>).id;
          if (args.select?.docUrl) out.docUrl = d.docUrl;
          if (args.select?.rawText) out.rawText = (d as Record<string, unknown>).rawText ?? null;
          return out;
        });
      }),
      upsert: vi.fn(async ({ where, create }: { where: { sourceId_docUrl: { sourceId: string; docUrl: string } }; create: Record<string, unknown> }) => {
        const existing = store.docs.find(
          (d) => d.sourceId === where.sourceId_docUrl.sourceId && d.docUrl === where.sourceId_docUrl.docUrl,
        );
        if (existing) return { id: (existing as Record<string, unknown>).id ?? "existing", ...create };
        const id = nextId();
        const row = { id, sourceId: where.sourceId_docUrl.sourceId, docUrl: where.sourceId_docUrl.docUrl };
        store.docs.push(row);
        return { id, ...create };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        store.docUpdates.push({ id: where.id, data });
        return { id: where.id, ...data };
      }),
    },
    // O2.2 PR3: heuristic context loader reads recent signals. Default = empty.
    marketSignal: {
      findMany: vi.fn(async () => []),
    },
    // O2.2 PR3: cadence sample table — used by recordDocDate + recomputeCadence.
    marketSourceCadenceSample: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: nextId(), ...data })),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

// Import AFTER all mocks are registered.
import { scrapeOneSource, ScrapeOneSourceError } from "../scrapeOneSource";

// ── Helpers ────────────────────────────────────────────────────────────────

function seedSidecarSource(over: Partial<SourceRow> = {}): SourceRow {
  const row: SourceRow = {
    id: "src_sidecar_1",
    name: "Ankeny P&Z",
    url: "https://example.gov/p&z",
    jurisdiction: "Ankeny",
    sourceType: "planning_commission",
    isActive: true,
    dateFrom: null,
    dateTo: null,
    minRelevanceScore: 60,
    minEstimatedValue: null,
    projectTypeAllowlist: null,
    ...over,
  };
  store.sources.set(row.id, row);
  return row;
}

function seedEnergovSource(over: Partial<SourceRow> = {}): SourceRow {
  const row: SourceRow = {
    id: "src_energov_1",
    name: "WDM EnerGov",
    url: "https://wdm.gov/energov",
    jurisdiction: "West Des Moines",
    sourceType: "energov",
    isActive: true,
    dateFrom: null,
    dateTo: null,
    minRelevanceScore: 60,
    minEstimatedValue: null,
    projectTypeAllowlist: null,
    ...over,
  };
  store.sources.set(row.id, row);
  return row;
}

function makeOkResult(sourceKind: "MARKET_SIGNAL" | "MARKET_LEAD" | "RELATIONSHIP_EDGE", sourceId: string, decision = "create_new") {
  return {
    ok: true as const,
    sourceKind,
    sourceId,
    decision,
    projectId: "proj_1",
    projectSignalId: "ps_1",
    createdNewProject: true,
    audit: {
      timestamp: new Date().toISOString(),
      sourceKind,
      sourceId,
      decision,
      projectId: "proj_1",
      attachScore: 1.0,
      reason: "test",
      ingestionVersion: "v1",
      resolverVersion: "v1",
      aggregatorVersion: "v1",
      actorUserId: null,
      actorEmail: null,
    },
  };
}

// ── Reset between tests ────────────────────────────────────────────────────

beforeEach(() => {
  store.sources.clear();
  store.docs.length = 0;
  store.sourceUpdates.length = 0;
  store.docUpdates.length = 0;
  store.counter = 0;

  recordIngestionProcessed.mockClear();
  recordIngestionDuration.mockClear();
  recordIngestionPipelineError.mockClear();
  processNewMarketSignal.mockReset();
  processNewMarketLead.mockReset();
  processNewRelationshipEdge.mockReset();
  callSidecarScrape.mockReset();
  persistSidecarPayload.mockReset();
  scrapeEnergovSource.mockReset();

  // Silence the bridge audit so test output stays clean.
  process.env.SCRAPE_BRIDGE_AUDIT_QUIET = "true";
});

afterEach(() => {
  delete process.env.SCRAPE_BRIDGE_AUDIT_QUIET;
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("scrapeOneSource — sidecar path", () => {
  test("invokes persistSidecarPayload and bridges every created row to liveIngestion", async () => {
    seedSidecarSource();

    callSidecarScrape.mockResolvedValue({
      docs_found: 1,
      docs_in_range: 1,
      docs_scanned: 1,
      docs_skipped: 0,
      docs_dropped_date: 0,
      docs_dropped_undated: 0,
      docs_prefilter_applied: 0,
      docs_prefilter_skipped: 0,
      docs_prefilter_failed: 0,
      total_chars_saved: 0,
      total_cost_usd: 0.05,
      results: [
        {
          doc_url: "https://example.gov/p&z/agenda-2026-05-21.pdf",
          doc_url_full: "https://example.gov/p&z/agenda-2026-05-21.pdf?v=1",
          title: "May 21 P&Z",
          signals: [{ signal_type: "meeting_minute", headline: "Rezoning at 123 Main", relevance_score: 80 }],
          relationships: [],
          jurisdiction: "Ankeny",
          document_date: "2026-05-21",
          raw_text: "...",
          char_count: 1234,
          cost_usd: 0.05,
          input_tokens: 100,
          output_tokens: 50,
          prefilter_used: "none" as const,
          prefilter_chars_in: 0,
          prefilter_chars_out: 0,
        },
      ],
    });

    persistSidecarPayload.mockResolvedValue({
      signalsCreated: 2,
      leadsCreated: 1,
      relationshipsCreated: 1,
      signalsDroppedRelevance: 0,
      signalsDroppedProjectType: 0,
      leadsDroppedValue: 0,
      createdSignalIds: ["sig_a", "sig_b"],
      createdLeadIds: ["lead_a"],
      createdEdgeIds: ["edge_a"],
      signalsSuppressedHeuristics: 0,
      classifiedByBand: {},
    });

    processNewMarketSignal.mockImplementation(async (id: string) => makeOkResult("MARKET_SIGNAL", id, "create_new"));
    processNewMarketLead.mockImplementation(async (id: string) => makeOkResult("MARKET_LEAD", id, "attach_to_existing"));
    processNewRelationshipEdge.mockImplementation(async (id: string) => makeOkResult("RELATIONSHIP_EDGE", id, "needs_review"));

    const result = await scrapeOneSource("src_sidecar_1");

    expect(persistSidecarPayload).toHaveBeenCalledTimes(1);

    expect(processNewMarketSignal).toHaveBeenCalledTimes(2);
    expect(processNewMarketSignal).toHaveBeenNthCalledWith(1, "sig_a", { actor: undefined });
    expect(processNewMarketSignal).toHaveBeenNthCalledWith(2, "sig_b", { actor: undefined });

    expect(processNewMarketLead).toHaveBeenCalledTimes(1);
    expect(processNewMarketLead).toHaveBeenCalledWith("lead_a", { actor: undefined });

    expect(processNewRelationshipEdge).toHaveBeenCalledTimes(1);
    expect(processNewRelationshipEdge).toHaveBeenCalledWith("edge_a", { actor: undefined });

    expect(result.engine).toBe("sidecar");
    expect(result.signalsCreated).toBe(2);
    expect(result.leadsCreated).toBe(1);
    expect(result.relationshipsCreated).toBe(1);
    expect(result.ingestion.ingested).toBe(4);
    expect(result.ingestion.failed).toBe(0);
    expect(result.ingestion.bySourceKind).toEqual({
      MARKET_SIGNAL: 2,
      MARKET_LEAD: 1,
      RELATIONSHIP_EDGE: 1,
    });
    expect(result.ingestion.decisions).toEqual({
      create_new: 2,
      attach_to_existing: 1,
      needs_review: 1,
    });
  });

  test("liveIngestion throw on one signal does not block subsequent signals and does not undo persistence", async () => {
    seedSidecarSource();
    callSidecarScrape.mockResolvedValue({
      docs_found: 1, docs_in_range: 1, docs_scanned: 1, docs_skipped: 0,
      docs_dropped_date: 0, docs_dropped_undated: 0,
      docs_prefilter_applied: 0, docs_prefilter_skipped: 0, docs_prefilter_failed: 0,
      total_chars_saved: 0, total_cost_usd: 0,
      results: [{
        doc_url: "u", doc_url_full: "u", title: null,
        signals: [], relationships: [],
        jurisdiction: null, document_date: null,
        raw_text: null, char_count: 0, cost_usd: 0,
        input_tokens: 0, output_tokens: 0,
        prefilter_used: "none" as const, prefilter_chars_in: 0, prefilter_chars_out: 0,
      }],
    });
    persistSidecarPayload.mockResolvedValue({
      signalsCreated: 3, leadsCreated: 0, relationshipsCreated: 0,
      signalsDroppedRelevance: 0, signalsDroppedProjectType: 0, leadsDroppedValue: 0,
      createdSignalIds: ["sig_x", "sig_boom", "sig_z"],
      createdLeadIds: [], createdEdgeIds: [],
      signalsSuppressedHeuristics: 0,
      classifiedByBand: {},
    });

    processNewMarketSignal.mockImplementation(async (id: string) => {
      if (id === "sig_boom") throw new Error("simulated ingestion crash");
      return makeOkResult("MARKET_SIGNAL", id);
    });

    const result = await scrapeOneSource("src_sidecar_1");

    // All three IDs attempted — failure on sig_boom did NOT abort the loop.
    expect(processNewMarketSignal).toHaveBeenCalledTimes(3);

    // Persistence stage is unchanged (signalsCreated still 3) — no rollback.
    expect(result.signalsCreated).toBe(3);

    // Ingestion summary reflects the failure.
    expect(result.ingestion.ingested).toBe(2);
    expect(result.ingestion.failed).toBe(1);
    expect(result.ingestion.failures).toHaveLength(1);
    expect(result.ingestion.failures[0]).toMatchObject({
      sourceKind: "MARKET_SIGNAL",
      sourceId: "sig_boom",
    });
    expect(recordIngestionPipelineError).toHaveBeenCalledWith("scrape_bridge:MARKET_SIGNAL");
  });

  test("liveIngestion ok=false return is tallied as a failure, not a success", async () => {
    seedSidecarSource();
    callSidecarScrape.mockResolvedValue({
      docs_found: 1, docs_in_range: 1, docs_scanned: 1, docs_skipped: 0,
      docs_dropped_date: 0, docs_dropped_undated: 0,
      docs_prefilter_applied: 0, docs_prefilter_skipped: 0, docs_prefilter_failed: 0,
      total_chars_saved: 0, total_cost_usd: 0,
      results: [{
        doc_url: "u", doc_url_full: "u", title: null,
        signals: [], relationships: [],
        jurisdiction: null, document_date: null,
        raw_text: null, char_count: 0, cost_usd: 0,
        input_tokens: 0, output_tokens: 0,
        prefilter_used: "none" as const, prefilter_chars_in: 0, prefilter_chars_out: 0,
      }],
    });
    persistSidecarPayload.mockResolvedValue({
      signalsCreated: 1, leadsCreated: 0, relationshipsCreated: 0,
      signalsDroppedRelevance: 0, signalsDroppedProjectType: 0, leadsDroppedValue: 0,
      createdSignalIds: ["sig_missing"], createdLeadIds: [], createdEdgeIds: [],
      signalsSuppressedHeuristics: 0,
      classifiedByBand: {},
    });

    processNewMarketSignal.mockResolvedValue({
      ok: false,
      sourceKind: "MARKET_SIGNAL",
      sourceId: "sig_missing",
      decision: "skipped",
      projectId: null,
      projectSignalId: null,
      createdNewProject: false,
      audit: {
        timestamp: new Date().toISOString(),
        sourceKind: "MARKET_SIGNAL",
        sourceId: "sig_missing",
        decision: "skipped",
        projectId: null,
        attachScore: null,
        reason: "signal not found",
        ingestionVersion: "v1",
        resolverVersion: "v1",
        aggregatorVersion: "v1",
        actorUserId: null,
        actorEmail: null,
      },
      error: "MarketSignal not found",
    });

    const result = await scrapeOneSource("src_sidecar_1");

    expect(result.ingestion.ingested).toBe(0);
    expect(result.ingestion.failed).toBe(1);
    expect(result.ingestion.failures[0]?.error).toBe("MarketSignal not found");
    expect(recordIngestionProcessed).not.toHaveBeenCalled();
  });

  test("empty scrape (zero new rows) → no ingestion calls, empty summary", async () => {
    seedSidecarSource();
    callSidecarScrape.mockResolvedValue({
      docs_found: 0, docs_in_range: 0, docs_scanned: 0, docs_skipped: 0,
      docs_dropped_date: 0, docs_dropped_undated: 0,
      docs_prefilter_applied: 0, docs_prefilter_skipped: 0, docs_prefilter_failed: 0,
      total_chars_saved: 0, total_cost_usd: 0,
      results: [],
    });

    const result = await scrapeOneSource("src_sidecar_1");

    expect(persistSidecarPayload).not.toHaveBeenCalled();
    expect(processNewMarketSignal).not.toHaveBeenCalled();
    expect(processNewMarketLead).not.toHaveBeenCalled();
    expect(processNewRelationshipEdge).not.toHaveBeenCalled();
    expect(result.ingestion.ingested).toBe(0);
    expect(result.ingestion.failed).toBe(0);
    expect(result.signalsCreated).toBe(0);
  });

  test("idempotent re-run: persistSidecarPayload returning zero new IDs → zero ingestion calls", async () => {
    seedSidecarSource();
    callSidecarScrape.mockResolvedValue({
      docs_found: 1, docs_in_range: 1, docs_scanned: 1, docs_skipped: 0,
      docs_dropped_date: 0, docs_dropped_undated: 0,
      docs_prefilter_applied: 0, docs_prefilter_skipped: 0, docs_prefilter_failed: 0,
      total_chars_saved: 0, total_cost_usd: 0,
      results: [{
        doc_url: "u", doc_url_full: "u", title: null,
        signals: [], relationships: [],
        jurisdiction: null, document_date: null,
        raw_text: null, char_count: 0, cost_usd: 0,
        input_tokens: 0, output_tokens: 0,
        prefilter_used: "none" as const, prefilter_chars_in: 0, prefilter_chars_out: 0,
      }],
    });
    // No new IDs — simulating a re-scrape of an already-seen doc.
    persistSidecarPayload.mockResolvedValue({
      signalsCreated: 0, leadsCreated: 0, relationshipsCreated: 0,
      signalsDroppedRelevance: 0, signalsDroppedProjectType: 0, leadsDroppedValue: 0,
      createdSignalIds: [], createdLeadIds: [], createdEdgeIds: [],
      signalsSuppressedHeuristics: 0,
      classifiedByBand: {},
    });

    const result = await scrapeOneSource("src_sidecar_1");

    expect(processNewMarketSignal).not.toHaveBeenCalled();
    expect(result.ingestion.ingested).toBe(0);
    expect(result.ingestion.failed).toBe(0);
  });

  test("metric: recordIngestionProcessed called once per successful ingestion with (kind, decision)", async () => {
    seedSidecarSource();
    callSidecarScrape.mockResolvedValue({
      docs_found: 1, docs_in_range: 1, docs_scanned: 1, docs_skipped: 0,
      docs_dropped_date: 0, docs_dropped_undated: 0,
      docs_prefilter_applied: 0, docs_prefilter_skipped: 0, docs_prefilter_failed: 0,
      total_chars_saved: 0, total_cost_usd: 0,
      results: [{
        doc_url: "u", doc_url_full: "u", title: null,
        signals: [], relationships: [],
        jurisdiction: null, document_date: null,
        raw_text: null, char_count: 0, cost_usd: 0,
        input_tokens: 0, output_tokens: 0,
        prefilter_used: "none" as const, prefilter_chars_in: 0, prefilter_chars_out: 0,
      }],
    });
    persistSidecarPayload.mockResolvedValue({
      signalsCreated: 2, leadsCreated: 0, relationshipsCreated: 0,
      signalsDroppedRelevance: 0, signalsDroppedProjectType: 0, leadsDroppedValue: 0,
      createdSignalIds: ["s1", "s2"], createdLeadIds: [], createdEdgeIds: [],
      signalsSuppressedHeuristics: 0,
      classifiedByBand: {},
    });
    processNewMarketSignal
      .mockResolvedValueOnce(makeOkResult("MARKET_SIGNAL", "s1", "create_new"))
      .mockResolvedValueOnce(makeOkResult("MARKET_SIGNAL", "s2", "attach_to_existing"));

    await scrapeOneSource("src_sidecar_1");

    expect(recordIngestionProcessed).toHaveBeenCalledTimes(2);
    expect(recordIngestionProcessed).toHaveBeenNthCalledWith(1, "MARKET_SIGNAL", "create_new");
    expect(recordIngestionProcessed).toHaveBeenNthCalledWith(2, "MARKET_SIGNAL", "attach_to_existing");
    expect(recordIngestionDuration).toHaveBeenCalledTimes(2);
  });
});

describe("scrapeOneSource — energov path", () => {
  test("invokes scrapeEnergovSource and bridges signals + leads (no edges)", async () => {
    seedEnergovSource();
    scrapeEnergovSource.mockResolvedValue({
      docsScanned: 5,
      signalsCreated: 5,
      leadsCreated: 2,
      highValueRecords: 1,
      rawRecordsReturned: 25,
      createdSignalIds: ["e_sig_1", "e_sig_2", "e_sig_3", "e_sig_4", "e_sig_5"],
      createdLeadIds: ["e_lead_1", "e_lead_2"],
    });

    processNewMarketSignal.mockImplementation(async (id: string) => makeOkResult("MARKET_SIGNAL", id));
    processNewMarketLead.mockImplementation(async (id: string) => makeOkResult("MARKET_LEAD", id, "attach_to_existing"));

    const result = await scrapeOneSource("src_energov_1");

    expect(scrapeEnergovSource).toHaveBeenCalledTimes(1);
    expect(callSidecarScrape).not.toHaveBeenCalled();
    expect(persistSidecarPayload).not.toHaveBeenCalled();

    expect(processNewMarketSignal).toHaveBeenCalledTimes(5);
    expect(processNewMarketLead).toHaveBeenCalledTimes(2);
    expect(processNewRelationshipEdge).not.toHaveBeenCalled();

    expect(result.engine).toBe("energov");
    expect(result.ingestion.ingested).toBe(7);
    expect(result.ingestion.bySourceKind.MARKET_SIGNAL).toBe(5);
    expect(result.ingestion.bySourceKind.MARKET_LEAD).toBe(2);
    expect(result.ingestion.bySourceKind.RELATIONSHIP_EDGE).toBe(0);
  });
});

describe("scrapeOneSource — error mapping", () => {
  test("missing source → ScrapeOneSourceError kind=not_found", async () => {
    await expect(scrapeOneSource("does_not_exist")).rejects.toMatchObject({
      name: "ScrapeOneSourceError",
      kind: "not_found",
    });
  });

  test("inactive source → ScrapeOneSourceError kind=inactive", async () => {
    seedSidecarSource({ isActive: false });
    await expect(scrapeOneSource("src_sidecar_1")).rejects.toMatchObject({
      name: "ScrapeOneSourceError",
      kind: "inactive",
    });
  });

  test("sidecar throw → ScrapeOneSourceError kind=upstream", async () => {
    seedSidecarSource();
    callSidecarScrape.mockRejectedValue(new Error("Sidecar scrape failed: HTTP 504"));
    await expect(scrapeOneSource("src_sidecar_1")).rejects.toMatchObject({
      name: "ScrapeOneSourceError",
      kind: "upstream",
    });
  });
});

describe("ScrapeOneSourceError class", () => {
  test("kind is preserved and message is forwarded", () => {
    const e = new ScrapeOneSourceError("upstream", "boom");
    expect(e.kind).toBe("upstream");
    expect(e.message).toBe("boom");
    expect(e.name).toBe("ScrapeOneSourceError");
    expect(e instanceof Error).toBe(true);
  });
});

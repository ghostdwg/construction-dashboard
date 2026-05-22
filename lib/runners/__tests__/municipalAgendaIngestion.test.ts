// ──────────────────────────────────────────────────────────────────────────────
//  lib/runners/__tests__/municipalAgendaIngestion.test.ts
//  Phase O2.2 PR4 — End-to-end runner-body tests.
//
//  Mocks the boundary modules (selectDueSources, scrapeOneSource, metrics)
//  and exercises the registered runner via dispatcher.runCycle. Verifies:
//    * Lease behavior (single + double invocation → second preempted)
//    * Heartbeat semantics (false return aborts)
//    * Per-source try/catch isolation (one failure does not poison cycle)
//    * Result aggregation
//    * Metric emission
//    * Stale-source gauge population
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  selectDueSources,
  countSourcesByPublishStatus,
  scrapeOneSource,
  recordRunnerSourceProcessed,
  recordRunnerScrapeFailure,
  setRunnerDueSources,
  setRunnerStaleSourceCount,
} = vi.hoisted(() => ({
  selectDueSources: vi.fn(),
  countSourcesByPublishStatus: vi.fn(),
  scrapeOneSource: vi.fn(),
  recordRunnerSourceProcessed: vi.fn(),
  recordRunnerScrapeFailure: vi.fn(),
  setRunnerDueSources: vi.fn(),
  setRunnerStaleSourceCount: vi.fn(),
}));

vi.mock("@/lib/services/marketIntelligence/sourceCadence", () => ({
  selectDueSources,
  countSourcesByPublishStatus,
  // Re-exported constant used by the runner module.
  SELECT_DUE_DEFAULT_LIMIT: 10,
}));

vi.mock("@/lib/services/marketIntelligence/scrapeOneSource", () => ({
  scrapeOneSource,
}));

vi.mock("@/lib/observability", () => ({
  // Re-exports used by the runner.
  recordRunnerSourceProcessed,
  recordRunnerScrapeFailure,
  setRunnerDueSources,
  setRunnerStaleSourceCount,
  // Re-exports used by the dispatcher.
  emitAuditEvent: vi.fn(),
  newRunnerId: () => `runner-${Math.random().toString(36).slice(2, 8)}`,
  recordRunnerCycle: vi.fn(),
  recordRunnerCycleDuration: vi.fn(),
  withCorrelationContextAsync: async <T,>(_ctx: unknown, fn: () => Promise<T>) => fn(),
}));

// Lease + window key minimal stubs — we don't exercise the DB lease path
// here (lease.ts has its own tests). The runner-body test wants to verify
// the body() function's behavior; we mock the dispatcher boundaries.
vi.mock("@/lib/runners/lease", () => ({
  claimLease: vi.fn(async () => ({
    ok: true,
    lease: { id: "lease-1", leaseToken: "token-1" },
  })),
  heartbeatLease: vi.fn(async () => true),  // default: lease still held
  finalizeLease: vi.fn(async () => undefined),
}));

// Import AFTER all mocks — this triggers the registerRunner() side effect.
import "../municipalAgendaIngestion";
import { getRunner, runCycle } from "@/lib/runners";
import { heartbeatLease as heartbeatLeaseMock } from "@/lib/runners/lease";
import { MUNICIPAL_AGENDA_RUNNER_NAME } from "../municipalAgendaIngestion";

function defaultScrapeResult(over: Partial<ReturnType<typeof makeBaseScrape>> = {}) {
  return { ...makeBaseScrape(), ...over };
}

function makeBaseScrape() {
  return {
    engine: "sidecar" as const,
    sourceId: "src1",
    docsFound: 1, docsInRange: 1, docsScanned: 1, docsSkipped: 0,
    docsDroppedDate: 0, docsDroppedUndated: 0,
    docsPrefilterApplied: 0, docsPrefilterSkipped: 0, docsPrefilterFailed: 0,
    totalCharsSaved: 0,
    signalsCreated: 3, leadsCreated: 1, relationshipsCreated: 0,
    signalsDroppedRelevance: 0, signalsDroppedProjectType: 0, leadsDroppedValue: 0,
    totalCostUsd: 0.05,
    signalsSuppressedHeuristics: 2,
    classifiedByBand: { HIGH_EMERGENCE: 2, MEDIUM_EMERGENCE: 1 } as Record<string, number>,
    publishStatus: "HEALTHY",
    consecutiveEmptyRuns: 0,
    heuristicsApplied: true,
    ingestion: {
      ingested: 4,
      bySourceKind: { MARKET_SIGNAL: 3, MARKET_LEAD: 1, RELATIONSHIP_EDGE: 0 },
      decisions: { create_new: 4 },
      failed: 0,
      failures: [] as Array<{ sourceKind: string; sourceId: string; error: string }>,
    },
  };
}

beforeEach(() => {
  selectDueSources.mockReset();
  countSourcesByPublishStatus.mockReset();
  scrapeOneSource.mockReset();
  recordRunnerSourceProcessed.mockClear();
  recordRunnerScrapeFailure.mockClear();
  setRunnerDueSources.mockClear();
  setRunnerStaleSourceCount.mockClear();
  (heartbeatLeaseMock as ReturnType<typeof vi.fn>).mockResolvedValue(true);

  // Default: 2 STALE_PUBLISH + 0 OPERATOR_REVIEW so the stale-source gauge
  // assertions have a value to chase.
  countSourcesByPublishStatus.mockImplementation(async (status: string) => {
    if (status === "STALE_PUBLISH") return 2;
    if (status === "OPERATOR_REVIEW") return 0;
    return 0;
  });
});

describe("municipal-agenda-ingestion runner — registration", () => {
  test("registered with expected identity", () => {
    const def = getRunner(MUNICIPAL_AGENDA_RUNNER_NAME);
    expect(def).toBeDefined();
    expect(def!.name).toBe("municipal-agenda-ingestion");
    expect(def!.windowGranularity).toBe("hourly");
    expect(def!.leaseSeconds).toBe(900);
    expect(def!.maxDurationSeconds).toBe(3300);
    expect(def!.retryOnFailure).toBe(false);
  });
});

describe("municipal-agenda-ingestion runner — body behavior", () => {
  test("empty due-source list → empty cycle, gauge set to 0", async () => {
    selectDueSources.mockResolvedValue([]);
    const def = getRunner(MUNICIPAL_AGENDA_RUNNER_NAME)!;
    const result = await runCycle(def, { triggerReason: "scheduled" });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("succeeded");
    const r = result.result as { sourcesScraped: number; dueSourcesFound: number; staleSourceCount: number };
    expect(r.dueSourcesFound).toBe(0);
    expect(r.sourcesScraped).toBe(0);
    expect(r.staleSourceCount).toBe(2);
    expect(setRunnerDueSources).toHaveBeenCalledWith("municipal-agenda-ingestion", 0);
    expect(setRunnerStaleSourceCount).toHaveBeenCalledWith("STALE_PUBLISH", 2);
    expect(setRunnerStaleSourceCount).toHaveBeenCalledWith("OPERATOR_REVIEW", 0);
    expect(scrapeOneSource).not.toHaveBeenCalled();
  });

  test("happy path: 2 sources, both succeed → aggregated counts + metrics", async () => {
    selectDueSources.mockResolvedValue([
      { id: "src1", name: "Ankeny P&Z", sourceType: "planning_commission", jurisdiction: "Ankeny",
        lastScannedAt: null, nextExpectedAt: null, publishStatus: "HEALTHY" },
      { id: "src2", name: "Waukee P&Z", sourceType: "planning_commission", jurisdiction: "Waukee",
        lastScannedAt: null, nextExpectedAt: null, publishStatus: "HEALTHY" },
    ]);
    scrapeOneSource
      .mockResolvedValueOnce(defaultScrapeResult({ sourceId: "src1" }))
      .mockResolvedValueOnce(defaultScrapeResult({ sourceId: "src2", signalsCreated: 2, signalsSuppressedHeuristics: 0,
        ingestion: { ingested: 2, bySourceKind: { MARKET_SIGNAL: 2, MARKET_LEAD: 0, RELATIONSHIP_EDGE: 0 },
                     decisions: { create_new: 2 }, failed: 0, failures: [] } }));

    const def = getRunner(MUNICIPAL_AGENDA_RUNNER_NAME)!;
    const result = await runCycle(def, { triggerReason: "scheduled" });

    expect(result.ok).toBe(true);
    const r = result.result as Record<string, number>;
    expect(r.dueSourcesFound).toBe(2);
    expect(r.sourcesScraped).toBe(2);
    expect(r.sourcesFailed).toBe(0);
    expect(r.signalsCreated).toBe(5);     // 3 + 2
    expect(r.signalsSuppressedHeuristics).toBe(2);
    expect(r.leadsCreated).toBe(2);       // 1 + 1
    expect(r.ingestedTotal).toBe(6);      // 4 + 2

    expect(scrapeOneSource).toHaveBeenCalledTimes(2);
    expect(scrapeOneSource).toHaveBeenCalledWith("src1", expect.objectContaining({ runnerId: expect.any(String) }));
    expect(scrapeOneSource).toHaveBeenCalledWith("src2", expect.objectContaining({ runnerId: expect.any(String) }));
    expect(recordRunnerSourceProcessed).toHaveBeenCalledTimes(2);
    expect(recordRunnerScrapeFailure).not.toHaveBeenCalled();
  });

  test("one source throws → counted as failure, other sources still process", async () => {
    selectDueSources.mockResolvedValue([
      { id: "src_ok", name: "OK", sourceType: "planning_commission", jurisdiction: "X",
        lastScannedAt: null, nextExpectedAt: null, publishStatus: "HEALTHY" },
      { id: "src_bad", name: "Bad", sourceType: "planning_commission", jurisdiction: "Y",
        lastScannedAt: null, nextExpectedAt: null, publishStatus: "HEALTHY" },
      { id: "src_after_bad", name: "After", sourceType: "planning_commission", jurisdiction: "Z",
        lastScannedAt: null, nextExpectedAt: null, publishStatus: "HEALTHY" },
    ]);
    scrapeOneSource
      .mockResolvedValueOnce(defaultScrapeResult({ sourceId: "src_ok" }))
      .mockRejectedValueOnce(new Error("upstream timeout"))
      .mockResolvedValueOnce(defaultScrapeResult({ sourceId: "src_after_bad" }));

    const def = getRunner(MUNICIPAL_AGENDA_RUNNER_NAME)!;
    const result = await runCycle(def, { triggerReason: "scheduled" });

    expect(result.ok).toBe(true);
    const r = result.result as Record<string, number | unknown[]>;
    expect(r.sourcesScraped).toBe(2);
    expect(r.sourcesFailed).toBe(1);
    expect(scrapeOneSource).toHaveBeenCalledTimes(3);
    expect(recordRunnerScrapeFailure).toHaveBeenCalledTimes(1);

    const perSource = r.perSource as Array<{ sourceId: string; ok: boolean; errorMessage?: string }>;
    const badEntry = perSource.find((p) => p.sourceId === "src_bad");
    expect(badEntry?.ok).toBe(false);
    expect(badEntry?.errorMessage).toBe("upstream timeout");
  });

  test("heartbeat returning false aborts mid-cycle with explicit error", async () => {
    selectDueSources.mockResolvedValue([
      { id: "src1", name: "1", sourceType: "planning_commission", jurisdiction: "X",
        lastScannedAt: null, nextExpectedAt: null, publishStatus: "HEALTHY" },
      { id: "src2", name: "2", sourceType: "planning_commission", jurisdiction: "Y",
        lastScannedAt: null, nextExpectedAt: null, publishStatus: "HEALTHY" },
    ]);
    scrapeOneSource.mockResolvedValueOnce(defaultScrapeResult({ sourceId: "src1" }));
    // Heartbeat returns true on first call, false on the second (between src1 and src2).
    let call = 0;
    (heartbeatLeaseMock as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      call += 1;
      return call < 2;
    });

    const def = getRunner(MUNICIPAL_AGENDA_RUNNER_NAME)!;
    const result = await runCycle(def, { triggerReason: "scheduled" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/preempted/i);
    // Only src1 should have been scraped; we aborted before src2.
    expect(scrapeOneSource).toHaveBeenCalledTimes(1);
  });
});

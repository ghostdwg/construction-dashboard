// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/__tests__/activationReport.test.ts
//  Phase O2.2 PR6 — Activation-report aggregator tests.
//
//  Verifies that buildActivationReport queries the right slices, aggregates
//  correctly across 24h/7d windows, and handles empty data gracefully.
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

type LeaseRow = { cycleName: string; status: string; leasedAt: Date; durationMs: number | null; errorMessage: string | null };
type SignalRow = { id: string; headline: string; signalSubtype: string | null; heuristicsScore: number | null; heuristicsClassification: string | null; createdAt: Date; source: string | null; sourceDocId: string | null; sourceDoc: { jurisdiction: string | null } | null };
type SourceRow = { id: string; name: string; jurisdiction: string; publishStatus: string; isActive: boolean; cadenceConfidence: string | null; consecutiveEmptyRuns: number; lastEmptyRunAt: Date | null; lastScannedAt: Date | null };

const { store } = vi.hoisted(() => ({
  store: {
    leases: [] as LeaseRow[],
    signals: [] as SignalRow[],
    sources: [] as SourceRow[],
    projects: [] as { id: string; createdAt: Date; source: string | null }[],
    snapshots: [] as { id: string; createdAt: Date }[],
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketSource: {
      groupBy: vi.fn(async (args: { by: string[]; _count?: { _all: boolean } }) => {
        if (args.by.includes("publishStatus")) {
          // group by (publishStatus, isActive)
          const map = new Map<string, number>();
          for (const s of store.sources) {
            const k = `${s.publishStatus}|${s.isActive}`;
            map.set(k, (map.get(k) ?? 0) + 1);
          }
          return [...map.entries()].map(([k, n]) => {
            const [publishStatus, isActiveStr] = k.split("|");
            return { publishStatus, isActive: isActiveStr === "true", _count: { _all: n } };
          });
        }
        if (args.by.includes("cadenceConfidence")) {
          const map = new Map<string | null, number>();
          for (const s of store.sources) {
            map.set(s.cadenceConfidence, (map.get(s.cadenceConfidence) ?? 0) + 1);
          }
          return [...map.entries()].map(([cadenceConfidence, n]) => ({ cadenceConfidence, _count: { _all: n } }));
        }
        return [];
      }),
      findMany: vi.fn(async (args: { where?: { publishStatus?: { in: string[] } }; take?: number }) => {
        let rows = store.sources;
        const ps = args.where?.publishStatus;
        if (ps && Array.isArray(ps.in)) rows = rows.filter((s) => ps.in.includes(s.publishStatus));
        return rows.slice(0, args.take ?? undefined);
      }),
    },
    marketSignal: {
      count: vi.fn(async (args: { where?: { createdAt?: { gte: Date }; heuristicsClassification?: string } }) => {
        const w = args.where ?? {};
        return store.signals.filter((s) => {
          if (w.createdAt?.gte && s.createdAt < w.createdAt.gte) return false;
          if (w.heuristicsClassification && s.heuristicsClassification !== w.heuristicsClassification) return false;
          return true;
        }).length;
      }),
      groupBy: vi.fn(async (args: {
        by: string[];
        where?: { createdAt?: { gte: Date }; source?: { not?: null; in?: string[] }; heuristicsClassification?: { not?: null } };
        take?: number;
        orderBy?: unknown;
      }) => {
        const w = args.where ?? {};
        let rows = store.signals.filter((s) => {
          if (w.createdAt?.gte && s.createdAt < w.createdAt.gte) return false;
          if (w.source && "in" in w.source && w.source.in && !w.source.in.includes(s.source ?? "")) return false;
          if (w.source && "not" in w.source && w.source.not === null && s.source === null) return false;
          if (w.heuristicsClassification && "not" in w.heuristicsClassification && w.heuristicsClassification.not === null && s.heuristicsClassification === null) return false;
          return true;
        });
        if (args.by.includes("source")) {
          const map = new Map<string, number>();
          for (const s of rows) {
            const k = s.source ?? "(unknown)";
            map.set(k, (map.get(k) ?? 0) + 1);
          }
          const out = [...map.entries()].map(([source, n]) => ({ source, _count: { _all: n } }));
          out.sort((a, b) => b._count._all - a._count._all);
          return args.take ? out.slice(0, args.take) : out;
        }
        if (args.by.includes("heuristicsClassification")) {
          const map = new Map<string | null, number>();
          for (const s of rows) {
            map.set(s.heuristicsClassification, (map.get(s.heuristicsClassification) ?? 0) + 1);
          }
          return [...map.entries()].map(([heuristicsClassification, n]) => ({ heuristicsClassification, _count: { _all: n } }));
        }
        return [];
      }),
      findMany: vi.fn(async (args: { where?: { createdAt?: { gte: Date }; heuristicsClassification?: { in: string[] } }; take?: number }) => {
        const w = args.where ?? {};
        let rows = store.signals.filter((s) => {
          if (w.createdAt?.gte && s.createdAt < w.createdAt.gte) return false;
          if (w.heuristicsClassification?.in && !w.heuristicsClassification.in.includes(s.heuristicsClassification ?? "")) return false;
          return true;
        });
        rows.sort((a, b) => (b.heuristicsScore ?? -1) - (a.heuristicsScore ?? -1));
        return rows.slice(0, args.take ?? undefined);
      }),
    },
    runnerLease: {
      findMany: vi.fn(async (args: { where?: { cycleName?: { in: string[] } } }) => {
        const w = args.where ?? {};
        let rows = store.leases;
        if (w.cycleName?.in) rows = rows.filter((l) => w.cycleName!.in.includes(l.cycleName));
        return [...rows].sort((a, b) => b.leasedAt.getTime() - a.leasedAt.getTime());
      }),
      findFirst: vi.fn(async (args: { where?: { cycleName?: string } }) => {
        const w = args.where ?? {};
        let rows = store.leases;
        if (w.cycleName) rows = rows.filter((l) => l.cycleName === w.cycleName);
        const sorted = [...rows].sort((a, b) => b.leasedAt.getTime() - a.leasedAt.getTime());
        return sorted[0] ?? null;
      }),
    },
    project: {
      count: vi.fn(async (args: { where?: { createdAt?: { gte: Date }; source?: { startsWith: string } } }) => {
        const w = args.where ?? {};
        return store.projects.filter((p) => {
          if (w.createdAt?.gte && p.createdAt < w.createdAt.gte) return false;
          if (w.source?.startsWith && !(p.source ?? "").startsWith(w.source.startsWith)) return false;
          return true;
        }).length;
      }),
    },
    projectProbabilitySnapshot: {
      count: vi.fn(async (args: { where?: { computedAt?: { gte: Date } } }) => {
        const w = args.where ?? {};
        return store.snapshots.filter((s) => !w.computedAt?.gte || s.createdAt >= w.computedAt.gte).length;
      }),
    },
    // O2.2 PR7 — forecast-activity surface. Default empty; PR6 tests don't
    // populate forecast data, so all counts return 0.
    forecastSnapshot: {
      count: vi.fn(async () => 0),
    },
    probabilityTrend: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    emergenceScore: {
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => []),
    },
    emergenceTrajectory: {
      findMany: vi.fn(async () => []),
    },
    // O2.2 PR8 — alert-activity surface. Default empty.
    alertEvent: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
    },
  },
}));

import { buildActivationReport, ACTIVATION_REPORT_VERSION } from "../activationReport";

const NOW = new Date("2026-05-21T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const daysAgo  = (d: number) => new Date(NOW.getTime() - d * 86400_000);

beforeEach(() => {
  store.leases = [];
  store.signals = [];
  store.sources = [];
  store.projects = [];
  store.snapshots = [];
});

describe("buildActivationReport — empty DB", () => {
  test("returns zero-everything report when nothing is seeded", async () => {
    const r = await buildActivationReport({ now: NOW });
    expect(r.version).toBe(ACTIVATION_REPORT_VERSION);
    expect(r.sourceStatus).toEqual([]);
    expect(r.topJurisdictions7d).toEqual([]);
    expect(r.cadenceConfidenceDistribution).toEqual({ none: 0, low: 0, medium: 0, high: 0 });
    expect(r.runnerCycles).toHaveLength(4);  // PR4: 2 runners; PR7: + forecast-daily; PR8: + alert-eval = 4
    expect(r.runnerCycles.every((c) => c.totalLast24h === 0)).toBe(true);
    expect(r.ingestionThroughput.signalsLast1h).toBe(0);
    expect(r.projectFormation.projectsCreatedLast24h).toBe(0);
    expect(r.staleSources).toEqual([]);
    expect(r.suppressionRatio24h).toBeNull();
  });
});

describe("buildActivationReport — populated DB", () => {
  beforeEach(() => {
    // Sources
    store.sources = [
      { id: "s1", name: "Ankeny P&Z",     jurisdiction: "Ankeny",          publishStatus: "HEALTHY",         isActive: true,  cadenceConfidence: "MEDIUM", consecutiveEmptyRuns: 0, lastEmptyRunAt: null, lastScannedAt: hoursAgo(2) },
      { id: "s2", name: "WDM P&Z",        jurisdiction: "West Des Moines", publishStatus: "HEALTHY",         isActive: true,  cadenceConfidence: "HIGH",   consecutiveEmptyRuns: 0, lastEmptyRunAt: null, lastScannedAt: hoursAgo(5) },
      { id: "s3", name: "Mitchellville",  jurisdiction: "Mitchellville",   publishStatus: "STALE_PUBLISH",   isActive: true,  cadenceConfidence: "LOW",    consecutiveEmptyRuns: 3, lastEmptyRunAt: daysAgo(2), lastScannedAt: daysAgo(2) },
      { id: "s4", name: "Carlisle (held)", jurisdiction: "Carlisle",       publishStatus: "OPERATOR_REVIEW", isActive: false, cadenceConfidence: null,     consecutiveEmptyRuns: 1, lastEmptyRunAt: daysAgo(5), lastScannedAt: null },
    ];
    // Signals: 5 in last 24h (2 HIGH, 2 MED, 1 SUPPRESSED), 3 more in last 7d
    store.signals = [
      { id: "sig1", headline: "Annexation east of I-35",       signalSubtype: "ANNEXATION",       heuristicsScore: 0.85, heuristicsClassification: "HIGH_EMERGENCE",   createdAt: hoursAgo(1),  source: "Ankeny P&Z",     sourceDocId: "d1", sourceDoc: { jurisdiction: "Ankeny" } },
      { id: "sig2", headline: "Sewer extension to Northgate",  signalSubtype: "UTILITY_EXPANSION", heuristicsScore: 0.80, heuristicsClassification: "HIGH_EMERGENCE",   createdAt: hoursAgo(3),  source: "Ankeny P&Z",     sourceDocId: "d1", sourceDoc: { jurisdiction: "Ankeny" } },
      { id: "sig3", headline: "Site plan for distribution ctr", signalSubtype: "SITE_PLAN",        heuristicsScore: 0.55, heuristicsClassification: "MEDIUM_EMERGENCE", createdAt: hoursAgo(6),  source: "WDM P&Z",        sourceDocId: "d2", sourceDoc: { jurisdiction: "West Des Moines" } },
      { id: "sig4", headline: "Variance for setback",          signalSubtype: "VARIANCE",         heuristicsScore: 0.45, heuristicsClassification: "MEDIUM_EMERGENCE", createdAt: hoursAgo(10), source: "WDM P&Z",        sourceDocId: "d2", sourceDoc: { jurisdiction: "West Des Moines" } },
      { id: "sig5", headline: "(suppressed)",                  signalSubtype: null,                heuristicsScore: 0.05, heuristicsClassification: "SUPPRESSED",      createdAt: hoursAgo(20), source: "Ankeny P&Z",     sourceDocId: "d1", sourceDoc: { jurisdiction: "Ankeny" } },
      { id: "sig6", headline: "Plat approval (older)",         signalSubtype: "PLAT",             heuristicsScore: 0.60, heuristicsClassification: "MEDIUM_EMERGENCE", createdAt: daysAgo(3),   source: "Ankeny P&Z",     sourceDocId: "d3", sourceDoc: { jurisdiction: "Ankeny" } },
      { id: "sig7", headline: "Site plan (older)",             signalSubtype: "SITE_PLAN",        heuristicsScore: 0.55, heuristicsClassification: "MEDIUM_EMERGENCE", createdAt: daysAgo(4),   source: "WDM P&Z",        sourceDocId: "d4", sourceDoc: { jurisdiction: "West Des Moines" } },
    ];
    // Runner cycles: 5 in last 24h for municipal-agenda-ingestion (4 ok, 1 fail)
    store.leases = [
      { cycleName: "municipal-agenda-ingestion", status: "succeeded", leasedAt: hoursAgo(1),  durationMs: 12_345, errorMessage: null },
      { cycleName: "municipal-agenda-ingestion", status: "succeeded", leasedAt: hoursAgo(2),  durationMs: 11_000, errorMessage: null },
      { cycleName: "municipal-agenda-ingestion", status: "failed",    leasedAt: hoursAgo(3),  durationMs: 5_000,  errorMessage: "sidecar HTTP 504" },
      { cycleName: "municipal-agenda-ingestion", status: "succeeded", leasedAt: hoursAgo(4),  durationMs: 9_500,  errorMessage: null },
      { cycleName: "municipal-agenda-ingestion", status: "succeeded", leasedAt: hoursAgo(5),  durationMs: 10_200, errorMessage: null },
      // 1 health-check
      { cycleName: "health-check",               status: "succeeded", leasedAt: hoursAgo(0.25), durationMs: 50, errorMessage: null },
    ];
    // Projects: 2 in 24h (1 ingestion-attrib), 4 in 7d
    store.projects = [
      { id: "p1", createdAt: hoursAgo(2),  source: "ingestion_market_signal" },
      { id: "p2", createdAt: hoursAgo(10), source: "manual" },
      { id: "p3", createdAt: daysAgo(3),   source: "ingestion_market_signal" },
      { id: "p4", createdAt: daysAgo(5),   source: "ingestion_market_lead" },
    ];
    store.snapshots = [
      { id: "ps1", createdAt: hoursAgo(2) },
      { id: "ps2", createdAt: hoursAgo(2) },
      { id: "ps3", createdAt: hoursAgo(4) },
    ];
  });

  test("source-status rollup includes all four publishStatus + isActive combinations", async () => {
    const r = await buildActivationReport({ now: NOW });
    // 2 HEALTHY+active, 1 STALE+active, 1 OP_REVIEW+inactive
    expect(r.sourceStatus.length).toBeGreaterThanOrEqual(3);
    const healthyActive = r.sourceStatus.find((x) => x.publishStatus === "HEALTHY" && x.isActive);
    expect(healthyActive?.count).toBe(2);
    const staleActive = r.sourceStatus.find((x) => x.publishStatus === "STALE_PUBLISH" && x.isActive);
    expect(staleActive?.count).toBe(1);
  });

  test("cadence distribution buckets correctly", async () => {
    const r = await buildActivationReport({ now: NOW });
    expect(r.cadenceConfidenceDistribution.high).toBe(1);
    expect(r.cadenceConfidenceDistribution.medium).toBe(1);
    expect(r.cadenceConfidenceDistribution.low).toBe(1);
    expect(r.cadenceConfidenceDistribution.none).toBe(1);
  });

  test("ingestion throughput windows are correct", async () => {
    const r = await buildActivationReport({ now: NOW });
    expect(r.ingestionThroughput.signalsLast1h).toBe(1);  // sig1
    expect(r.ingestionThroughput.signalsLast24h).toBe(5); // sig1-5
    expect(r.ingestionThroughput.signalsLast7d).toBe(7);  // sig1-7
    expect(r.ingestionThroughput.highEmergence24h).toBe(2);
    expect(r.ingestionThroughput.mediumEmergence24h).toBe(2);
  });

  test("suppression ratio computed from classified+suppressed counts", async () => {
    const r = await buildActivationReport({ now: NOW });
    // classified+suppressed = 4 (HIGH+MED) + 1 (SUPPRESSED) = 5 total
    // suppressed / 5 = 0.2
    expect(r.suppressionRatio24h).toBeCloseTo(0.2, 2);
  });

  test("runner cycles aggregated per name", async () => {
    const r = await buildActivationReport({ now: NOW });
    const mai = r.runnerCycles.find((c) => c.cycleName === "municipal-agenda-ingestion")!;
    expect(mai.totalLast24h).toBe(5);
    expect(mai.succeeded24h).toBe(4);
    expect(mai.failed24h).toBe(1);
    expect(mai.lastCycleStatus).toBe("succeeded");
    expect(mai.lastCycleError).toBeNull();

    const hc = r.runnerCycles.find((c) => c.cycleName === "health-check")!;
    expect(hc.totalLast24h).toBe(1);
  });

  test("project formation reflects ingestion attribution", async () => {
    const r = await buildActivationReport({ now: NOW });
    expect(r.projectFormation.projectsCreatedLast24h).toBe(2);
    expect(r.projectFormation.projectsCreatedLast7d).toBe(4);
    expect(r.projectFormation.ingestionAttributedProjects7d).toBe(3);  // p1, p3, p4
    expect(r.projectFormation.probabilitySnapshots24h).toBe(3);
  });

  test("top emergent signals returned sorted by score, capped at limit", async () => {
    const r = await buildActivationReport({ now: NOW, topEmergentLimit: 3 });
    expect(r.topEmergentSignals24h).toHaveLength(3);
    expect(r.topEmergentSignals24h[0].id).toBe("sig1");  // highest score
    expect(r.topEmergentSignals24h[0].heuristicsClassification).toBe("HIGH_EMERGENCE");
    // SUPPRESSED never makes the cut (only HIGH + MEDIUM eligible)
    expect(r.topEmergentSignals24h.every((s) => s.heuristicsClassification !== "SUPPRESSED")).toBe(true);
  });

  test("stale sources surface only STALE_PUBLISH / OPERATOR_REVIEW", async () => {
    const r = await buildActivationReport({ now: NOW });
    expect(r.staleSources.length).toBe(2);  // s3 STALE + s4 OP_REVIEW
    expect(r.staleSources.every((s) => ["STALE_PUBLISH", "OPERATOR_REVIEW"].includes((store.sources.find((x) => x.id === s.id)!.publishStatus)))).toBe(true);
  });

  test("top jurisdictions sorted by 7d count and include 24h breakdown", async () => {
    const r = await buildActivationReport({ now: NOW, topJurisdictionsLimit: 5 });
    expect(r.topJurisdictions7d.length).toBeGreaterThan(0);
    const ankeny = r.topJurisdictions7d.find((j) => j.jurisdiction === "Ankeny P&Z");
    expect(ankeny).toBeDefined();
    expect(ankeny!.signalsLast24h).toBeGreaterThan(0);
    expect(ankeny!.signalsLast7d).toBeGreaterThanOrEqual(ankeny!.signalsLast24h);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/operatorWorkspace/__tests__/runnerAlerts.test.ts
//  Phase O2.2 PR8 — Runner-alerts module tests.
//
//  Covered:
//    * buildFingerprint stability
//    * isInCooldown (DB lookup + decode)
//    * persistRunnerAlert — happy path + cooldown suppression + dry-run
//    * detector logic — NEW_HIGH_EMERGENCE, TRAJECTORY_SHIFT_TO_ACCELERATING,
//      GOVERNANCE_BURST, SUPPRESSION_ANOMALY (representative coverage)
//    * Cooldown payload-JSON filter ignores incidental substring matches
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

const { store } = vi.hoisted(() => ({
  store: {
    alertEvents: [] as Array<{ id: string; subjectKind: string; subjectId: string; capturedAt: Date; payloadJson: string | null }>,
    alertEventInserts: [] as Array<Record<string, unknown>>,
    probabilityTrends: [] as Array<{
      subjectKind: string; subjectId: string; projectId: string | null; parcelId: string | null;
      previousScore: number; currentScore: number; delta: number;
      snapshotId: string | null; recordedAt: Date;
    }>,
    emergenceTrajectories: [] as Array<{
      subjectKind: string; subjectId: string; projectId: string | null; parcelId: string | null;
      state: string; previousState: string | null;
      acceleration: number; shortTermDelta: number; longTermDelta: number;
      shiftReason: string | null; stateEnteredAt: Date;
    }>,
    forecastSnapshots: [] as Array<{
      id: string; subjectKind: string; subjectId: string; projectId: string | null; parcelId: string | null;
      emergenceScore: number; overrideReason: string | null;
      overriddenByEmail: string | null; computedAt: Date; reviewStatus: string;
    }>,
    marketSignals: [] as Array<{
      id: string; signalSubtype: string | null; headline: string;
      heuristicsClassification: string | null;
      metadata: string | null; sourceDocId: string | null;
      createdAt: Date; sourceDoc: { jurisdiction: string | null } | null;
    }>,
    marketSources: [] as Array<{
      id: string; name: string; jurisdiction: string; publishStatus: string;
      consecutiveEmptyRuns: number; lastEmptyRunAt: Date | null;
    }>,
    counter: 0,
  },
}));

function nextId(): string {
  store.counter += 1;
  return `id${store.counter}`;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    alertEvent: {
      findMany: vi.fn(async (args: {
        where: {
          subjectKind?: string;
          subjectId?: string;
          capturedAt?: { gte: Date };
          payloadJson?: { contains: string };
          reviewStatus?: string;
        };
        select?: Record<string, boolean>;
        orderBy?: unknown;
        take?: number;
      }) => {
        const w = args.where ?? {};
        let rows = store.alertEvents.filter((a) => {
          if (w.subjectKind && a.subjectKind !== w.subjectKind) return false;
          if (w.subjectId && a.subjectId !== w.subjectId) return false;
          if (w.capturedAt?.gte && a.capturedAt < w.capturedAt.gte) return false;
          if (w.payloadJson?.contains && !(a.payloadJson ?? "").includes(w.payloadJson.contains)) return false;
          return true;
        });
        if (args.take) rows = rows.slice(0, args.take);
        return rows;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = nextId();
        const row = {
          id,
          subjectKind: data.subjectKind as string,
          subjectId: data.subjectId as string,
          capturedAt: new Date(),
          payloadJson: (data.payloadJson as string | null) ?? null,
        };
        store.alertEvents.push(row);
        store.alertEventInserts.push(data);
        return { id };
      }),
      update: vi.fn(async () => ({})),  // for rule.lastEvaluatedAt update — no-op in tests
    },
    alertExplanation: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    alertRule: {
      update: vi.fn(async () => ({})),
    },
    probabilityTrend: {
      findMany: vi.fn(async (args: {
        where: { recordedAt?: { gte: Date }; currentScore?: { gte: number }; previousScore?: { lt: number } };
        take?: number;
      }) => {
        const w = args.where;
        return store.probabilityTrends.filter((p) => {
          if (w.recordedAt?.gte && p.recordedAt < w.recordedAt.gte) return false;
          if (w.currentScore?.gte != null && p.currentScore < w.currentScore.gte) return false;
          if (w.previousScore?.lt != null && p.previousScore >= w.previousScore.lt) return false;
          return true;
        }).slice(0, args.take ?? 500);
      }),
    },
    emergenceTrajectory: {
      findMany: vi.fn(async (args: {
        where: {
          state?: { in: string[] };
          previousState?: { in?: string[]; notIn?: string[] };
          stateEnteredAt?: { gte: Date };
        };
        take?: number;
      }) => {
        const w = args.where;
        return store.emergenceTrajectories.filter((t) => {
          if (w.state?.in && !w.state.in.includes(t.state)) return false;
          if (w.previousState && "in" in w.previousState && w.previousState.in && (!t.previousState || !w.previousState.in.includes(t.previousState))) return false;
          if (w.previousState && "notIn" in w.previousState && w.previousState.notIn && t.previousState && w.previousState.notIn.includes(t.previousState)) return false;
          if (w.stateEnteredAt?.gte && t.stateEnteredAt < w.stateEnteredAt.gte) return false;
          return true;
        }).slice(0, args.take ?? 500);
      }),
    },
    forecastSnapshot: {
      findMany: vi.fn(async (args: { where: { reviewStatus: string; computedAt?: { gte: Date } }; take?: number }) => {
        const w = args.where;
        return store.forecastSnapshots.filter((s) => {
          if (s.reviewStatus !== w.reviewStatus) return false;
          if (w.computedAt?.gte && s.computedAt < w.computedAt.gte) return false;
          return true;
        }).slice(0, args.take ?? 500);
      }),
    },
    marketSource: {
      findMany: vi.fn(async (args: { where: { publishStatus?: string; lastEmptyRunAt?: { gte: Date } }; take?: number }) => {
        const w = args.where;
        return store.marketSources.filter((s) => {
          if (w.publishStatus && s.publishStatus !== w.publishStatus) return false;
          if (w.lastEmptyRunAt?.gte && (!s.lastEmptyRunAt || s.lastEmptyRunAt < w.lastEmptyRunAt.gte)) return false;
          return true;
        }).slice(0, args.take ?? 500);
      }),
    },
    marketSignal: {
      findMany: vi.fn(async (args: {
        where: {
          createdAt?: { gte: Date };
          signalSubtype?: { in: string[] };
          metadata?: { not: null };
        };
        take?: number;
      }) => {
        const w = args.where;
        return store.marketSignals.filter((s) => {
          if (w.createdAt?.gte && s.createdAt < w.createdAt.gte) return false;
          if (w.signalSubtype?.in && (!s.signalSubtype || !w.signalSubtype.in.includes(s.signalSubtype))) return false;
          if (w.metadata && "not" in w.metadata && w.metadata.not === null && !s.metadata) return false;
          return true;
        }).slice(0, args.take ?? 2000);
      }),
      count: vi.fn(async (args: {
        where: { heuristicsClassification?: string; createdAt?: { gte?: Date; lt?: Date } };
      }) => {
        const w = args.where;
        return store.marketSignals.filter((s) => {
          if (w.heuristicsClassification && s.heuristicsClassification !== w.heuristicsClassification) return false;
          if (w.createdAt?.gte && s.createdAt < w.createdAt.gte) return false;
          if (w.createdAt?.lt && s.createdAt >= w.createdAt.lt) return false;
          return true;
        }).length;
      }),
    },
  },
}));

vi.mock("@/lib/observability", () => ({
  emitAuditEvent: vi.fn(),
}));

import {
  buildFingerprint,
  isInCooldown,
  persistRunnerAlert,
  detectNewHighEmergence,
  detectTrajectoryShiftToAccelerating,
  detectGovernanceBurst,
  detectSuppressionAnomaly,
  detectSourceDegradation,
  detectForecastOverride,
  detectRecurringDeveloper,
  type AlertCandidate,
} from "../runnerAlerts";

const NOW = new Date("2026-05-21T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

function baseCandidate(over: Partial<AlertCandidate> = {}): AlertCandidate {
  return {
    triggerKind: "NEW_HIGH_EMERGENCE",
    subjectKind: "PROJECT",
    subjectId: "p1",
    projectId: "p1",
    parcelId: null,
    severity: "IMPORTANT",
    headline: "test alert",
    detail: "test detail",
    factors: [{ factorKind: "EVIDENCE", factorName: "test", factorScore: 1, rationale: "ok" }],
    capturedScore: null,
    capturedTrajectory: null,
    payload: {},
    ...over,
  };
}

beforeEach(() => {
  store.alertEvents.length = 0;
  store.alertEventInserts.length = 0;
  store.probabilityTrends.length = 0;
  store.emergenceTrajectories.length = 0;
  store.forecastSnapshots.length = 0;
  store.marketSignals.length = 0;
  store.marketSources.length = 0;
  store.counter = 0;
});

describe("buildFingerprint", () => {
  test("stable + deterministic shape", () => {
    expect(buildFingerprint("NEW_HIGH_EMERGENCE", "PROJECT", "p1")).toBe("NEW_HIGH_EMERGENCE|PROJECT|p1");
    expect(buildFingerprint("GOVERNANCE_BURST", "JURISDICTION", "Ankeny")).toBe("GOVERNANCE_BURST|JURISDICTION|Ankeny");
  });
});

describe("isInCooldown", () => {
  test("returns false when no prior alert exists", async () => {
    const r = await isInCooldown("fp1", 60, "PROJECT", "p1", NOW);
    expect(r).toBe(false);
  });

  test("returns true when prior alert has matching fingerprint within window", async () => {
    store.alertEvents.push({
      id: "old", subjectKind: "PROJECT", subjectId: "p1",
      capturedAt: hoursAgo(0.5),
      payloadJson: JSON.stringify({ runnerTriggerKind: "X", fingerprint: "fp1" }),
    });
    expect(await isInCooldown("fp1", 60, "PROJECT", "p1", NOW)).toBe(true);
  });

  test("returns false when fingerprint matches but is OUTSIDE the window", async () => {
    store.alertEvents.push({
      id: "old", subjectKind: "PROJECT", subjectId: "p1",
      capturedAt: hoursAgo(25),
      payloadJson: JSON.stringify({ runnerTriggerKind: "X", fingerprint: "fp1" }),
    });
    expect(await isInCooldown("fp1", 60, "PROJECT", "p1", NOW)).toBe(false);
  });

  test("false-positive guard: incidental substring in payload that's NOT the fingerprint field returns false", async () => {
    store.alertEvents.push({
      id: "old", subjectKind: "PROJECT", subjectId: "p1",
      capturedAt: hoursAgo(0.5),
      // Includes the fingerprint string in a note field, but the real
      // fingerprint key is different. The DB-side `contains` filter sees the
      // string; the JSON decode + isFingerprintInPayload check rejects it.
      payloadJson: JSON.stringify({ runnerTriggerKind: "X", fingerprint: "different", note: '"fingerprint":"fp1"' }),
    });
    expect(await isInCooldown("fp1", 60, "PROJECT", "p1", NOW)).toBe(false);
  });

  test("cooldownMinutes=0 disables cooldown entirely", async () => {
    store.alertEvents.push({
      id: "any", subjectKind: "PROJECT", subjectId: "p1",
      capturedAt: hoursAgo(0.01),
      payloadJson: JSON.stringify({ fingerprint: "fp1" }),
    });
    expect(await isInCooldown("fp1", 0, "PROJECT", "p1", NOW)).toBe(false);
  });
});

describe("persistRunnerAlert", () => {
  test("happy path: persists when no cooldown match; payload enriched with fingerprint + version", async () => {
    const r = await persistRunnerAlert(baseCandidate(), 60, NOW, false);
    expect(r.persisted).toBe(true);
    expect(r.fingerprint).toBe("NEW_HIGH_EMERGENCE|PROJECT|p1");
    expect(store.alertEventInserts).toHaveLength(1);
    const insertedPayload = JSON.parse(store.alertEventInserts[0].payloadJson as string);
    expect(insertedPayload.fingerprint).toBe("NEW_HIGH_EMERGENCE|PROJECT|p1");
    expect(insertedPayload.runnerTriggerKind).toBe("NEW_HIGH_EMERGENCE");
    expect(insertedPayload.runnerAlertsVersion).toBe("v1");
    expect(insertedPayload.priorHistory).toBeDefined();
    expect(insertedPayload.priorHistory.priorAlertCount30d).toBe(0);
  });

  test("cooldown suppression: returns persisted=false with reason='cooldown'", async () => {
    store.alertEvents.push({
      id: "old", subjectKind: "PROJECT", subjectId: "p1",
      capturedAt: hoursAgo(0.1),
      payloadJson: JSON.stringify({ fingerprint: "NEW_HIGH_EMERGENCE|PROJECT|p1" }),
    });
    const r = await persistRunnerAlert(baseCandidate(), 60, NOW, false);
    expect(r.persisted).toBe(false);
    expect(r.suppressedReason).toBe("cooldown");
    // No new insert.
    expect(store.alertEventInserts).toHaveLength(0);
  });

  test("dry-run: never persists; returns reason='dry_run'", async () => {
    const r = await persistRunnerAlert(baseCandidate(), 60, NOW, true);
    expect(r.persisted).toBe(false);
    expect(r.suppressedReason).toBe("dry_run");
    expect(store.alertEventInserts).toHaveLength(0);
  });

  test("priorHistory enrichment: counts prior alerts in last 30d", async () => {
    // Seed 3 prior alerts for the same subject (different fingerprints — so
    // they do NOT trigger cooldown for our new fingerprint).
    for (let i = 0; i < 3; i++) {
      store.alertEvents.push({
        id: `prior${i}`, subjectKind: "PROJECT", subjectId: "p1",
        capturedAt: hoursAgo(24 * (i + 1)),
        payloadJson: JSON.stringify({ runnerTriggerKind: "RECURRING_DEVELOPER", fingerprint: `other-${i}` }),
      });
    }
    const r = await persistRunnerAlert(baseCandidate(), 60, NOW, false);
    expect(r.persisted).toBe(true);
    const insertedPayload = JSON.parse(store.alertEventInserts[0].payloadJson as string);
    expect(insertedPayload.priorHistory.priorAlertCount30d).toBe(3);
    expect(insertedPayload.priorHistory.priorTriggerKindCounts).toEqual({ RECURRING_DEVELOPER: 3 });
  });
});

describe("detectNewHighEmergence", () => {
  test("returns candidates for ProbabilityTrend rows crossing HIGH threshold within window", async () => {
    store.probabilityTrends.push(
      { subjectKind: "PROJECT", subjectId: "p1", projectId: "p1", parcelId: null,
        previousScore: 0.6, currentScore: 0.75, delta: 0.15,
        snapshotId: "snap1", recordedAt: hoursAgo(2) },
      { subjectKind: "PROJECT", subjectId: "p2", projectId: "p2", parcelId: null,
        previousScore: 0.75, currentScore: 0.80, delta: 0.05,
        snapshotId: "snap2", recordedAt: hoursAgo(3) },  // previous already ≥ 0.70 → filtered
    );
    const candidates = await detectNewHighEmergence(NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].subjectId).toBe("p1");
    expect(candidates[0].severity).toBe("IMPORTANT");
    expect(candidates[0].capturedScore).toBe(0.75);
  });

  test("empty when nothing crossed threshold", async () => {
    expect(await detectNewHighEmergence(NOW)).toEqual([]);
  });
});

describe("detectTrajectoryShiftToAccelerating", () => {
  test("IGNITING → IMPORTANT, ACCELERATING → WATCH (floored to IMPORTANT by detector config)", async () => {
    store.emergenceTrajectories.push(
      { subjectKind: "PROJECT", subjectId: "p1", projectId: "p1", parcelId: null,
        state: "IGNITING", previousState: "EMERGING",
        acceleration: 0.25, shortTermDelta: 0.10, longTermDelta: 0.02,
        shiftReason: "ignition_from_flat", stateEnteredAt: hoursAgo(2) },
      { subjectKind: "PROJECT", subjectId: "p2", projectId: "p2", parcelId: null,
        state: "ACCELERATING", previousState: "EMERGING",
        acceleration: 0.10, shortTermDelta: 0.05, longTermDelta: 0.02,
        shiftReason: null, stateEnteredAt: hoursAgo(4) },
    );
    const candidates = await detectTrajectoryShiftToAccelerating(NOW);
    expect(candidates).toHaveLength(2);
    expect(candidates.find((c) => c.subjectId === "p1")!.severity).toBe("IMPORTANT");
    // ACCELERATING is WATCH per detector base, but detector config floor is
    // IMPORTANT — pickHigherSeverity selects IMPORTANT.
    expect(candidates.find((c) => c.subjectId === "p2")!.severity).toBe("IMPORTANT");
  });
});

describe("detectGovernanceBurst", () => {
  test("fires when ≥ 3 governance signals from same jurisdiction in 24h", async () => {
    for (let i = 0; i < 3; i++) {
      store.marketSignals.push({
        id: `g${i}`, signalSubtype: "ZONING_REWRITE", headline: `gov ${i}`,
        heuristicsClassification: "HIGH_EMERGENCE",
        metadata: null, sourceDocId: `d${i}`,
        createdAt: hoursAgo(i + 1),
        sourceDoc: { jurisdiction: "Ankeny" },
      });
    }
    // Also one signal in a different jurisdiction — should NOT fire.
    store.marketSignals.push({
      id: "g_solo", signalSubtype: "TIF_APPROVAL", headline: "alone",
      heuristicsClassification: "HIGH_EMERGENCE",
      metadata: null, sourceDocId: "d_solo",
      createdAt: hoursAgo(1),
      sourceDoc: { jurisdiction: "Waukee" },
    });
    const candidates = await detectGovernanceBurst(NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].subjectKind).toBe("JURISDICTION");
    expect(candidates[0].subjectId).toBe("Ankeny");
    expect(candidates[0].severity).toBe("IMPORTANT");
    expect(candidates[0].payload.burstCount).toBe(3);
  });

  test("does NOT fire when only 2 governance signals in jurisdiction", async () => {
    for (let i = 0; i < 2; i++) {
      store.marketSignals.push({
        id: `g${i}`, signalSubtype: "MORATORIUM", headline: `gov ${i}`,
        heuristicsClassification: "MEDIUM_EMERGENCE",
        metadata: null, sourceDocId: `d${i}`,
        createdAt: hoursAgo(i + 1),
        sourceDoc: { jurisdiction: "Norwalk" },
      });
    }
    const candidates = await detectGovernanceBurst(NOW);
    expect(candidates).toEqual([]);
  });
});

describe("detectSuppressionAnomaly", () => {
  test("fires when 24h count > 2× rolling 7d avg AND > floor 50", async () => {
    // 100 suppressions in last 24h, 70 in the prior 7d (= 10/day avg).
    for (let i = 0; i < 100; i++) {
      store.marketSignals.push({
        id: `s${i}`, signalSubtype: null, headline: "x",
        heuristicsClassification: "SUPPRESSED",
        metadata: null, sourceDocId: null,
        createdAt: hoursAgo(i * 0.2),  // all within 24h
        sourceDoc: null,
      });
    }
    for (let i = 0; i < 70; i++) {
      store.marketSignals.push({
        id: `s_old${i}`, signalSubtype: null, headline: "x",
        heuristicsClassification: "SUPPRESSED",
        metadata: null, sourceDocId: null,
        createdAt: hoursAgo(24 + i * 2),  // within prior 7d
        sourceDoc: null,
      });
    }
    const candidates = await detectSuppressionAnomaly(NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].severity).toBe("WATCH");
    expect(candidates[0].subjectKind).toBe("PLATFORM");
  });

  test("does NOT fire when below absolute floor (50)", async () => {
    for (let i = 0; i < 40; i++) {
      store.marketSignals.push({
        id: `s${i}`, signalSubtype: null, headline: "x",
        heuristicsClassification: "SUPPRESSED",
        metadata: null, sourceDocId: null,
        createdAt: hoursAgo(i * 0.2),
        sourceDoc: null,
      });
    }
    const candidates = await detectSuppressionAnomaly(NOW);
    expect(candidates).toEqual([]);
  });
});

describe("detectSourceDegradation", () => {
  test("fires for STALE_PUBLISH sources with recent lastEmptyRunAt", async () => {
    store.marketSources.push(
      { id: "src1", name: "Ankeny P&Z", jurisdiction: "Ankeny",
        publishStatus: "STALE_PUBLISH", consecutiveEmptyRuns: 4, lastEmptyRunAt: hoursAgo(6) },
      { id: "src2", name: "Old Stale", jurisdiction: "Stale",
        publishStatus: "STALE_PUBLISH", consecutiveEmptyRuns: 10, lastEmptyRunAt: hoursAgo(72) },  // outside 24h window
    );
    const candidates = await detectSourceDegradation(NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].subjectKind).toBe("MARKET_SOURCE");
    expect(candidates[0].subjectId).toBe("src1");
    expect(candidates[0].severity).toBe("INFO");
  });
});

describe("detectForecastOverride", () => {
  test("fires for OVERRIDDEN snapshots in window", async () => {
    store.forecastSnapshots.push({
      id: "snap1", subjectKind: "PROJECT", subjectId: "p1",
      projectId: "p1", parcelId: null,
      emergenceScore: 0.85, overrideReason: "manual review",
      overriddenByEmail: "ops@example.com", computedAt: hoursAgo(3),
      reviewStatus: "OVERRIDDEN",
    });
    const candidates = await detectForecastOverride(NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].severity).toBe("INFO");
    expect(candidates[0].headline).toContain("0.85");
  });
});

describe("detectRecurringDeveloper", () => {
  test("fires when same actor appears in ≥ 3 distinct sourceDocIds in 7d", async () => {
    const dev = JSON.stringify({ owner_name: "Knapp Properties" });
    for (let i = 0; i < 3; i++) {
      store.marketSignals.push({
        id: `r${i}`, signalSubtype: "SITE_PLAN", headline: "x",
        heuristicsClassification: "HIGH_EMERGENCE",
        metadata: dev, sourceDocId: `doc${i}`,
        createdAt: hoursAgo(i * 24),  // spread across 3 days
        sourceDoc: null,
      });
    }
    const candidates = await detectRecurringDeveloper(NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].subjectKind).toBe("DEVELOPER");
    expect(candidates[0].severity).toBe("WATCH");
    expect(candidates[0].headline).toContain("Knapp Properties");
  });

  test("does NOT fire when same actor only in 2 distinct docs", async () => {
    const dev = JSON.stringify({ owner_name: "Solo Corp" });
    for (let i = 0; i < 2; i++) {
      store.marketSignals.push({
        id: `r${i}`, signalSubtype: "SITE_PLAN", headline: "x",
        heuristicsClassification: "MEDIUM_EMERGENCE",
        metadata: dev, sourceDocId: `doc${i}`,
        createdAt: hoursAgo(i * 24),
        sourceDoc: null,
      });
    }
    expect(await detectRecurringDeveloper(NOW)).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
//  lib/runners/__tests__/forecastDaily.test.ts
//  Phase O2.2 PR7 — forecast-daily runner body tests.
//
//  Mocks the MI-8 boundary + cadence-gate boundary + prisma counts. Verifies:
//    * gates-fail → no-op result, no MI-8 calls
//    * happy path → context built per subject, scorer called, persistForecast called
//    * trajectory-shift detection emits audit + metric
//    * per-subject failure isolated, runner continues
//    * post-cycle gauges populated
// ──────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  checkForecastGates,
  selectActiveForecastSubjects,
  buildForecastSubjectContext,
  computeEmergenceScore,
  computeAcceleration,
  classifyTrajectory,
  computeExpectedTimeline,
  persistForecast,
  emitForecastAudit,
  recordForecastRecomputed,
  recordForecastFailure,
  recordForecastTrajectoryShift,
  setForecastHighEmergenceCount,
  setForecastOverriddenCount,
  recordForecastDuration,
} = vi.hoisted(() => ({
  checkForecastGates: vi.fn(),
  selectActiveForecastSubjects: vi.fn(),
  buildForecastSubjectContext: vi.fn(),
  computeEmergenceScore: vi.fn(),
  computeAcceleration: vi.fn(),
  classifyTrajectory: vi.fn(),
  computeExpectedTimeline: vi.fn(),
  persistForecast: vi.fn(),
  emitForecastAudit: vi.fn(),
  recordForecastRecomputed: vi.fn(),
  recordForecastFailure: vi.fn(),
  recordForecastTrajectoryShift: vi.fn(),
  setForecastHighEmergenceCount: vi.fn(),
  setForecastOverriddenCount: vi.fn(),
  recordForecastDuration: vi.fn(),
}));

vi.mock("@/lib/services/emergenceProbability", () => ({
  checkForecastGates,
  selectActiveForecastSubjects,
  buildForecastSubjectContext,
  computeEmergenceScore,
  computeAcceleration,
  classifyTrajectory,
  computeExpectedTimeline,
  persistForecast,
  emitForecastAudit,
}));

vi.mock("@/lib/observability", () => ({
  recordForecastRecomputed,
  recordForecastFailure,
  recordForecastTrajectoryShift,
  setForecastHighEmergenceCount,
  setForecastOverriddenCount,
  recordForecastDuration,
  // Dispatcher dependencies (re-exported helpers):
  emitAuditEvent: vi.fn(),
  newRunnerId: () => `runner-${Math.random().toString(36).slice(2, 8)}`,
  recordRunnerCycle: vi.fn(),
  recordRunnerCycleDuration: vi.fn(),
  withCorrelationContextAsync: async <T,>(_ctx: unknown, fn: () => Promise<T>) => fn(),
}));

vi.mock("@/lib/runners/lease", () => ({
  claimLease: vi.fn(async () => ({ ok: true, lease: { id: "lease-1", leaseToken: "tok" } })),
  heartbeatLease: vi.fn(async () => true),
  finalizeLease: vi.fn(async () => undefined),
}));

const { store } = vi.hoisted(() => ({
  store: {
    emergenceScoreRows: [] as Array<{ subjectKind: string; score: number }>,
    overriddenSnapshots: 0,
    trajectoryRows: new Map<string, { state: string; streakLength: number }>(),
    projects: new Map<string, { lifecycleState: string }>(),
    forecastSnapshotsBySubject: [] as Array<{ subjectKind: string; subjectId: string; emergenceScore: number; computedAt: Date }>,
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    forecastSnapshot: {
      findMany: vi.fn(async (args: { where: { subjectKind: string; subjectId: string } }) => {
        return store.forecastSnapshotsBySubject.filter((s) => s.subjectKind === args.where.subjectKind && s.subjectId === args.where.subjectId);
      }),
      count: vi.fn(async () => store.overriddenSnapshots),
    },
    emergenceTrajectory: {
      findUnique: vi.fn(async ({ where }: { where: { subjectKind_subjectId: { subjectKind: string; subjectId: string } } }) => {
        const key = `${where.subjectKind_subjectId.subjectKind}|${where.subjectKind_subjectId.subjectId}`;
        return store.trajectoryRows.get(key) ?? null;
      }),
    },
    project: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return store.projects.get(where.id) ?? null;
      }),
    },
    emergenceScore: {
      count: vi.fn(async (args: { where: { subjectKind: string; score: { gte: number } } }) => {
        return store.emergenceScoreRows.filter((r) => r.subjectKind === args.where.subjectKind && r.score >= args.where.score.gte).length;
      }),
    },
  },
}));

// Import AFTER all mocks so the registerRunner side-effect fires under the mocked env.
import "../forecastDaily";
import { getRunner, runCycle } from "@/lib/runners";
import { FORECAST_DAILY_RUNNER_NAME } from "../forecastDaily";

function makeScoreResult(score = 0.5, contributions: Array<{ factorName: string; contribution: number }> = []) {
  return {
    subjectKind: "PROJECT",
    subjectId: "p1",
    emergenceScore: score,
    factors: {
      baselineProbability: 0, signalVolume: 0, signalDiversity: 0, developerRecurrence: 0,
      brokerRecurrence: 0, continuancePressure: 0, utilityExpansion: 0, parcelPressure: 0,
      pressuredNeighborCount: 0, shellPatternBoost: 0, corridorBoost: 0, infrastructureBoost: 0,
      recencyMultiplier: 1,
    },
    reasonLog: [],
    contributions,
    forecastVersion: "v1" as const,
  };
}

function makeAcceleration(idx = 0) {
  return {
    subjectKind: "PROJECT",
    subjectId: "p1",
    accelerationIndex: idx,
    momentumScore: 0,
    decayScore: 0,
    shortTermDelta: 0,
    longTermDelta: 0,
    shiftDetected: false,
    shiftReason: null,
    windowDays: 30,
  };
}

function makeTrajectory(state: string, previousState: string | null = null) {
  return {
    state,
    previousState,
    streakLength: 1,
    shiftDetected: false,
    shiftReason: null,
  };
}

function makeContext(subjectKind: "PROJECT" | "PARCEL" = "PROJECT", subjectId = "p1") {
  return {
    subjectKind, subjectId,
    projectId: subjectKind === "PROJECT" ? subjectId : null,
    parcelId: subjectKind === "PARCEL" ? subjectId : null,
    jurisdictionKey: "Ankeny",
    latestProjectProbability: 0.5,
    latestParcelPressureMean: null,
    probabilityMean30d: null,
    probabilityMean90d: null,
    probabilityMean365d: null,
    signalCountLast30d: 2,
    signalCountLast90d: 5,
    signalCountLast365d: 12,
    developerEntityIds: [],
    brokerEntityIds: [],
    continuanceCount: 0,
    activeUtilityExpansions: 0,
    pressuredNeighborCount: 0,
    onCorridor: false,
    hasInfrastructureInvestment: false,
    daysSinceLastSignal: 7,
    hasShellBuildingPattern: false,
  };
}

beforeEach(() => {
  checkForecastGates.mockReset();
  selectActiveForecastSubjects.mockReset();
  buildForecastSubjectContext.mockReset();
  computeEmergenceScore.mockReset();
  computeAcceleration.mockReset();
  classifyTrajectory.mockReset();
  computeExpectedTimeline.mockReset();
  persistForecast.mockReset();
  emitForecastAudit.mockClear();
  recordForecastRecomputed.mockClear();
  recordForecastFailure.mockClear();
  recordForecastTrajectoryShift.mockClear();
  setForecastHighEmergenceCount.mockClear();
  setForecastOverriddenCount.mockClear();
  recordForecastDuration.mockClear();

  store.emergenceScoreRows = [];
  store.overriddenSnapshots = 0;
  store.trajectoryRows = new Map();
  store.projects = new Map([["p1", { lifecycleState: "EMERGING" }]]);
  store.forecastSnapshotsBySubject = [];

  // Default: all gates pass.
  checkForecastGates.mockResolvedValue({
    version: "v1", generatedAt: new Date(), gatesPass: true,
    results: [
      { name: "min_market_signals", pass: true, observed: 100, required: 100, detail: "ok" },
      { name: "min_projects", pass: true, observed: 5, required: 5, detail: "ok" },
      { name: "cadence_movement", pass: true, observed: 3, required: 3, detail: "ok" },
      { name: "no_recent_runner_errors", pass: true, observed: 0, required: 0, detail: "ok" },
    ],
  });
  selectActiveForecastSubjects.mockResolvedValue([]);
  computeExpectedTimeline.mockReturnValue([]);
});

describe("forecast-daily runner — registration", () => {
  test("registered with expected identity", () => {
    const def = getRunner(FORECAST_DAILY_RUNNER_NAME);
    expect(def).toBeDefined();
    expect(def!.name).toBe("forecast-daily");
    expect(def!.windowGranularity).toBe("daily");
    expect(def!.leaseSeconds).toBe(3600);
    expect(def!.maxDurationSeconds).toBe(3000);
    expect(def!.retryOnFailure).toBe(false);
  });
});

describe("forecast-daily runner — gating", () => {
  test("when gates fail → no-op result + audit + zero MI-8 calls", async () => {
    checkForecastGates.mockResolvedValue({
      version: "v1", generatedAt: new Date(), gatesPass: false,
      results: [
        { name: "min_market_signals", pass: false, observed: 7, required: 100, detail: "7 (need 100)" },
        { name: "min_projects", pass: true, observed: 5, required: 5, detail: "ok" },
        { name: "cadence_movement", pass: true, observed: 3, required: 3, detail: "ok" },
        { name: "no_recent_runner_errors", pass: true, observed: 0, required: 0, detail: "ok" },
      ],
    });
    selectActiveForecastSubjects.mockResolvedValue([{ subjectKind: "PROJECT", subjectId: "p1" }]);

    const def = getRunner(FORECAST_DAILY_RUNNER_NAME)!;
    const result = await runCycle(def, { triggerReason: "scheduled" });

    expect(result.ok).toBe(true);
    const r = result.result as { gatesPassed: boolean; subjectsForecasted: number };
    expect(r.gatesPassed).toBe(false);
    expect(r.subjectsForecasted).toBe(0);

    expect(selectActiveForecastSubjects).not.toHaveBeenCalled();
    expect(buildForecastSubjectContext).not.toHaveBeenCalled();
    expect(persistForecast).not.toHaveBeenCalled();
    expect(emitForecastAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "forecast_daily_cycle",
      decision: "gates_not_met",
    }));
  });
});

describe("forecast-daily runner — happy path", () => {
  test("single PROJECT subject → context built, scorer called, persistForecast called", async () => {
    selectActiveForecastSubjects.mockResolvedValue([{ subjectKind: "PROJECT", subjectId: "p1" }]);
    buildForecastSubjectContext.mockResolvedValue(makeContext());
    computeEmergenceScore.mockReturnValue(makeScoreResult(0.6));
    computeAcceleration.mockReturnValue(makeAcceleration());
    classifyTrajectory.mockReturnValue(makeTrajectory("STEADY"));
    persistForecast.mockResolvedValue({ ok: true, scoreUpserted: true, trajectoryUpserted: true, trendRecorded: false, timelinePointsUpserted: 0 });

    const def = getRunner(FORECAST_DAILY_RUNNER_NAME)!;
    const result = await runCycle(def, { triggerReason: "scheduled" });

    expect(result.ok).toBe(true);
    const r = result.result as { subjectsForecasted: number; subjectsConsidered: number };
    expect(r.subjectsConsidered).toBe(1);
    expect(r.subjectsForecasted).toBe(1);
    expect(buildForecastSubjectContext).toHaveBeenCalledWith("PROJECT", "p1", expect.any(Object));
    expect(persistForecast).toHaveBeenCalledTimes(1);
    expect(recordForecastRecomputed).toHaveBeenCalledWith("PROJECT", "recorded");
  });

  test("skipped_unchanged path: persistForecast returns scoreUpserted=false", async () => {
    selectActiveForecastSubjects.mockResolvedValue([{ subjectKind: "PROJECT", subjectId: "p1" }]);
    buildForecastSubjectContext.mockResolvedValue(makeContext());
    computeEmergenceScore.mockReturnValue(makeScoreResult(0.5));
    computeAcceleration.mockReturnValue(makeAcceleration());
    classifyTrajectory.mockReturnValue(makeTrajectory("STEADY"));
    persistForecast.mockResolvedValue({ ok: true, scoreUpserted: false, trajectoryUpserted: false, trendRecorded: false, timelinePointsUpserted: 0 });

    const def = getRunner(FORECAST_DAILY_RUNNER_NAME)!;
    const result = await runCycle(def);

    const r = result.result as { subjectsForecasted: number; subjectsSkippedUnchanged: number };
    expect(r.subjectsForecasted).toBe(0);
    expect(r.subjectsSkippedUnchanged).toBe(1);
    expect(recordForecastRecomputed).toHaveBeenCalledWith("PROJECT", "skipped_unchanged");
  });

  test("missing subject (build returns null) → skipped_no_data, no scorer call", async () => {
    selectActiveForecastSubjects.mockResolvedValue([{ subjectKind: "PROJECT", subjectId: "ghost" }]);
    buildForecastSubjectContext.mockResolvedValue(null);

    const def = getRunner(FORECAST_DAILY_RUNNER_NAME)!;
    const result = await runCycle(def);

    expect(result.ok).toBe(true);
    expect(computeEmergenceScore).not.toHaveBeenCalled();
    expect(persistForecast).not.toHaveBeenCalled();
    expect(recordForecastRecomputed).toHaveBeenCalledWith("PROJECT", "skipped_no_data");
  });
});

describe("forecast-daily runner — trajectory shift detection", () => {
  test("previous state != new state → audit + trajectory-shift metric", async () => {
    selectActiveForecastSubjects.mockResolvedValue([{ subjectKind: "PROJECT", subjectId: "p1" }]);
    buildForecastSubjectContext.mockResolvedValue(makeContext());
    computeEmergenceScore.mockReturnValue(makeScoreResult(0.8, [
      { factorName: "signalVolume", contribution: 0.4 },
      { factorName: "developerRecurrence", contribution: 0.2 },
    ]));
    computeAcceleration.mockReturnValue(makeAcceleration(0.2));
    classifyTrajectory.mockReturnValue(makeTrajectory("ACCELERATING", "STEADY"));
    persistForecast.mockResolvedValue({ ok: true, scoreUpserted: true, trajectoryUpserted: true, trendRecorded: true, timelinePointsUpserted: 0 });
    store.trajectoryRows.set("PROJECT|p1", { state: "STEADY", streakLength: 3 });

    const def = getRunner(FORECAST_DAILY_RUNNER_NAME)!;
    const result = await runCycle(def);

    const r = result.result as { trajectoryShifts: number };
    expect(r.trajectoryShifts).toBe(1);
    expect(recordForecastTrajectoryShift).toHaveBeenCalledWith("STEADY", "ACCELERATING");
    expect(emitForecastAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "trajectory_shift",
      subjectKind: "PROJECT",
      subjectId: "p1",
      trajectoryState: "ACCELERATING",
    }));
  });

  test("same state → no trajectory-shift audit", async () => {
    selectActiveForecastSubjects.mockResolvedValue([{ subjectKind: "PROJECT", subjectId: "p1" }]);
    buildForecastSubjectContext.mockResolvedValue(makeContext());
    computeEmergenceScore.mockReturnValue(makeScoreResult(0.5));
    computeAcceleration.mockReturnValue(makeAcceleration(0));
    classifyTrajectory.mockReturnValue(makeTrajectory("STEADY"));
    persistForecast.mockResolvedValue({ ok: true, scoreUpserted: true, trajectoryUpserted: true, trendRecorded: false, timelinePointsUpserted: 0 });
    store.trajectoryRows.set("PROJECT|p1", { state: "STEADY", streakLength: 1 });

    const def = getRunner(FORECAST_DAILY_RUNNER_NAME)!;
    await runCycle(def);

    expect(recordForecastTrajectoryShift).not.toHaveBeenCalled();
    // emitForecastAudit may have been called for other reasons but not for trajectory_shift
    const trajShiftCalls = emitForecastAudit.mock.calls.filter((args) => (args[0] as { action: string }).action === "trajectory_shift");
    expect(trajShiftCalls).toHaveLength(0);
  });
});

describe("forecast-daily runner — failure isolation", () => {
  test("one subject throws → counted as failure, runner continues", async () => {
    selectActiveForecastSubjects.mockResolvedValue([
      { subjectKind: "PROJECT", subjectId: "p1" },
      { subjectKind: "PROJECT", subjectId: "p_bad" },
      { subjectKind: "PROJECT", subjectId: "p2" },
    ]);
    buildForecastSubjectContext.mockImplementation(async (kind: string, id: string) => {
      if (id === "p_bad") throw new Error("boom");
      return makeContext("PROJECT", id);
    });
    computeEmergenceScore.mockReturnValue(makeScoreResult(0.5));
    computeAcceleration.mockReturnValue(makeAcceleration());
    classifyTrajectory.mockReturnValue(makeTrajectory("STEADY"));
    persistForecast.mockResolvedValue({ ok: true, scoreUpserted: true, trajectoryUpserted: true, trendRecorded: false, timelinePointsUpserted: 0 });

    const def = getRunner(FORECAST_DAILY_RUNNER_NAME)!;
    const result = await runCycle(def);

    const r = result.result as { subjectsForecasted: number; subjectsFailed: number; failures: Array<{ subjectId: string }> };
    expect(r.subjectsForecasted).toBe(2);
    expect(r.subjectsFailed).toBe(1);
    expect(r.failures[0].subjectId).toBe("p_bad");
    expect(recordForecastFailure).toHaveBeenCalledWith("PROJECT");
  });
});

describe("forecast-daily runner — post-cycle gauges", () => {
  test("HIGH-emergence count + overridden count set", async () => {
    selectActiveForecastSubjects.mockResolvedValue([]);
    store.emergenceScoreRows = [
      { subjectKind: "PROJECT", score: 0.85 },
      { subjectKind: "PROJECT", score: 0.75 },
      { subjectKind: "PARCEL", score: 0.80 },
      { subjectKind: "PROJECT", score: 0.4 }, // below threshold
    ];
    store.overriddenSnapshots = 2;

    const def = getRunner(FORECAST_DAILY_RUNNER_NAME)!;
    const result = await runCycle(def);

    const r = result.result as { highEmergenceProjects: number; highEmergenceParcels: number; overriddenCount: number };
    expect(r.highEmergenceProjects).toBe(2);
    expect(r.highEmergenceParcels).toBe(1);
    expect(r.overriddenCount).toBe(2);
    expect(setForecastHighEmergenceCount).toHaveBeenCalledWith("PROJECT", 2);
    expect(setForecastHighEmergenceCount).toHaveBeenCalledWith("PARCEL", 1);
    expect(setForecastOverriddenCount).toHaveBeenCalledWith(2);
  });
});

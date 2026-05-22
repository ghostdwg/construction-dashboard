// ──────────────────────────────────────────────────────────────────────────────
//  lib/runners/forecastDaily.ts
//  Phase O2.2 PR7 — Recurring forecast recompute runner.
//
//  Fires daily (cron entry: "0 8 * * *" = 08:00 UTC ≈ 03:00 CDT). Each cycle:
//    1. checkForecastGates() — soft-gate: if gates fail, audit + early-return.
//    2. selectActiveForecastSubjects() — Projects + Parcels not in REJECTED/MERGED.
//    3. For each subject:
//       a. buildForecastSubjectContext()
//       b. computeEmergenceScore()
//       c. computeAcceleration() from prior ForecastSnapshot history
//       d. classifyTrajectory()
//       e. computeExpectedTimeline()
//       f. persistForecast()
//       g. detect trajectory shift (prev != new) → audit + metric
//    4. Read post-cycle gauges: HIGH emergence count + overridden count.
//
//  This runner contains NO new MI-8 logic. Every scorer/persister was built
//  in earlier phases; PR7 is glue + scheduling + visibility.
//
//  Lease contract:
//    * windowGranularity=daily → at-most-once per UTC day via RunnerLease
//      unique constraint on windowKey (`forecast-daily_2026-05-21`).
//    * leaseSeconds=3600 (1h lease, heartbeat every ~30 min)
//    * maxDurationSeconds=3000 — alert if a cycle exceeds 50 min
//    * retryOnFailure=false — operator-initiated retry
//
//  Replay safety: persistForecast is append-only (new ForecastSnapshot row
//  per call). Replay re-computes + re-records; the previous snapshot remains
//  in history. Each pre-snap comparison drives skipIfUnchanged / trend.
// ──────────────────────────────────────────────────────────────────────────────

import { registerRunner } from "./registry";
import { prisma } from "@/lib/prisma";
import {
  buildForecastSubjectContext,
  selectActiveForecastSubjects,
  checkForecastGates,
  computeEmergenceScore,
  computeAcceleration,
  classifyTrajectory,
  computeExpectedTimeline,
  persistForecast,
  emitForecastAudit,
  type ForecastSubjectContext,
  type SubjectKind,
  type TrajectoryState,
  type ScoreObservation,
} from "@/lib/services/emergenceProbability";
import {
  recordForecastRecomputed,
  recordForecastFailure,
  recordForecastTrajectoryShift,
  setForecastHighEmergenceCount,
  setForecastOverriddenCount,
  recordForecastDuration,
} from "@/lib/observability";

export const FORECAST_DAILY_RUNNER_NAME = "forecast-daily";

/** Per-cycle subject cap. Projects + Parcels each capped — runner stays
 *  inside its lease budget even on a hot region. Tune as throughput data
 *  arrives post-soak. */
export const FORECAST_DAILY_PROJECT_LIMIT = 5000;
export const FORECAST_DAILY_PARCEL_LIMIT = 5000;

/** Score-history depth for acceleration. 60 snapshots ≈ 60 days. */
const SCORE_HISTORY_DEPTH = 60;
/** HIGH-emergence band boundary (mirrors heuristics.ts) — used for the
 *  post-cycle gauge. */
const HIGH_EMERGENCE_THRESHOLD = 0.70;

export interface ForecastDailyResult {
  gatesPassed: boolean;
  gatesReportSummary: string;        // human-readable; full report in audit
  subjectsConsidered: number;
  subjectsForecasted: number;
  subjectsFailed: number;
  subjectsSkippedUnchanged: number;
  trajectoryShifts: number;
  highEmergenceProjects: number;
  highEmergenceParcels: number;
  overriddenCount: number;
  perKindCounts: Record<SubjectKind, number>;
  failures: Array<{ subjectKind: SubjectKind; subjectId: string; error: string }>;
}

registerRunner<ForecastDailyResult>({
  name: FORECAST_DAILY_RUNNER_NAME,
  windowGranularity: "daily",
  leaseSeconds: 3600,
  maxDurationSeconds: 3000,
  retryOnFailure: false,
  body: async (ctx) => {
    // ── Step 1: gate check ─────────────────────────────────────────────────
    const gates = await checkForecastGates(ctx.windowStart);
    if (!gates.gatesPass) {
      const failingNames = gates.results.filter((g) => !g.pass).map((g) => g.name);
      const summary = `gates not met: ${failingNames.join(", ")}`;
      emitForecastAudit({
        action: "forecast_daily_cycle",
        subjectKind: "BATCH",
        subjectId: "forecast-daily",
        decision: "gates_not_met",
        reasonLog: gates.results.map((g) => `${g.name}: ${g.detail}`),
      });
      const empty: ForecastDailyResult = {
        gatesPassed: false,
        gatesReportSummary: summary,
        subjectsConsidered: 0,
        subjectsForecasted: 0,
        subjectsFailed: 0,
        subjectsSkippedUnchanged: 0,
        trajectoryShifts: 0,
        highEmergenceProjects: 0,
        highEmergenceParcels: 0,
        overriddenCount: 0,
        perKindCounts: { PROJECT: 0, PARCEL: 0 } as Record<SubjectKind, number>,
        failures: [],
      };
      return empty;
    }

    // ── Step 2: subject selection ──────────────────────────────────────────
    const subjects = await selectActiveForecastSubjects({
      projectLimit: FORECAST_DAILY_PROJECT_LIMIT,
      parcelLimit: FORECAST_DAILY_PARCEL_LIMIT,
    });

    let subjectsForecasted = 0;
    let subjectsFailed = 0;
    let subjectsSkippedUnchanged = 0;
    let trajectoryShifts = 0;
    const perKindCounts: Record<SubjectKind, number> = { PROJECT: 0, PARCEL: 0 } as Record<SubjectKind, number>;
    const failures: ForecastDailyResult["failures"] = [];

    // ── Step 3: per-subject forecast loop ──────────────────────────────────
    let heartbeatCounter = 0;
    const HEARTBEAT_INTERVAL = 25;

    for (const subj of subjects) {
      heartbeatCounter += 1;
      if (heartbeatCounter % HEARTBEAT_INTERVAL === 0) {
        if (!(await ctx.heartbeat())) {
          throw new Error(`lease preempted mid-cycle after ${subjectsForecasted} subject(s) forecasted`);
        }
      }

      const start = Date.now();
      try {
        const subjectCtx = await buildForecastSubjectContext(subj.subjectKind, subj.subjectId, { now: ctx.windowStart });
        if (!subjectCtx) {
          recordForecastRecomputed(subj.subjectKind, "skipped_no_data");
          continue;
        }

        const score = computeEmergenceScore(subjectCtx);
        const history = await loadScoreHistory(subj.subjectKind, subj.subjectId);
        const acceleration = computeAcceleration(
          subj.subjectKind,
          subj.subjectId,
          history,
          subjectCtx.daysSinceLastSignal,
        );

        const previousTrajectory = await prisma.emergenceTrajectory.findUnique({
          where: { subjectKind_subjectId: { subjectKind: subj.subjectKind, subjectId: subj.subjectId } },
          select: { state: true, streakLength: true },
        });
        const previousState = (previousTrajectory?.state as TrajectoryState | undefined) ?? null;
        const previousStreakLength = previousTrajectory?.streakLength ?? 0;

        const trajectory = classifyTrajectory({
          emergenceScore: score.emergenceScore,
          acceleration,
          previousState,
          previousStreakLength,
          daysSinceLastSignal: subjectCtx.daysSinceLastSignal,
        });

        // computeExpectedTimeline needs lifecycleState — only Projects have
        // it. For PARCEL subjects we skip timeline (their forecasting is
        // about pressure, not milestone delivery).
        const lifecycleState = await resolveLifecycleState(subj);
        const expectedTimeline = lifecycleState
          ? computeExpectedTimeline({
              lifecycleState,
              emergenceScore: score.emergenceScore,
              trajectoryState: trajectory.state,
              referenceDate: ctx.windowStart,
            })
          : [];

        const persistResult = await persistForecast({
          ctx: subjectCtx,
          score,
          acceleration,
          trajectory,
          expectedTimeline,
          triggerReason: "scheduled",
          skipIfUnchanged: true,
        });

        if (persistResult.scoreUpserted) {
          subjectsForecasted += 1;
          perKindCounts[subj.subjectKind] = (perKindCounts[subj.subjectKind] ?? 0) + 1;
          recordForecastRecomputed(subj.subjectKind, "recorded");
        } else {
          subjectsSkippedUnchanged += 1;
          recordForecastRecomputed(subj.subjectKind, "skipped_unchanged");
        }

        // Trajectory shift detection — emit a structured audit when state changed.
        if (previousState && previousState !== trajectory.state) {
          trajectoryShifts += 1;
          recordForecastTrajectoryShift(previousState, trajectory.state);
          emitForecastAudit({
            action: "trajectory_shift",
            subjectKind: subj.subjectKind,
            subjectId: subj.subjectId,
            decision: "recorded",
            score: score.emergenceScore,
            acceleration: acceleration.accelerationIndex,
            trajectoryState: trajectory.state,
            reasonLog: [
              `from=${previousState}`,
              `to=${trajectory.state}`,
              `scoreDelta=${(score.emergenceScore - (history[0]?.score ?? 0)).toFixed(3)}`,
              `topContributors=${topContributors(subjectCtx, score, 3)}`,
            ],
          });
        }

        recordForecastDuration(subj.subjectKind, (Date.now() - start) / 1000);
      } catch (err) {
        subjectsFailed += 1;
        const message = err instanceof Error ? err.message : String(err);
        recordForecastFailure(subj.subjectKind);
        recordForecastDuration(subj.subjectKind, (Date.now() - start) / 1000);
        failures.push({ subjectKind: subj.subjectKind, subjectId: subj.subjectId, error: message });
        console.warn(`[${FORECAST_DAILY_RUNNER_NAME}] subject ${subj.subjectKind}:${subj.subjectId} failed:`, message);
        // continue — one subject's failure does not poison the cycle
      }
    }

    // ── Step 4: post-cycle gauges ──────────────────────────────────────────
    const [highEmergenceProjects, highEmergenceParcels, overriddenCount] = await Promise.all([
      prisma.emergenceScore.count({
        where: { subjectKind: "PROJECT", score: { gte: HIGH_EMERGENCE_THRESHOLD } },
      }),
      prisma.emergenceScore.count({
        where: { subjectKind: "PARCEL", score: { gte: HIGH_EMERGENCE_THRESHOLD } },
      }),
      prisma.forecastSnapshot.count({ where: { reviewStatus: "OVERRIDDEN" } }),
    ]);
    setForecastHighEmergenceCount("PROJECT", highEmergenceProjects);
    setForecastHighEmergenceCount("PARCEL", highEmergenceParcels);
    setForecastOverriddenCount(overriddenCount);

    return {
      gatesPassed: true,
      gatesReportSummary: `all ${gates.results.length} gate(s) passed`,
      subjectsConsidered: subjects.length,
      subjectsForecasted,
      subjectsFailed,
      subjectsSkippedUnchanged,
      trajectoryShifts,
      highEmergenceProjects,
      highEmergenceParcels,
      overriddenCount,
      perKindCounts,
      failures,
    };
  },
});

// ── Helpers ────────────────────────────────────────────────────────────────

async function loadScoreHistory(subjectKind: SubjectKind, subjectId: string): Promise<ScoreObservation[]> {
  const snaps = await prisma.forecastSnapshot.findMany({
    where: { subjectKind, subjectId },
    orderBy: { computedAt: "desc" },
    take: SCORE_HISTORY_DEPTH,
    select: { emergenceScore: true, computedAt: true },
  });
  return snaps.map((s) => ({
    score: s.emergenceScore,
    observedAt: s.computedAt,
  }));
}

async function resolveLifecycleState(subj: { subjectKind: SubjectKind; subjectId: string }): Promise<string | null> {
  if (subj.subjectKind !== "PROJECT") return null;
  const p = await prisma.project.findUnique({
    where: { id: subj.subjectId },
    select: { lifecycleState: true },
  });
  return p?.lifecycleState ?? null;
}

function topContributors(ctx: ForecastSubjectContext, score: { contributions: Array<{ factorName: string; contribution: number }> }, n: number): string {
  void ctx;  // reserved for future "why this factor" deep-link
  const sorted = [...score.contributions].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return sorted
    .slice(0, n)
    .map((c) => `${c.factorName}=${c.contribution.toFixed(3)}`)
    .join(",");
}

// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/emergenceProbability/writer.ts
//  Phase MI-8 — Forecast snapshot persistence + projection upserts.
//
//  The "orchestrator". Given a fully-built ForecastSubjectContext + an
//  AccelerationResult (computed from past snapshots) + a TrajectoryDecision,
//  this writes:
//
//    1. one ForecastSnapshot (append-only)
//    2. N ForecastExplanation rows (one per contribution)
//    3. an EmergenceScore upsert (current-state projection)
//    4. an EmergenceTrajectory upsert
//    5. a ProbabilityTrend row when the score delta exceeds an epsilon
//    6. optional ExpectedTimeline upserts (one per milestone)
//
//  No re-collection of context happens here; that's the caller's job.
//  This file owns the DB-writing concerns so the pure scorers stay testable.
//
//  The flow is intentionally split:
//    - context gathering (callers / future PR-2 backfill)
//    - pure scoring (forecast.ts / trajectory.ts)
//    - persistence (this file)
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { emitForecastAudit } from "./audit";
import {
  type EmergenceScoreResult,
  type AccelerationResult,
  type TrajectoryDecision,
  type ExpectedTimelinePoint,
  type ForecastActorContext,
  type ForecastConfidence,
  type ForecastSubjectContext,
  type SubjectKind,
  FORECAST_VERSION,
} from "./types";

const TREND_EPSILON = 0.005;

export interface PersistForecastInput {
  ctx: ForecastSubjectContext;
  score: EmergenceScoreResult;
  acceleration: AccelerationResult;
  trajectory: TrajectoryDecision;
  expectedTimeline?: ExpectedTimelinePoint[];
  corridorHeatScore?: number | null;
  jurisdictionVelocity?: number | null;
  /** "scheduled" | "signal_attached" | "probability_update" | "pressure_update"
   *  | "manual" | "backfill" */
  triggerReason?: string;
  actor?: ForecastActorContext;
  /** When true, skip writing entirely if there is no detectable change vs
   *  the previous snapshot. Default false — append-only is the norm. */
  skipIfUnchanged?: boolean;
}

export interface PersistForecastResult {
  ok: boolean;
  snapshotId?: string;
  scoreUpserted: boolean;
  trajectoryUpserted: boolean;
  trendRecorded: boolean;
  timelinePointsUpserted: number;
  error?: string;
}

export async function persistForecast(input: PersistForecastInput): Promise<PersistForecastResult> {
  const { ctx, score, acceleration, trajectory } = input;
  const triggerReason = input.triggerReason ?? "scheduled";

  // Look at the previous snapshot to drive ProbabilityTrend + skipIfUnchanged.
  const prevSnap = await prisma.forecastSnapshot.findFirst({
    where: { subjectKind: ctx.subjectKind, subjectId: ctx.subjectId },
    orderBy: { computedAt: "desc" },
  });
  const previousScore = prevSnap?.emergenceScore ?? 0;
  const delta = score.emergenceScore - previousScore;

  if (input.skipIfUnchanged && prevSnap && Math.abs(delta) < TREND_EPSILON) {
    emitForecastAudit({
      action: "persist_forecast",
      subjectKind: ctx.subjectKind,
      subjectId: ctx.subjectId,
      decision: "skipped_unchanged",
      score: score.emergenceScore,
      acceleration: acceleration.accelerationIndex,
      trajectoryState: trajectory.state,
    });
    return {
      ok: true,
      scoreUpserted: false,
      trajectoryUpserted: false,
      trendRecorded: false,
      timelinePointsUpserted: 0,
    };
  }

  const confidence = computeConfidence(ctx, score.emergenceScore);

  const payload = {
    factors: score.factors,
    reasonLog: score.reasonLog,
    contributions: score.contributions,
    acceleration: {
      accelerationIndex: acceleration.accelerationIndex,
      momentumScore: acceleration.momentumScore,
      decayScore: acceleration.decayScore,
      shortTermDelta: acceleration.shortTermDelta,
      longTermDelta: acceleration.longTermDelta,
      shiftDetected: acceleration.shiftDetected,
      shiftReason: acceleration.shiftReason,
    },
    trajectory: {
      state: trajectory.state,
      previousState: trajectory.previousState,
      streakLength: trajectory.streakLength,
    },
    ctx: {
      jurisdictionKey: ctx.jurisdictionKey,
      onCorridor: ctx.onCorridor,
      hasShellBuildingPattern: ctx.hasShellBuildingPattern,
      hasInfrastructureInvestment: ctx.hasInfrastructureInvestment,
      daysSinceLastSignal: ctx.daysSinceLastSignal,
      signalCountLast30d: ctx.signalCountLast30d,
      signalCountLast90d: ctx.signalCountLast90d,
    },
  };

  const snap = await prisma.forecastSnapshot.create({
    data: {
      subjectKind: ctx.subjectKind,
      subjectId: ctx.subjectId,
      projectId: ctx.projectId,
      parcelId: ctx.parcelId,
      emergenceScore: score.emergenceScore,
      accelerationIndex: acceleration.accelerationIndex,
      momentumScore: acceleration.momentumScore,
      decayScore: acceleration.decayScore,
      corridorHeatScore: input.corridorHeatScore ?? null,
      jurisdictionVelocity: input.jurisdictionVelocity ?? null,
      trajectoryState: trajectory.state,
      confidence,
      forecastVersion: FORECAST_VERSION,
      triggerReason,
      payloadJson: JSON.stringify(payload),
    },
  });

  // ── Explanation rows ──────────────────────────────────────────────────────
  if (score.contributions.length > 0) {
    await prisma.forecastExplanation.createMany({
      data: score.contributions.map((c) => ({
        snapshotId: snap.id,
        factorKind: c.factorKind,
        factorName: String(c.factorName),
        factorScore: c.factorScore,
        factorWeight: c.factorWeight,
        contribution: c.contribution,
        sourceRefKind: c.sourceRefKind ?? null,
        sourceRefId: c.sourceRefId ?? null,
        rationale: c.rationale,
      })),
    });
  }

  // ── Current-state EmergenceScore upsert ──────────────────────────────────
  await prisma.emergenceScore.upsert({
    where: {
      subjectKind_subjectId: { subjectKind: ctx.subjectKind, subjectId: ctx.subjectId },
    },
    create: {
      subjectKind: ctx.subjectKind,
      subjectId: ctx.subjectId,
      projectId: ctx.projectId,
      parcelId: ctx.parcelId,
      score: score.emergenceScore,
      confidence,
      latestSnapshotId: snap.id,
      latestComputedAt: snap.computedAt,
    },
    update: {
      score: score.emergenceScore,
      confidence,
      latestSnapshotId: snap.id,
      latestComputedAt: snap.computedAt,
    },
  });

  // ── Current-state EmergenceTrajectory upsert ─────────────────────────────
  const prevTrajRow = await prisma.emergenceTrajectory.findUnique({
    where: {
      subjectKind_subjectId: { subjectKind: ctx.subjectKind, subjectId: ctx.subjectId },
    },
  });
  const stateChanged = prevTrajRow?.state !== trajectory.state;
  await prisma.emergenceTrajectory.upsert({
    where: {
      subjectKind_subjectId: { subjectKind: ctx.subjectKind, subjectId: ctx.subjectId },
    },
    create: {
      subjectKind: ctx.subjectKind,
      subjectId: ctx.subjectId,
      projectId: ctx.projectId,
      parcelId: ctx.parcelId,
      state: trajectory.state,
      previousState: null,
      streakLength: 1,
      stateEnteredAt: snap.computedAt,
      shortTermDelta: acceleration.shortTermDelta,
      longTermDelta: acceleration.longTermDelta,
      acceleration: acceleration.accelerationIndex,
      shiftDetected: acceleration.shiftDetected,
      shiftReason: acceleration.shiftReason,
    },
    update: {
      state: trajectory.state,
      previousState: stateChanged ? (prevTrajRow?.state ?? null) : prevTrajRow?.previousState ?? null,
      streakLength: stateChanged ? 1 : (prevTrajRow?.streakLength ?? 0) + 1,
      stateEnteredAt: stateChanged ? snap.computedAt : prevTrajRow?.stateEnteredAt ?? snap.computedAt,
      shortTermDelta: acceleration.shortTermDelta,
      longTermDelta: acceleration.longTermDelta,
      acceleration: acceleration.accelerationIndex,
      shiftDetected: acceleration.shiftDetected,
      shiftReason: acceleration.shiftReason,
    },
  });

  // ── ProbabilityTrend record ──────────────────────────────────────────────
  let trendRecorded = false;
  if (Math.abs(delta) >= TREND_EPSILON || !prevSnap) {
    await prisma.probabilityTrend.create({
      data: {
        subjectKind: ctx.subjectKind,
        subjectId: ctx.subjectId,
        projectId: ctx.projectId,
        parcelId: ctx.parcelId,
        previousScore,
        currentScore: score.emergenceScore,
        delta,
        direction: delta > TREND_EPSILON ? "UP" : delta < -TREND_EPSILON ? "DOWN" : "FLAT",
        windowDays: 1,
        snapshotId: snap.id,
      },
    });
    trendRecorded = true;
  }

  // ── ExpectedTimeline upserts ─────────────────────────────────────────────
  let timelinePointsUpserted = 0;
  if (input.expectedTimeline && input.expectedTimeline.length > 0) {
    for (const point of input.expectedTimeline) {
      await prisma.expectedTimeline.upsert({
        where: {
          subjectKind_subjectId_milestoneKind: {
            subjectKind: ctx.subjectKind,
            subjectId: ctx.subjectId,
            milestoneKind: point.milestoneKind,
          },
        },
        create: {
          subjectKind: ctx.subjectKind,
          subjectId: ctx.subjectId,
          projectId: ctx.projectId,
          parcelId: ctx.parcelId,
          milestoneKind: point.milestoneKind,
          earliestEstimate: point.earliestEstimate,
          expectedEstimate: point.expectedEstimate,
          latestEstimate: point.latestEstimate,
          confidence: point.confidence,
          rationale: point.rationale,
          latestSnapshotId: snap.id,
          latestComputedAt: snap.computedAt,
        },
        update: {
          earliestEstimate: point.earliestEstimate,
          expectedEstimate: point.expectedEstimate,
          latestEstimate: point.latestEstimate,
          confidence: point.confidence,
          rationale: point.rationale,
          latestSnapshotId: snap.id,
          latestComputedAt: snap.computedAt,
        },
      });
      timelinePointsUpserted++;
    }
  }

  emitForecastAudit({
    action: "persist_forecast",
    subjectKind: ctx.subjectKind,
    subjectId: ctx.subjectId,
    decision: "recorded",
    score: score.emergenceScore,
    acceleration: acceleration.accelerationIndex,
    trajectoryState: trajectory.state,
    reasonLog: score.reasonLog,
    actorUserId: input.actor?.userId ?? null,
    actorEmail: input.actor?.email ?? null,
  });

  return {
    ok: true,
    snapshotId: snap.id,
    scoreUpserted: true,
    trajectoryUpserted: true,
    trendRecorded,
    timelinePointsUpserted,
  };
}

/** Confidence band based on signal count + score. Conservative: defaults
 *  MEDIUM; HIGH requires both enough volume and a decisive score. */
function computeConfidence(ctx: ForecastSubjectContext, score: number): ForecastConfidence {
  if (ctx.signalCountLast90d >= 6 && score >= 0.60) return "HIGH";
  if (ctx.signalCountLast90d <= 1 && score <= 0.20) return "LOW";
  return "MEDIUM";
}

/** Operator-facing forecast override. Appends a new ForecastSnapshot rather
 *  than mutating an existing row (reviewStatus=OVERRIDDEN flags it). The
 *  EmergenceScore current-state row also updates so the UI reflects the
 *  override immediately.
 *
 *  Does NOT recompute factors — the override is a manual call. The original
 *  snapshot remains in history for lineage.
 */
export async function overrideForecast(input: {
  subjectKind: SubjectKind;
  subjectId: string;
  projectId?: string | null;
  parcelId?: string | null;
  newScore: number;
  newTrajectoryState: string;
  reason: string;
  actor: ForecastActorContext;
}): Promise<{ ok: boolean; snapshotId?: string; error?: string }> {
  const payload = {
    override: true,
    newScore: input.newScore,
    newTrajectoryState: input.newTrajectoryState,
    reason: input.reason,
  };

  const snap = await prisma.forecastSnapshot.create({
    data: {
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      projectId: input.projectId ?? null,
      parcelId: input.parcelId ?? null,
      emergenceScore: clamp(input.newScore, 0, 1),
      accelerationIndex: 0,
      momentumScore: 0,
      decayScore: 0,
      trajectoryState: input.newTrajectoryState,
      confidence: "MEDIUM",
      forecastVersion: FORECAST_VERSION,
      reviewStatus: "OVERRIDDEN",
      overriddenByUserId: input.actor.userId,
      overriddenByEmail: input.actor.email,
      overrideReason: input.reason,
      triggerReason: "manual",
      payloadJson: JSON.stringify(payload),
    },
  });

  await prisma.emergenceScore.upsert({
    where: { subjectKind_subjectId: { subjectKind: input.subjectKind, subjectId: input.subjectId } },
    create: {
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      projectId: input.projectId ?? null,
      parcelId: input.parcelId ?? null,
      score: clamp(input.newScore, 0, 1),
      confidence: "MEDIUM",
      latestSnapshotId: snap.id,
      latestComputedAt: snap.computedAt,
    },
    update: {
      score: clamp(input.newScore, 0, 1),
      confidence: "MEDIUM",
      latestSnapshotId: snap.id,
      latestComputedAt: snap.computedAt,
    },
  });

  emitForecastAudit({
    action: "override_forecast",
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    decision: "overridden",
    score: input.newScore,
    trajectoryState: input.newTrajectoryState,
    actorUserId: input.actor.userId,
    actorEmail: input.actor.email,
  });

  return { ok: true, snapshotId: snap.id };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

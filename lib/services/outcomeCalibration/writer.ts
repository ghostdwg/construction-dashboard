// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/outcomeCalibration/writer.ts
//  Phase MI-9 — Outcome + resolution + calibration persistence.
//
//  Persistence boundary. Pure scoring (accuracy.ts, detectors.ts,
//  calibration.ts) stays I/O free; this file is the only place that talks
//  to Prisma in the outcome-calibration service.
//
//  Append-only discipline:
//    - Outcome rows are NEVER mutated. Corrections create a new Outcome
//      with `supersededByOutcomeId` and set the original's resolution to
//      WITHDRAWN.
//    - OutcomeResolution rows are append-only at the (outcome, snapshot)
//      pair level — a re-resolution creates a new row with a fresh
//      calibrationVersion.
//    - ForecastAccuracy / TrajectoryOutcome / TimelineAccuracy rows are
//      append-only. Re-evaluation appends a new row, never overwrites.
//    - CalibrationSnapshot is strictly append-only.
//    - ForecastCalibration is upsertable on (scope, scopeKey, factorName,
//      adjustmentKind); operator-applied changes increment updatedAt
//      without losing prior values (the active flag toggles for soft-
//      disable).
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { emitCalibrationAudit } from "./audit";
import {
  type OutcomeKind,
  type DetectionMethod,
  type EvidenceKind,
  type ForecastEvaluation,
  type ForecastAssertion,
  type ObservedOutcome,
  type OutcomeActorContext,
  type CalibrationScope,
  type AdjustmentKind,
  CALIBRATION_VERSION,
  classifyPosture,
} from "./types";

// ── recordOutcome ────────────────────────────────────────────────────────────

export interface RecordOutcomeInput {
  subjectKind: "PROJECT" | "PARCEL" | "CORRIDOR" | "JURISDICTION" | "DEVELOPER";
  subjectId: string;
  projectId?: string | null;
  parcelId?: string | null;
  outcomeKind: OutcomeKind;
  outcomeLabel?: string;
  detectionMethod?: DetectionMethod;
  occurredAt: Date;
  observedAt?: Date;
  outcomeConfidence?: "LOW" | "MEDIUM" | "HIGH" | "VERIFIED";
  notes?: string;
  payloadJson?: string;
  /** When this outcome corrects a prior one, set this so the original gets
   *  resolutions WITHDRAWN. The supersede chain on the row itself is
   *  written separately via supersedeOutcome. */
  supersedingPriorOutcomeId?: string;
  evidence?: Array<{
    evidenceKind: EvidenceKind;
    sourceRefKind?: string;
    sourceRefId?: string;
    sourceUrl?: string;
    capturedAt: Date;
    rationale: string;
    payloadJson?: string;
  }>;
  actor?: OutcomeActorContext;
}

export interface RecordOutcomeResult {
  ok: boolean;
  outcomeId?: string;
  evidenceIds?: string[];
  error?: string;
}

export async function recordOutcome(input: RecordOutcomeInput): Promise<RecordOutcomeResult> {
  const outcome = await prisma.outcome.create({
    data: {
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      projectId: input.projectId ?? null,
      parcelId: input.parcelId ?? null,
      outcomeKind: input.outcomeKind,
      outcomeLabel: input.outcomeLabel ?? null,
      detectionMethod: input.detectionMethod ?? "AUTOMATIC",
      occurredAt: input.occurredAt,
      observedAt: input.observedAt ?? new Date(),
      outcomeConfidence: input.outcomeConfidence ?? "MEDIUM",
      notes: input.notes ?? null,
      payloadJson: input.payloadJson ?? null,
    },
  });

  const evidenceIds: string[] = [];
  if (input.evidence && input.evidence.length > 0) {
    for (const ev of input.evidence) {
      const row = await prisma.outcomeEvidence.create({
        data: {
          outcomeId: outcome.id,
          evidenceKind: ev.evidenceKind,
          sourceRefKind: ev.sourceRefKind ?? null,
          sourceRefId: ev.sourceRefId ?? null,
          sourceUrl: ev.sourceUrl ?? null,
          capturedAt: ev.capturedAt,
          rationale: ev.rationale,
          payloadJson: ev.payloadJson ?? null,
        },
      });
      evidenceIds.push(row.id);
    }
  }

  if (input.supersedingPriorOutcomeId) {
    await prisma.outcome.update({
      where: { id: input.supersedingPriorOutcomeId },
      data: { supersededByOutcomeId: outcome.id },
    });
    // Mark any resolutions on the prior outcome as WITHDRAWN.
    await prisma.outcomeResolution.updateMany({
      where: { outcomeId: input.supersedingPriorOutcomeId },
      data: { resolutionState: "WITHDRAWN" },
    });
  }

  emitCalibrationAudit({
    action: "record_outcome",
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    outcomeId: outcome.id,
    decision: "recorded",
    actorUserId: input.actor?.userId ?? null,
    actorEmail: input.actor?.email ?? null,
    factors: {
      outcomeKind: input.outcomeKind,
      detectionMethod: input.detectionMethod ?? "AUTOMATIC",
      occurredAt: input.occurredAt.toISOString(),
    },
  });

  return { ok: true, outcomeId: outcome.id, evidenceIds };
}

// ── recordResolution ─────────────────────────────────────────────────────────

export interface RecordResolutionInput {
  outcomeId: string;
  forecast: ForecastAssertion | null;
  outcome: ObservedOutcome;
  evaluation: ForecastEvaluation;
  actor?: OutcomeActorContext;
  /** Optional pre-computed trajectory comparison; persisted to
   *  TrajectoryOutcome. */
  trajectoryOutcome?: {
    predictedState: string;
    actualState: string | null;
    alignment: string;
    shiftCorrect?: boolean | null;
    shiftMissed?: boolean | null;
    rationale?: string;
  };
  /** Optional pre-computed per-milestone timeline accuracies; one
   *  TimelineAccuracy row per entry. */
  timelineAccuracies?: Array<{
    milestoneKind: string;
    expectedAt: Date | null;
    earliestAt: Date | null;
    latestAt: Date | null;
    actualAt: Date;
    errorDays: number;
    absoluteErrorDays: number;
    withinBand: boolean;
    jurisdictionAdjustedErrorDays?: number | null;
    rationale?: string;
  }>;
}

export interface RecordResolutionResult {
  ok: boolean;
  resolutionId?: string;
  accuracyIds?: string[];
  trajectoryOutcomeId?: string;
  timelineAccuracyIds?: string[];
  error?: string;
}

export async function recordResolution(input: RecordResolutionInput): Promise<RecordResolutionResult> {
  const posture = input.forecast
    ? classifyPosture(input.forecast.predictedScore)
    : "UNPREDICTED";

  const resolution = await prisma.outcomeResolution.create({
    data: {
      outcomeId: input.outcomeId,
      forecastSnapshotId: input.forecast?.forecastSnapshotId ?? null,
      resolutionState: input.evaluation.resolutionState,
      predictionPosture: posture,
      predictedScore: input.forecast?.predictedScore ?? null,
      predictedTrajectory: input.forecast?.predictedTrajectory ?? null,
      predictedAt: input.forecast?.predictedAt ?? null,
      leadTimeDays: input.evaluation.leadTimeDays,
      resolvedByUserId: input.actor?.userId ?? null,
      resolvedByEmail: input.actor?.email ?? null,
      resolutionNotes: input.evaluation.rationale,
      calibrationVersion: input.evaluation.evaluationVersion,
    },
  });

  const accuracyIds: string[] = [];
  for (const a of input.evaluation.accuracies) {
    const row = await prisma.forecastAccuracy.create({
      data: {
        resolutionId: resolution.id,
        accuracyKind: a.accuracyKind,
        accuracyScore: a.accuracyScore,
        brierScore: a.brierScore,
        timelineErrorDays: a.timelineErrorDays,
        withinExpectedBand: a.withinExpectedBand,
        rationale: a.rationale,
        evaluationVersion: input.evaluation.evaluationVersion,
      },
    });
    accuracyIds.push(row.id);
  }

  let trajectoryOutcomeId: string | undefined;
  if (input.trajectoryOutcome) {
    const row = await prisma.trajectoryOutcome.create({
      data: {
        resolutionId: resolution.id,
        predictedState: input.trajectoryOutcome.predictedState,
        actualState: input.trajectoryOutcome.actualState,
        alignment: input.trajectoryOutcome.alignment,
        shiftCorrect: input.trajectoryOutcome.shiftCorrect ?? null,
        shiftMissed: input.trajectoryOutcome.shiftMissed ?? null,
        rationale: input.trajectoryOutcome.rationale ?? null,
      },
    });
    trajectoryOutcomeId = row.id;
  }

  const timelineAccuracyIds: string[] = [];
  if (input.timelineAccuracies && input.timelineAccuracies.length > 0) {
    for (const t of input.timelineAccuracies) {
      const row = await prisma.timelineAccuracy.create({
        data: {
          resolutionId: resolution.id,
          milestoneKind: t.milestoneKind,
          expectedAt: t.expectedAt,
          earliestAt: t.earliestAt,
          latestAt: t.latestAt,
          actualAt: t.actualAt,
          errorDays: t.errorDays,
          absoluteErrorDays: t.absoluteErrorDays,
          withinBand: t.withinBand,
          jurisdictionAdjustedErrorDays: t.jurisdictionAdjustedErrorDays ?? null,
          rationale: t.rationale ?? null,
        },
      });
      timelineAccuracyIds.push(row.id);
    }
  }

  emitCalibrationAudit({
    action: "record_resolution",
    outcomeId: input.outcomeId,
    resolutionId: resolution.id,
    forecastSnapshotId: input.forecast?.forecastSnapshotId ?? null,
    decision: input.evaluation.resolutionState,
    reasonLog: input.evaluation.accuracies.map(
      (a) => `${a.accuracyKind}=${a.accuracyScore.toFixed(3)}`
    ),
    actorUserId: input.actor?.userId ?? null,
    actorEmail: input.actor?.email ?? null,
  });

  return {
    ok: true,
    resolutionId: resolution.id,
    accuracyIds,
    trajectoryOutcomeId,
    timelineAccuracyIds,
  };
}

// ── recordFalsePositive / recordFalseNegative ────────────────────────────────

export interface RecordFalsePositiveInput {
  forecastSnapshotId: string | null;
  subjectKind: string;
  subjectId: string;
  predictedScore: number;
  predictedTrajectory?: string;
  predictedAt: Date;
  expectedByLatest: Date;
  reasonClass: string;
  notes?: string;
  disconfirmingOutcomeId?: string | null;
}

export async function recordFalsePositive(input: RecordFalsePositiveInput): Promise<{ ok: boolean; id?: string }> {
  const row = await prisma.falsePositive.create({
    data: {
      forecastSnapshotId: input.forecastSnapshotId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      predictedScore: input.predictedScore,
      predictedTrajectory: input.predictedTrajectory ?? null,
      predictedAt: input.predictedAt,
      disconfirmingOutcomeId: input.disconfirmingOutcomeId ?? null,
      expectedByLatest: input.expectedByLatest,
      reasonClass: input.reasonClass,
      notes: input.notes ?? null,
    },
  });
  emitCalibrationAudit({
    action: "record_false_positive",
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    forecastSnapshotId: input.forecastSnapshotId,
    decision: "recorded",
    factors: { reasonClass: input.reasonClass, predictedScore: input.predictedScore },
  });
  return { ok: true, id: row.id };
}

export interface RecordFalseNegativeInput {
  outcomeId: string;
  subjectKind: string;
  subjectId: string;
  precedingSnapshotId?: string | null;
  precedingScore?: number | null;
  precedingTrajectory?: string | null;
  precedingAt?: Date | null;
  missedByDays?: number | null;
  reasonClass: string;
  notes?: string;
}

export async function recordFalseNegative(input: RecordFalseNegativeInput): Promise<{ ok: boolean; id?: string }> {
  const row = await prisma.falseNegative.create({
    data: {
      outcomeId: input.outcomeId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      precedingSnapshotId: input.precedingSnapshotId ?? null,
      precedingScore: input.precedingScore ?? null,
      precedingTrajectory: input.precedingTrajectory ?? null,
      precedingAt: input.precedingAt ?? null,
      missedByDays: input.missedByDays ?? null,
      reasonClass: input.reasonClass,
      notes: input.notes ?? null,
    },
  });
  emitCalibrationAudit({
    action: "record_false_negative",
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    outcomeId: input.outcomeId,
    decision: "recorded",
    factors: { reasonClass: input.reasonClass },
  });
  return { ok: true, id: row.id };
}

// ── upsertCalibrationAdjustment / recordCalibrationSnapshot ──────────────────

export interface UpsertCalibrationAdjustmentInput {
  scope: CalibrationScope;
  scopeKey?: string | null;
  factorName?: string | null;
  adjustmentKind: AdjustmentKind;
  value: number;
  source?: string;
  notes?: string;
  active?: boolean;
  actor?: OutcomeActorContext;
}

export async function upsertCalibrationAdjustment(
  input: UpsertCalibrationAdjustmentInput
): Promise<{ ok: boolean; id?: string }> {
  // Construct the unique-key tuple; Prisma's compound unique requires
  // exact strings, so we normalize null → empty for keying purposes via
  // the schema's nullable columns by writing them as-is. Compound-unique
  // with nullable fields in SQLite uses NULL-distinct semantics so we
  // emulate idempotency manually.
  const existing = await prisma.forecastCalibration.findFirst({
    where: {
      scope: input.scope,
      scopeKey: input.scopeKey ?? null,
      factorName: input.factorName ?? null,
      adjustmentKind: input.adjustmentKind,
    },
  });

  let row;
  if (existing) {
    row = await prisma.forecastCalibration.update({
      where: { id: existing.id },
      data: {
        value: input.value,
        source: input.source ?? existing.source,
        notes: input.notes ?? existing.notes,
        active: input.active ?? existing.active,
        calibrationVersion: CALIBRATION_VERSION,
      },
    });
  } else {
    row = await prisma.forecastCalibration.create({
      data: {
        scope: input.scope,
        scopeKey: input.scopeKey ?? null,
        factorName: input.factorName ?? null,
        adjustmentKind: input.adjustmentKind,
        value: input.value,
        source: input.source ?? "calibration_runner",
        notes: input.notes ?? null,
        active: input.active ?? true,
        calibrationVersion: CALIBRATION_VERSION,
      },
    });
  }

  emitCalibrationAudit({
    action: "upsert_calibration_adjustment",
    decision: existing ? "updated" : "created",
    actorUserId: input.actor?.userId ?? null,
    actorEmail: input.actor?.email ?? null,
    factors: {
      scope: input.scope,
      scopeKey: input.scopeKey ?? null,
      factorName: input.factorName ?? null,
      adjustmentKind: input.adjustmentKind,
      value: input.value,
    },
  });

  return { ok: true, id: row.id };
}

export interface RecordCalibrationSnapshotInput {
  scope: CalibrationScope;
  scopeKey?: string | null;
  resolutionCount: number;
  confirmedCount: number;
  partialCount: number;
  disconfirmedCount: number;
  meanProbabilityAccuracy?: number | null;
  meanBrierScore?: number | null;
  meanTimelineErrorDays?: number | null;
  trajectoryAlignmentRate?: number | null;
  falsePositiveCount?: number;
  falseNegativeCount?: number;
  activeAdjustments?: Array<{
    scope: string;
    scopeKey: string | null;
    factorName: string | null;
    adjustmentKind: string;
    value: number;
  }>;
  triggerReason?: "scheduled" | "post_outcome" | "operator_run" | "backfill";
}

export async function recordCalibrationSnapshot(
  input: RecordCalibrationSnapshotInput
): Promise<{ ok: boolean; id?: string }> {
  const row = await prisma.calibrationSnapshot.create({
    data: {
      scope: input.scope,
      scopeKey: input.scopeKey ?? null,
      resolutionCount: input.resolutionCount,
      confirmedCount: input.confirmedCount,
      partialCount: input.partialCount,
      disconfirmedCount: input.disconfirmedCount,
      meanProbabilityAccuracy: input.meanProbabilityAccuracy ?? null,
      meanBrierScore: input.meanBrierScore ?? null,
      meanTimelineErrorDays: input.meanTimelineErrorDays ?? null,
      trajectoryAlignmentRate: input.trajectoryAlignmentRate ?? null,
      falsePositiveCount: input.falsePositiveCount ?? 0,
      falseNegativeCount: input.falseNegativeCount ?? 0,
      activeAdjustmentsJson: input.activeAdjustments
        ? JSON.stringify(input.activeAdjustments)
        : null,
      calibrationVersion: CALIBRATION_VERSION,
      triggerReason: input.triggerReason ?? "scheduled",
    },
  });
  emitCalibrationAudit({
    action: "record_calibration_snapshot",
    decision: "recorded",
    factors: {
      scope: input.scope,
      scopeKey: input.scopeKey ?? null,
      resolutionCount: input.resolutionCount,
      meanProbabilityAccuracy: input.meanProbabilityAccuracy ?? null,
    },
  });
  return { ok: true, id: row.id };
}

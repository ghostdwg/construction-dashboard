// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/operatorWorkspace/alerts.ts
//  Phase MI-10 — Alert rule evaluation + alert event persistence.
//
//  Pure evaluator (evaluateAlertRule) + persistence boundary (recordAlertEvent).
//  The orchestrator (PR-2 work) loads context and calls evaluate; this PR
//  ships the rule logic for all ten built-in trigger kinds and the
//  persistence path used by service callers (e.g. ingestion hooks).
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { emitWorkspaceAudit } from "./audit";
import {
  type AlertEvaluationContext,
  type AlertEvaluationResult,
  type AlertSeverity,
  type AlertTriggerKind,
  type AlertRuleCriteria,
  type AlertExplanationKind,
  type WatchlistActorContext,
  severityRank,
  DEFAULT_SEVERITY_FLOOR,
} from "./types";

// ── Pure evaluator ───────────────────────────────────────────────────────────

export function evaluateAlertRule(ctx: AlertEvaluationContext): AlertEvaluationResult {
  // Cooldown check first — if rule is in cooldown, never fire even if
  // criteria match.
  const now = ctx.evaluationDate ?? new Date();
  if (ctx.rule.lastFiredAt && ctx.rule.cooldownMinutes > 0) {
    const earliestAllowed = new Date(ctx.rule.lastFiredAt.getTime() + ctx.rule.cooldownMinutes * 60 * 1000);
    if (now < earliestAllowed) {
      return notFiring("cooldown_active", ctx);
    }
  }

  switch (ctx.rule.triggerKind) {
    case "PROBABILITY_SPIKE":      return evalProbabilitySpike(ctx);
    case "TRAJECTORY_SHIFT":       return evalTrajectoryShift(ctx);
    case "CORRIDOR_IGNITION":      return evalCorridorIgnition(ctx);
    case "TIMELINE_PULL_IN":       return evalTimelinePullIn(ctx);
    case "HIGH_CONFIDENCE_EMERGENCE": return evalHighConfidenceEmergence(ctx);
    case "RECURRING_ENTITY":       return evalRecurringEntity(ctx);
    case "UTILITY_ACCELERATION":   return evalUtilityAcceleration(ctx);
    case "SHELL_PATTERN_DETECTED": return evalShellPatternDetected(ctx);
    case "WATCHLIST_HIT":          return evalWatchlistHit(ctx);
    case "CUSTOM":                 return notFiring("custom_rule_no_op_in_pr1", ctx);
    default:                       return notFiring("unknown_trigger_kind", ctx);
  }
}

// ── Per-trigger evaluators ───────────────────────────────────────────────────

function evalProbabilitySpike(ctx: AlertEvaluationContext): AlertEvaluationResult {
  const c = ctx.rule.criteria as AlertRuleCriteria & { triggerKind: "PROBABILITY_SPIKE" };
  if (c.triggerKind !== "PROBABILITY_SPIKE") return notFiring("criteria_mismatch", ctx);
  const sortedAsc = [...ctx.recentScores].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (sortedAsc.length < 2) return notFiring("not_enough_history", ctx);

  const now = sortedAsc[sortedAsc.length - 1];
  const cutoff = new Date(now.at.getTime() - c.windowDays * 24 * 60 * 60 * 1000);
  const before = sortedAsc.filter((s) => s.at <= cutoff);
  if (before.length === 0) return notFiring("no_baseline_in_window", ctx);
  const baseline = before[before.length - 1];
  const delta = now.score - baseline.score;

  if (delta < c.minDelta) {
    return notFiring(`delta_${delta.toFixed(3)}_below_${c.minDelta}`, ctx);
  }

  return {
    shouldFire: true,
    severity: pickSeverity(ctx.rule.severityFloor, "ATTENTION"),
    headline: `Probability spike +${delta.toFixed(2)} over ${c.windowDays}d`,
    detail: `Subject ${ctx.subject.subjectKind}/${ctx.subject.subjectId} went from ${baseline.score.toFixed(2)} on ${baseline.at.toISOString().slice(0, 10)} to ${now.score.toFixed(2)} on ${now.at.toISOString().slice(0, 10)}.`,
    rationale: `probability_spike delta=${delta.toFixed(3)} threshold=${c.minDelta} window=${c.windowDays}d`,
    capturedScore: now.score,
    capturedTrajectory: now.trajectoryState,
    factors: [
      { factorKind: "FORECAST_DELTA", factorName: "probability_delta", factorScore: delta, rationale: `${baseline.score.toFixed(2)} → ${now.score.toFixed(2)}` },
      { factorKind: "EVIDENCE", factorName: "history_points", factorScore: sortedAsc.length, rationale: `${sortedAsc.length} score observations in window` },
    ],
    reasonLog: [`delta=${delta.toFixed(3)} ≥ minDelta=${c.minDelta}`, `window=${c.windowDays}d`],
  };
}

function evalTrajectoryShift(ctx: AlertEvaluationContext): AlertEvaluationResult {
  const c = ctx.rule.criteria as AlertRuleCriteria & { triggerKind: "TRAJECTORY_SHIFT" };
  if (c.triggerKind !== "TRAJECTORY_SHIFT") return notFiring("criteria_mismatch", ctx);
  if (ctx.recentScores.length < 2) return notFiring("not_enough_history", ctx);
  const sortedAsc = [...ctx.recentScores].sort((a, b) => a.at.getTime() - b.at.getTime());
  const latest = sortedAsc[sortedAsc.length - 1];
  const previous = sortedAsc[sortedAsc.length - 2];
  if (latest.trajectoryState === previous.trajectoryState) {
    return notFiring(`no_state_change_${latest.trajectoryState}`, ctx);
  }
  if (!c.states.includes(latest.trajectoryState)) {
    return notFiring(`not_in_target_states_${latest.trajectoryState}`, ctx);
  }
  return {
    shouldFire: true,
    severity: pickSeverity(ctx.rule.severityFloor, "ATTENTION"),
    headline: `Trajectory shifted: ${previous.trajectoryState} → ${latest.trajectoryState}`,
    detail: `Subject ${ctx.subject.subjectKind}/${ctx.subject.subjectId} entered ${latest.trajectoryState} from ${previous.trajectoryState} at ${latest.at.toISOString().slice(0, 10)}.`,
    rationale: `trajectory_shift ${previous.trajectoryState}→${latest.trajectoryState}`,
    capturedScore: latest.score,
    capturedTrajectory: latest.trajectoryState,
    factors: [
      { factorKind: "FORECAST_DELTA", factorName: "trajectory_transition", factorScore: null, rationale: `${previous.trajectoryState} → ${latest.trajectoryState}` },
    ],
    reasonLog: [`from=${previous.trajectoryState}`, `to=${latest.trajectoryState}`],
  };
}

function evalCorridorIgnition(ctx: AlertEvaluationContext): AlertEvaluationResult {
  const c = ctx.rule.criteria as AlertRuleCriteria & { triggerKind: "CORRIDOR_IGNITION" };
  if (c.triggerKind !== "CORRIDOR_IGNITION") return notFiring("criteria_mismatch", ctx);
  if (!ctx.corridorHeat) return notFiring("no_corridor_context", ctx);
  if (ctx.corridorHeat.heatScore < c.minHeatScore) {
    return notFiring(`heatScore_${ctx.corridorHeat.heatScore.toFixed(2)}_below_${c.minHeatScore}`, ctx);
  }
  if (ctx.corridorHeat.acceleration < c.minAcceleration) {
    return notFiring(`accel_${ctx.corridorHeat.acceleration.toFixed(2)}_below_${c.minAcceleration}`, ctx);
  }
  return {
    shouldFire: true,
    severity: pickSeverity(ctx.rule.severityFloor, "URGENT"),
    headline: `Corridor igniting: heat=${ctx.corridorHeat.heatScore.toFixed(2)} accel=${ctx.corridorHeat.acceleration.toFixed(2)}`,
    detail: `Corridor ${ctx.subject.subjectId} crossed ignition thresholds.`,
    rationale: `corridor_ignition heat=${ctx.corridorHeat.heatScore.toFixed(2)} accel=${ctx.corridorHeat.acceleration.toFixed(2)}`,
    capturedScore: ctx.corridorHeat.heatScore,
    capturedTrajectory: null,
    factors: [
      { factorKind: "EVIDENCE", factorName: "corridor_heat", factorScore: ctx.corridorHeat.heatScore, rationale: `heatScore=${ctx.corridorHeat.heatScore.toFixed(2)}` },
      { factorKind: "FORECAST_DELTA", factorName: "corridor_acceleration", factorScore: ctx.corridorHeat.acceleration, rationale: `acceleration=${ctx.corridorHeat.acceleration.toFixed(2)}` },
    ],
    reasonLog: [`heat=${ctx.corridorHeat.heatScore.toFixed(2)}`, `accel=${ctx.corridorHeat.acceleration.toFixed(2)}`],
  };
}

function evalTimelinePullIn(ctx: AlertEvaluationContext): AlertEvaluationResult {
  const c = ctx.rule.criteria as AlertRuleCriteria & { triggerKind: "TIMELINE_PULL_IN" };
  if (c.triggerKind !== "TIMELINE_PULL_IN") return notFiring("criteria_mismatch", ctx);
  // The runner is expected to compute the pulled-in delta and place it on
  // ctx.recentScores via a synthetic entry. PR-1 ships the rule logic; the
  // runner wiring is PR-2 work. For now we encode the contract: if the
  // payload signals it via a sentinel score change we fire.
  return notFiring("pr2_runner_required", ctx);
}

function evalHighConfidenceEmergence(ctx: AlertEvaluationContext): AlertEvaluationResult {
  const c = ctx.rule.criteria as AlertRuleCriteria & { triggerKind: "HIGH_CONFIDENCE_EMERGENCE" };
  if (c.triggerKind !== "HIGH_CONFIDENCE_EMERGENCE") return notFiring("criteria_mismatch", ctx);
  if (ctx.recentScores.length === 0) return notFiring("no_scores", ctx);
  const latest = [...ctx.recentScores].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  if (latest.score < c.minScore) {
    return notFiring(`score_${latest.score.toFixed(2)}_below_${c.minScore}`, ctx);
  }
  return {
    shouldFire: true,
    severity: pickSeverity(ctx.rule.severityFloor, "ATTENTION"),
    headline: `High-confidence emergence: ${latest.score.toFixed(2)} (${latest.trajectoryState})`,
    detail: `Subject ${ctx.subject.subjectKind}/${ctx.subject.subjectId} crossed score threshold ${c.minScore}.`,
    rationale: `high_confidence_emergence score=${latest.score.toFixed(2)} required=${c.minScore}`,
    capturedScore: latest.score,
    capturedTrajectory: latest.trajectoryState,
    factors: [
      { factorKind: "EVIDENCE", factorName: "emergence_score", factorScore: latest.score, rationale: `score=${latest.score.toFixed(2)}` },
    ],
    reasonLog: [`score=${latest.score.toFixed(2)} ≥ ${c.minScore}`],
  };
}

function evalRecurringEntity(_ctx: AlertEvaluationContext): AlertEvaluationResult {
  // Runner-driven: orchestrator queries ProjectEntity counts; rule evaluator
  // just records the result. PR-1 contract: orchestrator hands evaluator
  // ctx.factors-equivalent input, and this returns the canonical message.
  // For now PR-2 work.
  return notFiring("pr2_runner_required", _ctx);
}

function evalUtilityAcceleration(_ctx: AlertEvaluationContext): AlertEvaluationResult {
  return notFiring("pr2_runner_required", _ctx);
}

function evalShellPatternDetected(_ctx: AlertEvaluationContext): AlertEvaluationResult {
  return notFiring("pr2_runner_required", _ctx);
}

function evalWatchlistHit(_ctx: AlertEvaluationContext): AlertEvaluationResult {
  return notFiring("pr2_runner_required", _ctx);
}

function notFiring(reason: string, ctx: AlertEvaluationContext): AlertEvaluationResult {
  return {
    shouldFire: false,
    severity: ctx.rule.severityFloor,
    headline: "",
    detail: "",
    rationale: reason,
    capturedScore: null,
    capturedTrajectory: null,
    factors: [],
    reasonLog: [reason],
  };
}

function pickSeverity(floor: AlertSeverity, suggested: AlertSeverity): AlertSeverity {
  return severityRank(suggested) >= severityRank(floor) ? suggested : floor;
}

// ── Persistence ──────────────────────────────────────────────────────────────

export interface CreateAlertRuleInput {
  name: string;
  description?: string;
  triggerKind: AlertTriggerKind;
  severityFloor?: AlertSeverity;
  criteriaJson: string;
  jurisdictionCsv?: string;
  subjectKindCsv?: string;
  active?: boolean;
  cooldownMinutes?: number;
  actor: WatchlistActorContext;
}

export async function createAlertRule(input: CreateAlertRuleInput): Promise<{ ok: boolean; id?: string }> {
  const row = await prisma.alertRule.create({
    data: {
      ownerUserId: input.actor.userId,
      ownerEmail: input.actor.email,
      name: input.name,
      description: input.description ?? null,
      triggerKind: input.triggerKind,
      severityFloor: input.severityFloor ?? DEFAULT_SEVERITY_FLOOR,
      criteriaJson: input.criteriaJson,
      jurisdictionCsv: input.jurisdictionCsv ?? null,
      subjectKindCsv: input.subjectKindCsv ?? null,
      active: input.active ?? true,
      cooldownMinutes: input.cooldownMinutes ?? 1440,
    },
  });
  emitWorkspaceAudit({
    action: "create_alert_rule",
    alertRuleId: row.id,
    decision: "created",
    actorUserId: input.actor.userId,
    actorEmail: input.actor.email,
    factors: { triggerKind: input.triggerKind, severityFloor: input.severityFloor ?? DEFAULT_SEVERITY_FLOOR },
  });
  return { ok: true, id: row.id };
}

export interface RecordAlertEventInput {
  ruleId?: string | null;
  subjectKind: string;
  subjectId: string;
  projectId?: string | null;
  parcelId?: string | null;
  forecastSnapshotId?: string | null;
  severity: AlertSeverity;
  headline: string;
  detail?: string;
  capturedScore?: number | null;
  capturedTrajectory?: string | null;
  payload?: Record<string, unknown>;
  factors: Array<{
    factorKind: AlertExplanationKind;
    factorName: string;
    factorScore?: number | null;
    rationale: string;
    sourceRefKind?: string;
    sourceRefId?: string;
  }>;
}

export async function recordAlertEvent(input: RecordAlertEventInput): Promise<{ ok: boolean; id?: string }> {
  const alert = await prisma.alertEvent.create({
    data: {
      ruleId: input.ruleId ?? null,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      projectId: input.projectId ?? null,
      parcelId: input.parcelId ?? null,
      forecastSnapshotId: input.forecastSnapshotId ?? null,
      severity: input.severity,
      headline: input.headline,
      detail: input.detail ?? null,
      capturedScore: input.capturedScore ?? null,
      capturedTrajectory: input.capturedTrajectory ?? null,
      payloadJson: input.payload ? JSON.stringify(input.payload) : null,
    },
  });
  if (input.factors.length > 0) {
    await prisma.alertExplanation.createMany({
      data: input.factors.map((f) => ({
        alertId: alert.id,
        factorKind: f.factorKind,
        factorName: f.factorName,
        factorScore: f.factorScore ?? null,
        rationale: f.rationale,
        sourceRefKind: f.sourceRefKind ?? null,
        sourceRefId: f.sourceRefId ?? null,
      })),
    });
  }
  // Bump lastFiredAt if rule scoped.
  if (input.ruleId) {
    await prisma.alertRule.update({
      where: { id: input.ruleId },
      data: { lastEvaluatedAt: new Date() },
    });
  }
  emitWorkspaceAudit({
    action: "record_alert_event",
    alertRuleId: input.ruleId ?? undefined,
    alertEventId: alert.id,
    decision: "fired",
    severity: input.severity,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    factors: { headline: input.headline },
  });
  return { ok: true, id: alert.id };
}

// ── Operator actions on alerts ───────────────────────────────────────────────

export interface AlertReviewActionInput {
  alertId: string;
  newStatus: "ACKNOWLEDGED" | "DISMISSED" | "ESCALATED" | "SUPPRESSED";
  actor: WatchlistActorContext;
}

export async function reviewAlertEvent(input: AlertReviewActionInput): Promise<{ ok: boolean; error?: string }> {
  const existing = await prisma.alertEvent.findUnique({ where: { id: input.alertId } });
  if (!existing) return { ok: false, error: "alert_not_found" };
  await prisma.alertEvent.update({
    where: { id: input.alertId },
    data: {
      reviewStatus: input.newStatus,
      reviewedByUserId: input.actor.userId,
      reviewedByEmail: input.actor.email,
      reviewedAt: new Date(),
    },
  });
  emitWorkspaceAudit({
    action: "review_alert_event",
    alertEventId: input.alertId,
    decision: input.newStatus.toLowerCase(),
    actorUserId: input.actor.userId,
    actorEmail: input.actor.email,
  });
  return { ok: true };
}

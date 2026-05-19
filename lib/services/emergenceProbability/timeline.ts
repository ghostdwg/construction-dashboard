// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/emergenceProbability/timeline.ts
//  Phase MI-8 — Expected-timeline forecaster.
//
//  Heuristic-only. Given a subject's current MI-6 lifecycle state and
//  emergence score, this produces (earliest, expected, latest) bounded
//  estimates for each downstream milestone. The model is anchored on
//  empirically reasonable typical durations per construction lifecycle
//  transition; uncertainty bounds widen as the score drops.
//
//  No DB; pure function. The orchestrator persists the result rows.
// ──────────────────────────────────────────────────────────────────────────────

import {
  type ExpectedTimelinePoint,
  type MilestoneKind,
  type ForecastConfidence,
  type TrajectoryState,
} from "./types";

/** Typical days from the moment a project is in a given lifecycle state
 *  until the named milestone is reached. The orchestrator uses these as
 *  base durations and modulates by emergence score + trajectory.
 *
 *  Numbers are rough operator-facing defaults; PR-3 governance can tune
 *  per-jurisdiction in a future SignalDecayProfile-like config table.
 */
const BASE_DURATIONS_FROM_STATE: Record<string, Partial<Record<MilestoneKind, number>>> = {
  EMERGING: {
    ENTITLEMENT_START: 90,
    ENTITLEMENT_DECISION: 240,
    PERMIT_ISSUED: 360,
    SITE_PREP_START: 420,
    CONSTRUCTION_START: 480,
    COMPLETION: 900,
  },
  EARLY_SIGNAL: {
    ENTITLEMENT_START: 60,
    ENTITLEMENT_DECISION: 200,
    PERMIT_ISSUED: 320,
    SITE_PREP_START: 380,
    CONSTRUCTION_START: 440,
    COMPLETION: 860,
  },
  PRE_ENTITLEMENT: {
    ENTITLEMENT_START: 14,
    ENTITLEMENT_DECISION: 140,
    PERMIT_ISSUED: 240,
    SITE_PREP_START: 300,
    CONSTRUCTION_START: 360,
    COMPLETION: 780,
  },
  ENTITLEMENT: {
    ENTITLEMENT_DECISION: 90,
    PERMIT_ISSUED: 180,
    SITE_PREP_START: 240,
    CONSTRUCTION_START: 300,
    COMPLETION: 720,
  },
  SITE_PREP: {
    PERMIT_ISSUED: 30,
    SITE_PREP_START: 0,
    CONSTRUCTION_START: 60,
    COMPLETION: 480,
  },
  PRE_CONSTRUCTION: {
    PERMIT_ISSUED: 14,
    CONSTRUCTION_START: 30,
    COMPLETION: 450,
  },
  ACTIVE_CONSTRUCTION: {
    CONSTRUCTION_START: 0,
    COMPLETION: 360,
  },
  STALLED: {
    ENTITLEMENT_DECISION: 730,
    PERMIT_ISSUED: 900,
    CONSTRUCTION_START: 1095,
    COMPLETION: 1825,
  },
  ABANDONED: {},
  COMPLETED: {},
};

export interface ExpectedTimelineInput {
  lifecycleState: string;
  emergenceScore: number;       // [0..1]
  trajectoryState: TrajectoryState;
  /** Reference date — usually now(). Tests pass a fixed Date for determinism. */
  referenceDate?: Date;
  /** When set, additional padding (days) added to all estimates to convey
   *  jurisdictional slowness. */
  jurisdictionLagDays?: number;
}

/** Compute the expected timeline points for every still-future milestone
 *  given the current state. */
export function computeExpectedTimeline(input: ExpectedTimelineInput): ExpectedTimelinePoint[] {
  const ref = input.referenceDate ?? new Date();
  const lag = input.jurisdictionLagDays ?? 0;

  const baseTable = BASE_DURATIONS_FROM_STATE[input.lifecycleState] ?? {};

  // High emergence score → estimates tighten + pull in.
  // Low emergence score → estimates widen + push out.
  const scoreMultiplier = scoreMultiplierFor(input.emergenceScore);
  // Trajectory modulates expected vs latest spread.
  const spreadMultiplier = spreadMultiplierFor(input.trajectoryState);

  const out: ExpectedTimelinePoint[] = [];

  for (const [milestoneKey, baseDays] of Object.entries(baseTable)) {
    if (baseDays == null) continue;
    const milestoneKind = milestoneKey as MilestoneKind;
    const days = Math.max(0, baseDays * scoreMultiplier + lag);
    // Earliest = expected × 0.7; latest = expected × (1 + spread).
    const expectedAt = addDays(ref, days);
    const earliestAt = addDays(ref, Math.max(0, days * 0.7));
    const latestAt = addDays(ref, days * (1 + spreadMultiplier));

    out.push({
      milestoneKind,
      earliestEstimate: earliestAt,
      expectedEstimate: expectedAt,
      latestEstimate: latestAt,
      confidence: confidenceFor(input.emergenceScore, input.trajectoryState),
      rationale: `state=${input.lifecycleState} score=${input.emergenceScore.toFixed(2)} traj=${input.trajectoryState} base=${baseDays}d`,
    });
  }

  return out;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function scoreMultiplierFor(score: number): number {
  // Score of 1 → 0.7× (pull in by 30%); score of 0 → 1.5× (push out by 50%).
  const clampedScore = Math.max(0, Math.min(1, score));
  return 1.5 - 0.8 * clampedScore;
}

function spreadMultiplierFor(state: TrajectoryState): number {
  switch (state) {
    case "IGNITING":
    case "ACCELERATING": return 0.25;
    case "STEADY":        return 0.30;
    case "EMERGING":      return 0.50;
    case "DECELERATING":  return 0.60;
    case "STALLED":
    case "DECAYING":      return 1.00;
    case "DORMANT":       return 2.00;
    default:              return 0.50;
  }
}

function confidenceFor(score: number, state: TrajectoryState): ForecastConfidence {
  if (state === "DORMANT" || state === "DECAYING") return "LOW";
  if (score >= 0.70 && (state === "ACCELERATING" || state === "STEADY")) return "HIGH";
  if (score < 0.20) return "LOW";
  return "MEDIUM";
}

// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/emergenceProbability/trajectory.ts
//  Phase MI-8 — Trajectory state machine + acceleration + decay detection.
//
//  Pure functions that derive trajectory state from a time series of past
//  emergence scores. The orchestrator pulls the history once per forecast
//  cycle and passes it in; no DB calls live here.
//
//  Trajectory states:
//    EMERGING     — first signals; score low but rising
//    IGNITING     — recent positive acceleration from a cold start
//    ACCELERATING — sustained positive acceleration
//    STEADY       — small derivative, high score
//    DECELERATING — negative acceleration, score still > 0
//    STALLED      — low derivative + low new-signal volume
//    DECAYING     — sustained negative acceleration; score falling
//    DORMANT      — long period without signals; archived state
//
//  Transition rules are deterministic and explainable. detectMomentumShift
//  flags second-derivative reversals so the UI can highlight them.
// ──────────────────────────────────────────────────────────────────────────────

import {
  type AccelerationResult,
  type TrajectoryDecision,
  type TrajectoryState,
  TRAJECTORY_THRESHOLDS,
} from "./types";

/** A historical score observation. Older entries first. */
export interface ScoreObservation {
  score: number;
  observedAt: Date;
}

/** Compute short-term and long-term deltas + an acceleration index from a
 *  time-ordered series of score observations. The observations should
 *  include the most recently computed score as the last element.
 *
 *  shortTermDelta: score(now) - score(~30 days ago)
 *  longTermDelta:  score(now) - score(~180 days ago)
 *  accelerationIndex: shortTermDelta - longTermDelta_recent_half — i.e. is
 *  the curve bending up or down?
 */
export function computeAcceleration(
  subjectKind: AccelerationResult["subjectKind"],
  subjectId: string,
  observations: ScoreObservation[],
  daysSinceLastSignal: number
): AccelerationResult {
  if (observations.length === 0) {
    return {
      subjectKind,
      subjectId,
      accelerationIndex: 0,
      momentumScore: 0,
      decayScore: 0,
      shortTermDelta: 0,
      longTermDelta: 0,
      shiftDetected: false,
      shiftReason: null,
      windowDays: 30,
    };
  }

  const sorted = [...observations].sort(
    (a, b) => a.observedAt.getTime() - b.observedAt.getTime()
  );
  const latest = sorted[sorted.length - 1];
  const now = latest.observedAt.getTime();

  function findClosestBefore(daysAgo: number): ScoreObservation | null {
    const target = now - daysAgo * 24 * 60 * 60 * 1000;
    let chosen: ScoreObservation | null = null;
    for (const obs of sorted) {
      if (obs.observedAt.getTime() <= target) chosen = obs;
      else break;
    }
    return chosen;
  }

  const ref30 = findClosestBefore(30);
  const ref180 = findClosestBefore(180);
  const ref60 = findClosestBefore(60);

  const shortTermDelta = ref30 ? clamp(latest.score - ref30.score, -1, 1) : 0;
  const longTermDelta = ref180 ? clamp(latest.score - ref180.score, -1, 1) : 0;

  // Acceleration index: short-term change minus the "previous short-term"
  // change (computed as 30d-to-60d delta). Positive means the curve is
  // bending up vs the previous month.
  const previousShortTerm = ref30 && ref60
    ? clamp(ref30.score - ref60.score, -1, 1)
    : 0;
  const accelerationIndex = clamp(shortTermDelta - previousShortTerm, -1, 1);

  // Momentum and decay are normalized forms of weighted positive / negative
  // deltas across the full short-window observations.
  let positiveSum = 0;
  let negativeSum = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.observedAt.getTime() < now - 90 * 24 * 60 * 60 * 1000) continue;
    const d = curr.score - prev.score;
    if (d > 0) positiveSum += d;
    else if (d < 0) negativeSum += -d;
  }
  const momentumScore = clamp(positiveSum, 0, 1);
  const decayScore = clamp(negativeSum, 0, 1);

  // Shift detection: previous-short and current-short have opposite signs
  // AND the magnitude of the new direction exceeds FLAT_BAND.
  let shiftDetected = false;
  let shiftReason: string | null = null;
  if (
    previousShortTerm < -TRAJECTORY_THRESHOLDS.FLAT_BAND &&
    shortTermDelta > TRAJECTORY_THRESHOLDS.FLAT_BAND
  ) {
    shiftDetected = true;
    shiftReason = "negative_to_positive_reversal";
  } else if (
    previousShortTerm > TRAJECTORY_THRESHOLDS.FLAT_BAND &&
    shortTermDelta < -TRAJECTORY_THRESHOLDS.FLAT_BAND
  ) {
    shiftDetected = true;
    shiftReason = "positive_to_negative_reversal";
  } else if (
    Math.abs(accelerationIndex) > TRAJECTORY_THRESHOLDS.IGNITE_BAND &&
    Math.abs(previousShortTerm) < TRAJECTORY_THRESHOLDS.FLAT_BAND
  ) {
    shiftDetected = true;
    shiftReason = accelerationIndex > 0 ? "ignition_from_flat" : "flat_to_decay";
  }

  // Days-since-last-signal sanity check: if there have been NO signals in
  // a very long time, decay overrides any latent positive deltas.
  if (daysSinceLastSignal > TRAJECTORY_THRESHOLDS.DORMANT_DAYS) {
    return {
      subjectKind,
      subjectId,
      accelerationIndex: Math.min(0, accelerationIndex),
      momentumScore: 0,
      decayScore: Math.max(decayScore, 0.5),
      shortTermDelta,
      longTermDelta,
      shiftDetected: false,
      shiftReason: null,
      windowDays: 30,
    };
  }

  return {
    subjectKind,
    subjectId,
    accelerationIndex,
    momentumScore,
    decayScore,
    shortTermDelta,
    longTermDelta,
    shiftDetected,
    shiftReason,
    windowDays: 30,
  };
}

/** Map an (emergenceScore, acceleration, previousState, daysSinceLastSignal)
 *  tuple to a TrajectoryState. Pure, deterministic, no side effects. */
export function classifyTrajectory(args: {
  emergenceScore: number;
  acceleration: AccelerationResult;
  previousState: TrajectoryState | null;
  previousStreakLength: number;
  daysSinceLastSignal: number;
}): TrajectoryDecision {
  const { emergenceScore, acceleration, previousState, previousStreakLength, daysSinceLastSignal } = args;

  let state: TrajectoryState;

  if (daysSinceLastSignal > TRAJECTORY_THRESHOLDS.DORMANT_DAYS) {
    state = "DORMANT";
  } else if (emergenceScore < TRAJECTORY_THRESHOLDS.STALLED_SCORE) {
    state =
      Math.abs(acceleration.shortTermDelta) < TRAJECTORY_THRESHOLDS.FLAT_BAND
        ? "STALLED"
        : acceleration.shortTermDelta > 0
        ? "EMERGING"
        : "DECAYING";
  } else if (acceleration.accelerationIndex > TRAJECTORY_THRESHOLDS.IGNITE_BAND) {
    // Strong positive second derivative
    state = previousState === "STALLED" || previousState === "DORMANT" || previousState === null
      ? "IGNITING"
      : "ACCELERATING";
  } else if (acceleration.accelerationIndex > TRAJECTORY_THRESHOLDS.ACCELERATE_BAND) {
    state = "ACCELERATING";
  } else if (acceleration.accelerationIndex < -TRAJECTORY_THRESHOLDS.DECAY_BAND) {
    state = acceleration.shortTermDelta < -TRAJECTORY_THRESHOLDS.FLAT_BAND ? "DECAYING" : "DECELERATING";
  } else if (acceleration.shortTermDelta < -TRAJECTORY_THRESHOLDS.FLAT_BAND) {
    state = "DECELERATING";
  } else {
    state = "STEADY";
  }

  const sameAsPrev = previousState !== null && state === previousState;
  const streakLength = sameAsPrev ? previousStreakLength + 1 : 1;

  return {
    state,
    previousState,
    streakLength,
    shiftDetected: acceleration.shiftDetected,
    shiftReason: acceleration.shiftReason,
  };
}

/** Convenience: a subject is in a decay regime when its trajectory is one of
 *  DECELERATING / DECAYING / STALLED / DORMANT. Wraps the classifier so
 *  callers don't need to reason about every state name. */
export function detectEmergenceDecay(decision: TrajectoryDecision): boolean {
  return (
    decision.state === "DECELERATING" ||
    decision.state === "DECAYING" ||
    decision.state === "STALLED" ||
    decision.state === "DORMANT"
  );
}

/** Convenience: detect a "momentum shift" without recomputing acceleration. */
export function detectMomentumShift(decision: TrajectoryDecision): boolean {
  return decision.shiftDetected;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

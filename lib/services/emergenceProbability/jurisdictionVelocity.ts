// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/emergenceProbability/jurisdictionVelocity.ts
//  Phase MI-8 — Jurisdiction-level cadence + velocity metric.
//
//  Tracks how fast new emergence appears in a given jurisdiction. Inputs are
//  rolling-window counts; the function classifies them into a cadence band.
//
//  Pure function — the orchestrator queries the rolling-window counts and
//  passes them in. Keeps the metric trivially testable.
// ──────────────────────────────────────────────────────────────────────────────

import {
  type JurisdictionVelocityResult,
  type CadenceClass,
} from "./types";
import { expSaturate, linearSaturate } from "./heuristics";

export interface JurisdictionVelocityInput {
  jurisdictionKey: string;
  jurisdictionLabel: string;
  newProjectsLast30d: number;
  newProjectsLast90d: number;
  newProjectsLast365d: number;
  newSignalsLast30d: number;
  newSignalsLast90d: number;
  /** Optional: count of NEW projects in the prior 30d window (i.e. days 30-60
   *  before now). Used to compute acceleration. When omitted, acceleration
   *  defaults to 0. */
  newProjectsPriorWindow?: number;
}

export function computeJurisdictionVelocity(
  input: JurisdictionVelocityInput
): JurisdictionVelocityResult {
  // Composite velocity: project-volume + signal-volume with saturation.
  const projVol = expSaturate(input.newProjectsLast90d, 4);
  const sigVol = expSaturate(input.newSignalsLast90d, 8);
  const newWeight = linearSaturate(input.newProjectsLast30d, 3);
  const velocityScore = clamp(0.5 * projVol + 0.3 * sigVol + 0.2 * newWeight, 0, 1);

  // Acceleration: compare 30d to prior-30d (if available); else fall back
  // to (90d - 30d*3) / max(1, 30d*3).
  let acceleration: number;
  if (input.newProjectsPriorWindow != null) {
    const denom = Math.max(1, input.newProjectsPriorWindow);
    acceleration = clamp((input.newProjectsLast30d - input.newProjectsPriorWindow) / denom, -1, 1);
  } else {
    const projected90 = input.newProjectsLast30d * 3;
    const denom = Math.max(1, projected90);
    acceleration = clamp((input.newProjectsLast90d - projected90) / denom, -1, 1);
  }

  const cadenceClass = classifyCadence(velocityScore, acceleration);

  const reasonLog = [
    `newProjectsLast30d=${input.newProjectsLast30d}`,
    `newProjectsLast90d=${input.newProjectsLast90d}`,
    `newSignalsLast30d=${input.newSignalsLast30d}`,
    `newSignalsLast90d=${input.newSignalsLast90d}`,
    `velocityScore=${velocityScore.toFixed(3)}`,
    `acceleration=${acceleration.toFixed(3)}`,
    `cadenceClass=${cadenceClass}`,
  ];

  return {
    jurisdictionKey: input.jurisdictionKey,
    jurisdictionLabel: input.jurisdictionLabel,
    newProjectsLast30d: input.newProjectsLast30d,
    newProjectsLast90d: input.newProjectsLast90d,
    newProjectsLast365d: input.newProjectsLast365d,
    newSignalsLast30d: input.newSignalsLast30d,
    newSignalsLast90d: input.newSignalsLast90d,
    velocityScore,
    acceleration,
    cadenceClass,
    reasonLog,
  };
}

export function classifyCadence(velocityScore: number, acceleration: number): CadenceClass {
  if (velocityScore >= 0.70) return "HOT";
  if (velocityScore >= 0.45) return "WARM";
  if (velocityScore < 0.10 && acceleration <= 0) return "COLD";
  if (acceleration < -0.15) return "COOLING";
  return "STEADY";
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

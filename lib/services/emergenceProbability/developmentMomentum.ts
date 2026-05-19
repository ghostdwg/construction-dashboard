// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/emergenceProbability/developmentMomentum.ts
//  Phase MI-8 — Developer-level momentum metric.
//
//  Tracks how rapidly a developer Entity is accumulating new project /
//  parcel attachments over time. Pure function — orchestrator gathers counts
//  and passes them in.
// ──────────────────────────────────────────────────────────────────────────────

import {
  type DevelopmentMomentumResult,
  type DeveloperMomentumClassification,
} from "./types";
import { expSaturate, linearSaturate } from "./heuristics";

export interface DevelopmentMomentumInput {
  developerEntityId: string;
  developerNameCache?: string | null;
  newProjectsLast30d: number;
  newProjectsLast90d: number;
  newProjectsLast365d: number;
  newParcelsLast90d: number;
  /** Optional: prior-30d count for acceleration. */
  newProjectsPriorWindow?: number;
}

export function computeDevelopmentMomentum(
  input: DevelopmentMomentumInput
): DevelopmentMomentumResult {
  const projVol = expSaturate(input.newProjectsLast90d, 3);
  const parcVol = expSaturate(input.newParcelsLast90d, 4);
  const newWeight = linearSaturate(input.newProjectsLast30d, 2);

  const momentumScore = clamp(0.5 * projVol + 0.3 * parcVol + 0.2 * newWeight, 0, 1);

  let acceleration: number;
  if (input.newProjectsPriorWindow != null) {
    const denom = Math.max(1, input.newProjectsPriorWindow);
    acceleration = clamp((input.newProjectsLast30d - input.newProjectsPriorWindow) / denom, -1, 1);
  } else {
    const projected90 = input.newProjectsLast30d * 3;
    const denom = Math.max(1, projected90);
    acceleration = clamp((input.newProjectsLast90d - projected90) / denom, -1, 1);
  }

  const classification = classifyDeveloperMomentum(momentumScore, acceleration, input.newProjectsLast365d);

  const reasonLog = [
    `newProjectsLast30d=${input.newProjectsLast30d}`,
    `newProjectsLast90d=${input.newProjectsLast90d}`,
    `newParcelsLast90d=${input.newParcelsLast90d}`,
    `momentumScore=${momentumScore.toFixed(3)}`,
    `acceleration=${acceleration.toFixed(3)}`,
    `classification=${classification}`,
  ];

  return {
    developerEntityId: input.developerEntityId,
    developerNameCache: input.developerNameCache ?? null,
    newProjectsLast30d: input.newProjectsLast30d,
    newProjectsLast90d: input.newProjectsLast90d,
    newProjectsLast365d: input.newProjectsLast365d,
    newParcelsLast90d: input.newParcelsLast90d,
    momentumScore,
    acceleration,
    classification,
    reasonLog,
  };
}

export function classifyDeveloperMomentum(
  momentumScore: number,
  acceleration: number,
  newProjectsLast365d: number
): DeveloperMomentumClassification {
  if (momentumScore >= 0.50 && acceleration > 0.10) return "ACCELERATING";
  if (momentumScore >= 0.30 && acceleration >= -0.10) return "SUSTAINED";
  if (newProjectsLast365d === 0) return "DORMANT";
  if (acceleration < -0.15 || momentumScore < 0.10) return "FADING";
  return "SUSTAINED";
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

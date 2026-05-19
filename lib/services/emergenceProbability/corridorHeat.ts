// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/emergenceProbability/corridorHeat.ts
//  Phase MI-8 — Corridor heat composite.
//
//  A "corridor" is a deterministic set of parcels. The engine accepts the
//  member-list as input (the caller resolves membership from MI-7
//  ParcelAdjacency edges of kind CORRIDOR) and returns:
//
//    heatScore       — composite [0..1]
//    meanPressure    — mean MI-7 pressure across active members
//    acceleration    — rate of mean change vs the prior window
//    activeMembers   — count of members with a recent emergence signal
//    classification  — IGNITING | HOT | WARM | STEADY | COOLING
//
//  Pure function — no DB. The orchestrator loads pressures and feeds them
//  in. This keeps the heuristic testable and replayable.
// ──────────────────────────────────────────────────────────────────────────────

import {
  type CorridorHeatResult,
  type CorridorHeatClassification,
} from "./types";

export interface CorridorMember {
  parcelId: string;
  latestPressureScore: number;       // [0..1] from MI-7
  pressureScore60dAgo: number | null; // optional reference for acceleration
  hasRecentEmergenceSignal: boolean; // signal in last 90 days
}

export interface CorridorHeatInput {
  corridorKey: string;
  corridorLabel: string;
  members: CorridorMember[];
  maxMembersForStorage?: number;     // defaults 200
}

export function computeCorridorHeat(input: CorridorHeatInput): CorridorHeatResult {
  const maxMembers = input.maxMembersForStorage ?? 200;
  const members = input.members;

  if (members.length === 0) {
    return {
      corridorKey: input.corridorKey,
      corridorLabel: input.corridorLabel,
      heatScore: 0,
      meanPressure: 0,
      acceleration: 0,
      activeMembers: 0,
      memberParcelIds: [],
      memberSetTruncated: false,
      classification: "COOLING",
      reasonLog: ["no_members"],
    };
  }

  const pressures = members.map((m) => m.latestPressureScore);
  const meanPressure = mean(pressures);

  // Acceleration: mean(latest) - mean(60d ago). Members without a 60d-ago
  // value are excluded from the acceleration calculation (not the mean).
  const withPrior = members.filter((m) => m.pressureScore60dAgo != null);
  let acceleration = 0;
  if (withPrior.length > 0) {
    const meanPrior = mean(withPrior.map((m) => m.pressureScore60dAgo as number));
    const meanCurrent = mean(withPrior.map((m) => m.latestPressureScore));
    acceleration = clamp(meanCurrent - meanPrior, -1, 1);
  }

  const activeMembers = members.filter((m) => m.hasRecentEmergenceSignal).length;
  const activeRatio = activeMembers / members.length;

  // Heat composite: pressure carries 60% weight, activity 30%, acceleration 10%.
  // Acceleration is mapped to [0..1] for the composite by taking max(0, x).
  const positiveAccel = Math.max(0, acceleration);
  const heatScore = clamp(
    0.6 * meanPressure + 0.3 * activeRatio + 0.1 * positiveAccel,
    0,
    1
  );

  const classification = classifyCorridorHeat(heatScore, acceleration);

  const memberParcelIds = members.slice(0, maxMembers).map((m) => m.parcelId);
  const memberSetTruncated = members.length > maxMembers;

  const reasonLog: string[] = [
    `members=${members.length}`,
    `meanPressure=${meanPressure.toFixed(3)}`,
    `activeMembers=${activeMembers}/${members.length}`,
    `acceleration=${acceleration.toFixed(3)}`,
    `classification=${classification}`,
  ];
  if (memberSetTruncated) reasonLog.push(`truncated_at=${maxMembers}`);

  return {
    corridorKey: input.corridorKey,
    corridorLabel: input.corridorLabel,
    heatScore,
    meanPressure,
    acceleration,
    activeMembers,
    memberParcelIds,
    memberSetTruncated,
    classification,
    reasonLog,
  };
}

export function classifyCorridorHeat(
  heatScore: number,
  acceleration: number
): CorridorHeatClassification {
  if (acceleration > 0.20 && heatScore > 0.25) return "IGNITING";
  if (heatScore >= 0.65) return "HOT";
  if (heatScore >= 0.40) return "WARM";
  if (acceleration < -0.10) return "COOLING";
  return "STEADY";
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

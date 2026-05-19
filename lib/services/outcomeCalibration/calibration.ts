// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/outcomeCalibration/calibration.ts
//  Phase MI-9 — Per-scope calibration aggregation + recommendation engine.
//
//  Pure functions that aggregate per-resolution accuracy rows into per-scope
//  summaries (jurisdiction, corridor) and emit recommended adjustment rows
//  for the ForecastCalibration table.
//
//  Adjustments are RECOMMENDATIONS — never applied silently. PR-3
//  governance UI surfaces them for operator review.
// ──────────────────────────────────────────────────────────────────────────────

import {
  type JurisdictionCalibrationResult,
  type CorridorCalibrationResult,
  type AdjustmentKind,
} from "./types";

/** One pre-aggregated record for a single resolution within a scope. The
 *  orchestrator fetches these from Prisma and feeds the function. */
export interface ResolutionAggregateRow {
  resolutionId: string;
  resolutionState: "PENDING" | "CONFIRMED" | "PARTIAL" | "DISCONFIRMED" | "DISPUTED" | "WITHDRAWN";
  probabilityAccuracy: number | null;
  brierScore: number | null;
  timelineErrorDays: number | null;
  trajectoryAlignment: string | null;
  isFalsePositive: boolean;
  isFalseNegative: boolean;
  outcomeKind: string;
  predictedScore: number;
}

// ── Jurisdiction calibration ─────────────────────────────────────────────────

export interface JurisdictionCalibrationInput {
  jurisdictionKey: string;
  resolutions: ResolutionAggregateRow[];
}

export function computeJurisdictionCalibration(
  input: JurisdictionCalibrationInput
): JurisdictionCalibrationResult {
  const totals = aggregateResolutions(input.resolutions);

  const recommendedAdjustments: JurisdictionCalibrationResult["recommendedAdjustments"] = [];
  const reasonLog: string[] = [
    `resolutions=${input.resolutions.length}`,
    `confirmed=${totals.confirmedCount}`,
    `disconfirmed=${totals.disconfirmedCount}`,
    `partial=${totals.partialCount}`,
  ];

  // ── Typical lag: median timeline error across CONFIRMED + PARTIAL ────────
  const lagSamples = input.resolutions
    .filter((r) => (r.resolutionState === "CONFIRMED" || r.resolutionState === "PARTIAL"))
    .map((r) => r.timelineErrorDays)
    .filter((v): v is number => v != null);
  const typicalLagDays = lagSamples.length > 0 ? median(lagSamples) : null;
  if (typicalLagDays != null) reasonLog.push(`typicalLagDays=${typicalLagDays.toFixed(1)}`);

  if (typicalLagDays != null && Math.abs(typicalLagDays) >= 14) {
    recommendedAdjustments.push({
      factorName: "expected_timeline",
      adjustmentKind: "LAG_DAYS",
      value: Math.round(typicalLagDays),
      rationale: `median lag across ${lagSamples.length} confirmed/partial resolutions = ${typicalLagDays.toFixed(1)}d`,
    });
  }

  // ── Trajectory alignment rate ────────────────────────────────────────────
  const alignSamples = input.resolutions
    .filter((r) => r.resolutionState === "CONFIRMED" || r.resolutionState === "DISCONFIRMED")
    .map((r) => r.trajectoryAlignment);
  const alignedCount = alignSamples.filter((s) => s === "ALIGNED" || s === "EARLY_SHIFT").length;
  const trajectoryAlignmentRate =
    alignSamples.length > 0 ? alignedCount / alignSamples.length : null;
  if (trajectoryAlignmentRate != null) {
    reasonLog.push(`trajectoryAlignmentRate=${trajectoryAlignmentRate.toFixed(2)}`);
  }

  // ── False-positive vs false-negative ratio drives factor multipliers ─────
  const fp = input.resolutions.filter((r) => r.isFalsePositive).length;
  const fn = input.resolutions.filter((r) => r.isFalseNegative).length;
  reasonLog.push(`fp=${fp} fn=${fn}`);

  if (fp >= 3 && fp > fn * 2) {
    // Systematically over-predicting in this jurisdiction → downweight
    // continuance + developer factors.
    recommendedAdjustments.push({
      factorName: "continuancePressure",
      adjustmentKind: "WEIGHT_MULTIPLIER",
      value: 0.85,
      rationale: `fp=${fp} >> fn=${fn} in jurisdiction; suggest -15% on continuancePressure`,
    });
    recommendedAdjustments.push({
      factorName: "developerRecurrence",
      adjustmentKind: "WEIGHT_MULTIPLIER",
      value: 0.90,
      rationale: `fp=${fp} >> fn=${fn} in jurisdiction; suggest -10% on developerRecurrence`,
    });
  } else if (fn >= 3 && fn > fp * 2) {
    // Systematically under-predicting → upweight parcel pressure +
    // infrastructure boost.
    recommendedAdjustments.push({
      factorName: "parcelPressure",
      adjustmentKind: "WEIGHT_MULTIPLIER",
      value: 1.15,
      rationale: `fn=${fn} >> fp=${fp} in jurisdiction; suggest +15% on parcelPressure`,
    });
    recommendedAdjustments.push({
      factorName: "infrastructureBoost",
      adjustmentKind: "WEIGHT_MULTIPLIER",
      value: 1.20,
      rationale: `fn=${fn} >> fp=${fp} in jurisdiction; suggest +20% on infrastructureBoost`,
    });
  }

  return {
    jurisdictionKey: input.jurisdictionKey,
    resolutionCount: input.resolutions.length,
    confirmedCount: totals.confirmedCount,
    disconfirmedCount: totals.disconfirmedCount,
    partialCount: totals.partialCount,
    meanProbabilityAccuracy: totals.meanProbabilityAccuracy,
    meanBrierScore: totals.meanBrierScore,
    meanTimelineErrorDays: totals.meanTimelineErrorDays,
    typicalLagDays,
    trajectoryAlignmentRate,
    falsePositiveCount: fp,
    falseNegativeCount: fn,
    recommendedAdjustments,
    reasonLog,
  };
}

// ── Corridor calibration ─────────────────────────────────────────────────────

export interface CorridorCalibrationInput {
  corridorKey: string;
  resolutions: ResolutionAggregateRow[];
}

export function computeCorridorCalibration(
  input: CorridorCalibrationInput
): CorridorCalibrationResult {
  const totals = aggregateResolutions(input.resolutions);

  const shellSamples = input.resolutions.filter((r) => r.outcomeKind === "SHELL_REALIZED" || r.predictedScore >= 0.5);
  const shellConfirmedCount = shellSamples.filter((s) => s.resolutionState === "CONFIRMED").length;
  const shellRealizationRate =
    shellSamples.length > 0 ? shellConfirmedCount / shellSamples.length : null;

  const fp = input.resolutions.filter((r) => r.isFalsePositive).length;
  const total = input.resolutions.length;
  const falsePositiveRate = total > 0 ? fp / total : null;

  const recommendedAdjustments: CorridorCalibrationResult["recommendedAdjustments"] = [];
  const reasonLog: string[] = [
    `resolutions=${total}`,
    `shellRealizationRate=${shellRealizationRate?.toFixed(2) ?? "null"}`,
    `falsePositiveRate=${falsePositiveRate?.toFixed(2) ?? "null"}`,
  ];

  if (shellRealizationRate != null && shellRealizationRate < 0.30) {
    recommendedAdjustments.push({
      factorName: "shellPatternBoost",
      adjustmentKind: "WEIGHT_MULTIPLIER",
      value: 0.80,
      rationale: `corridor over-predicts shell emergence (rate ${shellRealizationRate.toFixed(2)}); suggest -20% on shellPatternBoost`,
    });
  }

  if (falsePositiveRate != null && falsePositiveRate > 0.40) {
    recommendedAdjustments.push({
      factorName: "corridorBoost",
      adjustmentKind: "WEIGHT_MULTIPLIER",
      value: 0.85,
      rationale: `corridor false-positive rate ${falsePositiveRate.toFixed(2)} > 0.40; suggest -15% on corridorBoost`,
    });
  }

  // Highly-predictive corridor (low FP rate, high alignment) — note in
  // the rationale; no down-adjustment.
  if (
    falsePositiveRate != null && falsePositiveRate < 0.10 &&
    totals.meanProbabilityAccuracy != null && totals.meanProbabilityAccuracy > 0.80
  ) {
    reasonLog.push("corridor is highly predictive; no adjustment recommended");
  }

  return {
    corridorKey: input.corridorKey,
    resolutionCount: total,
    confirmedCount: totals.confirmedCount,
    disconfirmedCount: totals.disconfirmedCount,
    meanProbabilityAccuracy: totals.meanProbabilityAccuracy,
    shellRealizationRate,
    falsePositiveRate,
    recommendedAdjustments,
    reasonLog,
  };
}

// ── calibrateForecastWeights ─────────────────────────────────────────────────
//
// Top-level entry point. Given a flat list of resolutions across all
// jurisdictions + corridors, this groups them and returns a list of
// recommended ForecastCalibration row writes — never persisted directly.

export interface CalibrateForecastWeightsInput {
  resolutions: Array<ResolutionAggregateRow & {
    jurisdictionKey: string | null;
    corridorKey: string | null;
  }>;
}

export interface CalibrationRecommendation {
  scope: "JURISDICTION" | "CORRIDOR" | "GLOBAL";
  scopeKey: string | null;
  factorName: string;
  adjustmentKind: AdjustmentKind;
  value: number;
  rationale: string;
}

export interface CalibrateForecastWeightsResult {
  recommendations: CalibrationRecommendation[];
  jurisdictionResults: JurisdictionCalibrationResult[];
  corridorResults: CorridorCalibrationResult[];
  reasonLog: string[];
}

export function calibrateForecastWeights(
  input: CalibrateForecastWeightsInput
): CalibrateForecastWeightsResult {
  const recs: CalibrationRecommendation[] = [];
  const jurisdictionResults: JurisdictionCalibrationResult[] = [];
  const corridorResults: CorridorCalibrationResult[] = [];

  // Group by jurisdiction
  const byJurisdiction = new Map<string, ResolutionAggregateRow[]>();
  for (const r of input.resolutions) {
    if (!r.jurisdictionKey) continue;
    const arr = byJurisdiction.get(r.jurisdictionKey) ?? [];
    arr.push(r);
    byJurisdiction.set(r.jurisdictionKey, arr);
  }
  for (const [jur, rows] of byJurisdiction) {
    if (rows.length < 5) continue; // skip thin samples
    const jurResult = computeJurisdictionCalibration({ jurisdictionKey: jur, resolutions: rows });
    jurisdictionResults.push(jurResult);
    for (const adj of jurResult.recommendedAdjustments) {
      recs.push({
        scope: "JURISDICTION",
        scopeKey: jur,
        factorName: adj.factorName,
        adjustmentKind: adj.adjustmentKind,
        value: adj.value,
        rationale: adj.rationale,
      });
    }
  }

  // Group by corridor
  const byCorridor = new Map<string, ResolutionAggregateRow[]>();
  for (const r of input.resolutions) {
    if (!r.corridorKey) continue;
    const arr = byCorridor.get(r.corridorKey) ?? [];
    arr.push(r);
    byCorridor.set(r.corridorKey, arr);
  }
  for (const [corr, rows] of byCorridor) {
    if (rows.length < 5) continue;
    const corrResult = computeCorridorCalibration({ corridorKey: corr, resolutions: rows });
    corridorResults.push(corrResult);
    for (const adj of corrResult.recommendedAdjustments) {
      recs.push({
        scope: "CORRIDOR",
        scopeKey: corr,
        factorName: adj.factorName,
        adjustmentKind: adj.adjustmentKind,
        value: adj.value,
        rationale: adj.rationale,
      });
    }
  }

  const reasonLog = [
    `jurisdictions_with_enough_data=${jurisdictionResults.length}`,
    `corridors_with_enough_data=${corridorResults.length}`,
    `total_recommendations=${recs.length}`,
  ];

  return {
    recommendations: recs,
    jurisdictionResults,
    corridorResults,
    reasonLog,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function aggregateResolutions(rows: ResolutionAggregateRow[]) {
  let confirmed = 0;
  let partial = 0;
  let disconfirmed = 0;
  const probSamples: number[] = [];
  const brierSamples: number[] = [];
  const lagSamples: number[] = [];
  for (const r of rows) {
    if (r.resolutionState === "CONFIRMED") confirmed++;
    else if (r.resolutionState === "PARTIAL") partial++;
    else if (r.resolutionState === "DISCONFIRMED") disconfirmed++;
    if (r.probabilityAccuracy != null) probSamples.push(r.probabilityAccuracy);
    if (r.brierScore != null) brierSamples.push(r.brierScore);
    if (r.timelineErrorDays != null) lagSamples.push(r.timelineErrorDays);
  }
  return {
    confirmedCount: confirmed,
    partialCount: partial,
    disconfirmedCount: disconfirmed,
    meanProbabilityAccuracy: probSamples.length > 0 ? mean(probSamples) : null,
    meanBrierScore: brierSamples.length > 0 ? mean(brierSamples) : null,
    meanTimelineErrorDays: lagSamples.length > 0 ? mean(lagSamples) : null,
  };
}

function mean(xs: number[]): number {
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

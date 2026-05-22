// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/emergenceProbability/forecastGates.ts
//  Phase O2.2 PR7 — Pre-flight gating for the forecast-daily runner.
//
//  The user-spec says: "Before enabling runner, require ≥100 MarketSignals,
//  ≥5 Project rows, cadenceConfidence movement visible, zero runner errors
//  over prior 72h. If gates fail: runner remains disabled."
//
//  Two consumers:
//    * scripts/forecast-gate-check.ts — operator CLI; reports pass/fail.
//    * lib/runners/forecastDaily.ts body — soft-gate that early-returns when
//      gates fail (audits + metrics still fire so the absence isn't silent).
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

export const FORECAST_GATES_VERSION = "v1" as const;

export type GateName =
  | "min_market_signals"
  | "min_projects"
  | "cadence_movement"
  | "no_recent_runner_errors";

export interface GateResult {
  name: GateName;
  pass: boolean;
  observed: number;
  required: number;
  detail: string;
}

export interface ForecastGatesReport {
  version: typeof FORECAST_GATES_VERSION;
  generatedAt: Date;
  gatesPass: boolean;
  results: GateResult[];
}

// ── Tunables (versioned with FORECAST_GATES_VERSION) ───────────────────────

export const MIN_MARKET_SIGNALS = 100;
export const MIN_PROJECTS = 5;
/** "cadence movement visible" = at least N sources have moved past
 *  cadenceConfidence=null AND have a publishCadenceDays estimate. */
export const MIN_SOURCES_WITH_CADENCE = 3;
/** Window for the no-recent-runner-errors gate. */
export const RECENT_RUNNER_ERROR_WINDOW_HOURS = 72;
/** Runner names whose errors block forecast activation. */
export const GATING_RUNNER_NAMES = ["municipal-agenda-ingestion", "health-check"];

const HOUR_MS = 60 * 60 * 1000;

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Evaluate the four pre-flight gates. Returns a structured report — caller
 * decides what to do with `gatesPass`.
 *
 * All four gates must pass for `gatesPass: true`.
 */
export async function checkForecastGates(now: Date = new Date()): Promise<ForecastGatesReport> {
  const cutoffRecentRunnerErrors = new Date(now.getTime() - RECENT_RUNNER_ERROR_WINDOW_HOURS * HOUR_MS);

  const [
    marketSignalCount,
    projectCount,
    cadenceMoved,
    recentRunnerErrors,
  ] = await Promise.all([
    prisma.marketSignal.count(),
    prisma.project.count({ where: { reviewStatus: { notIn: ["REJECTED", "MERGED"] } } }),
    prisma.marketSource.count({
      where: {
        cadenceConfidence: { not: null },
        publishCadenceDays: { not: null },
      },
    }),
    prisma.runnerLease.count({
      where: {
        cycleName: { in: GATING_RUNNER_NAMES },
        status: "failed",
        leasedAt: { gte: cutoffRecentRunnerErrors },
      },
    }),
  ]);

  const results: GateResult[] = [
    {
      name: "min_market_signals",
      pass: marketSignalCount >= MIN_MARKET_SIGNALS,
      observed: marketSignalCount,
      required: MIN_MARKET_SIGNALS,
      detail: `${marketSignalCount} MarketSignal rows (need ≥ ${MIN_MARKET_SIGNALS})`,
    },
    {
      name: "min_projects",
      pass: projectCount >= MIN_PROJECTS,
      observed: projectCount,
      required: MIN_PROJECTS,
      detail: `${projectCount} active Project rows (need ≥ ${MIN_PROJECTS})`,
    },
    {
      name: "cadence_movement",
      pass: cadenceMoved >= MIN_SOURCES_WITH_CADENCE,
      observed: cadenceMoved,
      required: MIN_SOURCES_WITH_CADENCE,
      detail: `${cadenceMoved} sources have published cadence estimate (need ≥ ${MIN_SOURCES_WITH_CADENCE})`,
    },
    {
      name: "no_recent_runner_errors",
      pass: recentRunnerErrors === 0,
      observed: recentRunnerErrors,
      required: 0,
      detail: `${recentRunnerErrors} runner cycle(s) failed in prior ${RECENT_RUNNER_ERROR_WINDOW_HOURS}h (need 0)`,
    },
  ];

  return {
    version: FORECAST_GATES_VERSION,
    generatedAt: now,
    gatesPass: results.every((g) => g.pass),
    results,
  };
}

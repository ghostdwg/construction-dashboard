// ──────────────────────────────────────────────────────────────────────────────
//  lib/runners/registry.ts
//  Phase O1.4 — Runner registry.
//
//  Named lookup of installed runners. The dispatcher + the operator CLI
//  (scripts/run-cycle.mjs) consult this registry to find runners by name.
//
//  PR-1 of O1.4 (this PR) ships the FRAMEWORK + a single demo runner used
//  by tests + by scripts/run-cycle.mjs --runner=health-check. The actual
//  MI-cycle runners (forecast, calibration, briefing, alert-eval,
//  outcome-detect) land in O2 (each one independently testable, gated by
//  the framework that exists here).
// ──────────────────────────────────────────────────────────────────────────────

import type { RunnerDefinition } from "./types";

const registry = new Map<string, RunnerDefinition<unknown>>();

export function registerRunner<T>(def: RunnerDefinition<T>): void {
  if (registry.has(def.name)) {
    throw new Error(`runner ${def.name} already registered`);
  }
  registry.set(def.name, def as RunnerDefinition<unknown>);
}

export function getRunner(name: string): RunnerDefinition<unknown> | undefined {
  return registry.get(name);
}

export function listRunners(): RunnerDefinition<unknown>[] {
  return Array.from(registry.values());
}

// ── Built-in: health-check ──────────────────────────────────────────────────
//
// Minimal runner used by scripts/validate-staging.mjs to prove that
// dispatcher + lease + observability paths all work in staging. Reads its
// own lease history + emits an audit event. Body is intentionally trivial
// so failures isolate to the framework, not to cycle-specific logic.

registerRunner<{ pinged: true }>({
  name: "health-check",
  windowGranularity: "manual",
  leaseSeconds: 30,
  maxDurationSeconds: 60,
  retryOnFailure: false,
  body: async (ctx) => {
    await ctx.heartbeat();
    return { pinged: true };
  },
});

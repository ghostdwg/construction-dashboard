#!/usr/bin/env tsx
// scripts/run-cycle.ts — Phase O1.4 — Operator entry-point for runner cycles.
//
// Lists registered runners, or invokes one by name through the dispatcher.
//
// Usage:
//   tsx scripts/run-cycle.ts --list
//   tsx scripts/run-cycle.ts --runner=health-check --window-key=manual-2026-05-19
//   tsx scripts/run-cycle.ts --runner=health-check --dry-run
//
// In O2, this script becomes the canonical "fire a cycle" tool. Future cron
// container OR Kubernetes CronJob invokes:
//   tsx scripts/run-cycle.ts --runner=forecast-daily --trigger=scheduled
//
// Exit codes:
//   0 — runner succeeded OR was preempted by another holder
//   1 — bad args
//   2 — runner failed (lease finalized as failed)
//
// O1.5.a — wrapped body in async main() + .catch(). The original version
// used top-level await, which fails under tsx CJS mode when package.json
// has no "type": "module". This pattern matches the working backfill
// scripts (scripts/backfill-entity-graph.ts, etc.).

import "@/lib/runners/registry";                  // side-effect: register built-in runners
import "@/lib/runners/municipalAgendaIngestion";  // side-effect: register PR4 runner
import "@/lib/runners/forecastDaily";             // side-effect: register PR7 runner
import "@/lib/runners/alertEval";                 // side-effect: register PR8 runner
import { getRunner, listRunners, runCycle } from "@/lib/runners";

const args = process.argv.slice(2);

function getFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = args.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}
function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

async function main(): Promise<number> {
  if (hasFlag("list")) {
    const runners = listRunners();
    console.log(`[run-cycle] ${runners.length} registered runner(s):`);
    for (const r of runners) {
      console.log(`  - ${r.name.padEnd(30)} granularity=${r.windowGranularity} lease=${r.leaseSeconds}s retry=${r.retryOnFailure}`);
    }
    return 0;
  }

  const runnerName = getFlag("runner");
  if (!runnerName) {
    console.error("[run-cycle] FATAL: --runner=<name> is required (or --list).");
    return 1;
  }

  const def = getRunner(runnerName);
  if (!def) {
    console.error(`[run-cycle] FATAL: runner "${runnerName}" not registered.`);
    console.error("  Run with --list to see available runners.");
    return 1;
  }

  const windowKey = getFlag("window-key");
  const trigger = (getFlag("trigger") ?? "manual") as
    | "scheduled" | "manual" | "backfill" | "replay";
  const dryRun = hasFlag("dry-run");

  if (def.windowGranularity === "manual" && !windowKey) {
    console.error(`[run-cycle] FATAL: runner "${runnerName}" has granularity=manual; --window-key=<key> required.`);
    return 1;
  }

  console.log(`[run-cycle] runner=${runnerName} trigger=${trigger}${dryRun ? " dry-run" : ""}`);
  const result = await runCycle(def, {
    triggerReason: trigger,
    windowKey,
    dryRun,
  });

  console.log(`[run-cycle] status=${result.status} preempted=${result.preempted} durationMs=${result.durationMs}`);
  if (result.error) console.error(`[run-cycle] error: ${result.error}`);

  return result.ok ? 0 : 2;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[run-cycle] FATAL unhandled error:", err);
    process.exit(2);
  });

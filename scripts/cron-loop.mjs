#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/cron-loop.mjs
//  Phase O2.2 PR4 — Autonomous cadence runtime.
//
//  Minimal, deterministic cron loop. Reads a JSON schedule, fires
//  `tsx scripts/run-cycle.ts --runner=<name> --trigger=scheduled` whenever a
//  schedule entry matches the current minute, and tracks in-flight runs so
//  the same runner is never spawned twice concurrently.
//
//  DESIGN GUARDRAILS:
//    * Pure Node ESM (.mjs). No tsx, no transpilation, no extra deps.
//    * One tick per minute. Smallest supported cadence is "every minute".
//    * Deterministic minute decision via parseCronExpr() — testable.
//    * Per-runner in-flight lock — overlapping invocations are skipped
//      locally (RunnerLease catches them defensively too).
//    * Heartbeat file: /tmp/cron.tick — updated every minute. Container
//      healthcheck checks freshness.
//    * Graceful shutdown on SIGINT/SIGTERM: stop scheduling, wait for
//      in-flight children, exit.
//    * All stdout lines are single-line JSON for Loki indexing.
//
//  WHAT THIS IS NOT:
//    * Not a general cron implementation. Supports four pattern shapes only:
//        "*/N * * * *"   every N minutes (N | 60)
//        "M * * * *"     at minute M every hour
//        "M H * * *"     at H:M daily
//        "M H * * D"     at H:M on day-of-week D (0=Sun..6=Sat)
//    * Not a leader-election layer. Multiple cron containers would all tick;
//      RunnerLease prevents double-execution but wastes spawn cycles. Keep
//      this single-process until horizontal scale is justified.
//    * Not a hot-reload daemon. Schedule changes require container restart.
//      (Simpler than reload semantics; matches the runbook design.)
//
//  ENV:
//    CRON_SCHEDULE_PATH   Path to schedule.json (default: runtime/cron/schedule.json)
//    CRON_TICK_FILE       Heartbeat file (default: /tmp/cron.tick)
//    CRON_LOG_PREFIX      Prefix for stdout lines (default: [cron])
//    CRON_DRY_RUN         When "true", log spawns without invoking. Tests use this.
// ──────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Pure helpers (exported for tests) ──────────────────────────────────────

/**
 * Parse a 5-field cron expression into a matcher. Returns an object with
 *   match(date: Date): boolean
 *
 * Supports only the four shapes listed in the file header.
 */
export function parseCronExpr(expr) {
  if (typeof expr !== "string") {
    throw new Error(`cron expression must be a string, got ${typeof expr}`);
  }
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`cron expression "${expr}" must have 5 fields, got ${fields.length}`);
  }
  const [minF, hourF, domF, monF, dowF] = fields;

  if (domF !== "*" || monF !== "*") {
    throw new Error(`cron expression "${expr}": day-of-month and month must be "*" in this minimal parser`);
  }

  // Minute field: "*/N", "M", or "*"
  const minute = parseField(minF, 0, 59);
  const hour   = parseField(hourF, 0, 23);
  const dow    = parseField(dowF, 0, 6);

  return {
    expr,
    match(date) {
      const m = date.getUTCMinutes();
      const h = date.getUTCHours();
      const d = date.getUTCDay();
      return minute(m) && hour(h) && dow(d);
    },
  };
}

function parseField(field, min, max) {
  if (field === "*") return (_v) => true;

  // step: "*/N" → every N starting at 0
  const stepMatch = /^\*\/(\d+)$/.exec(field);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`invalid step "${field}"`);
    }
    return (v) => v % step === 0 && v >= min && v <= max;
  }

  // single integer
  if (/^\d+$/.test(field)) {
    const n = Number(field);
    if (n < min || n > max) {
      throw new Error(`field value ${n} out of range [${min}, ${max}]`);
    }
    return (v) => v === n;
  }

  throw new Error(`unsupported cron field "${field}" (only "*", "*/N", or single integer)`);
}

/** Load + validate a schedule file. Returns array of normalized entries.
 *  Throws on invalid shape — caller logs + exits. */
export function loadSchedule(path) {
  const raw = readFileSync(path, "utf-8");
  const json = JSON.parse(raw);
  if (!json || !Array.isArray(json.schedules)) {
    throw new Error(`schedule file ${path}: must be { schedules: [...] }`);
  }
  return json.schedules.map((entry, i) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`schedule[${i}]: must be an object`);
    }
    if (typeof entry.cron !== "string") throw new Error(`schedule[${i}]: cron must be a string`);
    if (typeof entry.runner !== "string") throw new Error(`schedule[${i}]: runner must be a string`);
    const trigger = entry.trigger ?? "scheduled";
    if (typeof trigger !== "string") throw new Error(`schedule[${i}]: trigger must be a string`);
    const matcher = parseCronExpr(entry.cron);
    return { cron: entry.cron, runner: entry.runner, trigger, match: matcher.match };
  });
}

/** Pure decision: given the current minute (as a Date with seconds=0) and
 *  a parsed schedule, return the list of runners to fire RIGHT NOW. */
export function pickDueRunners(schedule, nowMinute) {
  const out = [];
  for (const entry of schedule) {
    if (entry.match(nowMinute)) out.push(entry);
  }
  return out;
}

/** Round a Date to the start of its minute (seconds + ms = 0). UTC. */
export function startOfMinute(d) {
  const out = new Date(d.getTime());
  out.setUTCSeconds(0, 0);
  return out;
}

// ── Logger ─────────────────────────────────────────────────────────────────

const LOG_PREFIX = process.env.CRON_LOG_PREFIX || "[cron]";

function log(event, fields = {}) {
  const line = { ts: new Date().toISOString(), event, ...fields };
  console.log(`${LOG_PREFIX} ${JSON.stringify(line)}`);
}

// ── Spawn one runner ───────────────────────────────────────────────────────

/** Spawn `tsx scripts/run-cycle.ts --runner=<name> --trigger=<trigger>`.
 *  Returns the ChildProcess. Caller tracks lifetime in inFlight map. */
export function spawnRunCycle(runner, trigger = "scheduled", opts = {}) {
  const args = ["tsx", "scripts/run-cycle.ts", `--runner=${runner}`, `--trigger=${trigger}`];
  const cwd = opts.cwd ?? process.cwd();
  // Use shell: false; explicit argv prevents accidental shell injection
  // even if a hostile schedule.json snuck in a runner name with spaces.
  return spawn("npx", args, {
    cwd,
    stdio: "inherit",
    shell: false,
    env: { ...process.env },
  });
}

// ── Main loop ──────────────────────────────────────────────────────────────

const TICK_FILE = process.env.CRON_TICK_FILE || "/tmp/cron.tick";
const DRY_RUN = process.env.CRON_DRY_RUN === "true";
const DEFAULT_SCHEDULE_PATH = "runtime/cron/schedule.json";

function touchTickFile(path) {
  try {
    writeFileSync(path, new Date().toISOString() + "\n");
  } catch (err) {
    // Best-effort. A read-only /tmp is operator misconfiguration; log + continue.
    log("tick_file_error", { path, error: String(err) });
  }
}

/** Compute milliseconds until the start of the next minute. */
function msUntilNextMinute(now = new Date()) {
  const next = new Date(now.getTime());
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(next.getUTCMinutes() + 1);
  return next.getTime() - now.getTime();
}

export async function runMain() {
  const schedulePath = process.env.CRON_SCHEDULE_PATH || DEFAULT_SCHEDULE_PATH;

  let schedule;
  try {
    schedule = loadSchedule(resolve(schedulePath));
  } catch (err) {
    log("schedule_load_failed", { path: schedulePath, error: String(err) });
    process.exit(1);
  }
  log("started", { schedulePath, entries: schedule.length, dryRun: DRY_RUN });

  // Per-runner in-flight map. Value = ChildProcess.
  const inFlight = new Map();
  let shuttingDown = false;
  let mainTimer = null;

  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log("shutdown_initiated", { signal, inFlight: inFlight.size });
    if (mainTimer) clearTimeout(mainTimer);
    if (inFlight.size === 0) {
      log("shutdown_complete", { signal });
      process.exit(0);
    }
    // Wait for in-flight children. They get SIGTERM via stdio:inherit
    // automatically only if we forward — but the dispatcher's finalizeLease
    // is idempotent if the process dies mid-cycle (the lease will go stale
    // and the next janitor sweep cleans it up). For PR4 we let them finish.
    log("shutdown_waiting", { inFlight: inFlight.size });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  function tick() {
    if (shuttingDown) return;
    touchTickFile(TICK_FILE);

    const nowMinute = startOfMinute(new Date());
    const due = pickDueRunners(schedule, nowMinute);

    for (const entry of due) {
      if (inFlight.has(entry.runner)) {
        log("skipped_in_flight", { runner: entry.runner, minute: nowMinute.toISOString() });
        continue;
      }
      log("spawn", { runner: entry.runner, trigger: entry.trigger, cron: entry.cron, minute: nowMinute.toISOString() });

      if (DRY_RUN) continue;

      const child = spawnRunCycle(entry.runner, entry.trigger);
      inFlight.set(entry.runner, child);

      child.on("exit", (code, signal) => {
        inFlight.delete(entry.runner);
        log("exit", { runner: entry.runner, code, signal });
        if (shuttingDown && inFlight.size === 0) {
          log("shutdown_complete", { signal: "drain" });
          process.exit(0);
        }
      });

      child.on("error", (err) => {
        inFlight.delete(entry.runner);
        log("spawn_error", { runner: entry.runner, error: String(err) });
      });
    }

    // Schedule next tick at the start of the next minute.
    const wait = msUntilNextMinute(new Date());
    mainTimer = setTimeout(tick, wait);
  }

  // Initial alignment: wait until the next minute boundary to start ticking.
  // This makes the first tick deterministic across container starts.
  const initialWait = msUntilNextMinute(new Date());
  log("aligning", { waitMs: initialWait });
  mainTimer = setTimeout(tick, initialWait);
}

// Auto-run when invoked as a script (not when imported by tests).
const invokedAsScript =
  typeof process !== "undefined" &&
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  runMain().catch((err) => {
    console.error(`${LOG_PREFIX} FATAL`, err);
    process.exit(1);
  });
}

// Re-export __dirname for tests that want to resolve paths.
export const __filename = fileURLToPath(import.meta.url);
export const __dirname  = dirname(__filename);

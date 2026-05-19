// ──────────────────────────────────────────────────────────────────────────────
//  lib/runners/types.ts
//  Phase O1.4 — Runner orchestration types.
//
//  A "runner" is a recurring platform-wide cycle that operates on MI cognition
//  state (forecast, calibration, briefing generation, alert evaluation,
//  outcome detection, etc.). Distinct from per-bid background jobs which use
//  BackgroundJob.
//
//  Each runner declares its identity, window granularity, lease duration, and
//  a body() function that performs the work. The dispatcher (runCycle) handles
//  lease claim/heartbeat/release + observability emission + retry semantics.
// ──────────────────────────────────────────────────────────────────────────────

export const RUNNER_WINDOW_GRANULARITIES = [
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "manual",   // operator-triggered; windowKey supplied by caller
] as const;
export type RunnerWindowGranularity = (typeof RUNNER_WINDOW_GRANULARITIES)[number];

export const RUNNER_LEASE_STATES = [
  "claimed",    // lease acquired; body not yet started
  "running",    // body executing; heartbeat extending lease
  "succeeded",  // body returned ok
  "failed",     // body threw or returned not-ok
  "stale",      // lease expired without finish (operator review)
] as const;
export type RunnerLeaseState = (typeof RUNNER_LEASE_STATES)[number];

export interface RunnerDefinition<TResult = unknown> {
  /** Stable runner name. Used as cycle prefix in audit + lease. */
  name: string;
  /** Window granularity drives windowKey derivation. */
  windowGranularity: RunnerWindowGranularity;
  /** Default lease duration. Body MUST heartbeat at least every leaseSeconds/2
   *  for the lease to stay alive. */
  leaseSeconds: number;
  /** Maximum body duration before lease is considered stale even if
   *  heartbeats fire. Provides a hard ceiling on hung cycles. */
  maxDurationSeconds: number;
  /** Whether to retry on failure within the same window. Currently each
   *  failed lease writes a "failed" row; retry-in-same-window is operator-
   *  initiated, not automatic. */
  retryOnFailure: boolean;
  /** Body function. Throws on failure. */
  body: (ctx: RunnerContext) => Promise<TResult>;
}

export interface RunnerContext {
  /** The cycle's runner identity (matches AuditEvent.runnerId from O1.2). */
  runnerId: string;
  /** Stable window key for this invocation. */
  windowKey: string;
  /** Window start (rounded down to granularity). */
  windowStart: Date;
  /** Window end (exclusive). */
  windowEnd: Date;
  /** Heartbeat callback. Body calls this periodically to extend the lease.
   *  Returns false if the lease has been preempted (caller must abort). */
  heartbeat: () => Promise<boolean>;
  /** Optional replayId when the cycle is part of a replay/backfill. */
  replayId: string | null;
}

export interface RunCycleOptions {
  /** Override the auto-derived windowKey. Required for granularity=manual. */
  windowKey?: string;
  /** Override window start. */
  windowStartOverride?: Date;
  /** Operator-supplied reason for manual invocation. */
  triggerReason?: "scheduled" | "manual" | "backfill" | "replay";
  /** When set, runner runs in dry-run mode (lease claim + immediate release;
   *  no body invocation). Useful for validation. */
  dryRun?: boolean;
}

export interface RunCycleResult<TResult> {
  ok: boolean;
  leaseId: string;
  cycleName: string;
  windowKey: string;
  runnerId: string;
  status: RunnerLeaseState;
  result?: TResult;
  error?: string;
  durationMs: number;
  /** When true, this invocation was preempted because another runner already
   *  holds the lease for this window. Caller treats as no-op success. */
  preempted: boolean;
}

/** Identity of the current runner instance. Hostname + PID + a uuid. */
export interface RunnerInstanceId {
  hostname: string;
  pid: number;
  instance: string;
}

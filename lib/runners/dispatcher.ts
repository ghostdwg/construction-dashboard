// ──────────────────────────────────────────────────────────────────────────────
//  lib/runners/dispatcher.ts
//  Phase O1.4 — Runner dispatcher.
//
//  Single entry-point for invoking a recurring MI cycle:
//
//    const result = await runCycle(runnerDefinition, { triggerReason: "scheduled" });
//
//  Combines:
//    - windowKey derivation (windowKey.ts)
//    - atomic lease claim (lease.ts)
//    - O1.2 correlation context + observability (lib/observability)
//    - heartbeat loop while body runs
//    - finalization with status/duration/error
//    - canonical AuditEvent emission for runner_cycle category
//
//  Preempted invocations (already_held) return ok=true with preempted=true.
//  Caller treats them as no-op success — the other runner instance is handling
//  this window.
// ──────────────────────────────────────────────────────────────────────────────

import {
  emitAuditEvent,
  newRunnerId,
  recordRunnerCycle,
  recordRunnerCycleDuration,
  withCorrelationContextAsync,
} from "@/lib/observability";
import { deriveWindow } from "./windowKey";
import {
  claimLease,
  heartbeatLease,
  finalizeLease,
} from "./lease";
import type {
  RunnerContext,
  RunnerDefinition,
  RunCycleOptions,
  RunCycleResult,
} from "./types";

/**
 * Invoke a runner cycle with full observability + at-most-once semantics.
 *
 * Lifecycle:
 *   1. Derive windowKey from definition.windowGranularity + now (or override).
 *   2. Attempt atomic lease claim. On already-held → return preempted=true.
 *   3. Bind AsyncLocalStorage correlation context with runnerId.
 *   4. Start heartbeat loop (every leaseSeconds/2).
 *   5. Run definition.body(ctx).
 *   6. Stop heartbeat loop.
 *   7. Finalize lease with status/duration/error.
 *   8. Emit canonical runner_cycle AuditEvent.
 */
export async function runCycle<TResult>(
  def: RunnerDefinition<TResult>,
  opts: RunCycleOptions = {}
): Promise<RunCycleResult<TResult>> {
  const startedAt = Date.now();
  const triggerReason = opts.triggerReason ?? "scheduled";
  const runnerId = newRunnerId(def.name);

  const window = deriveWindow(def.name, def.windowGranularity, new Date(), {
    windowKey: opts.windowKey,
    windowStartOverride: opts.windowStartOverride,
  });

  // ── Step 1: lease claim ──────────────────────────────────────────────────
  const claim = await claimLease({
    cycleName: def.name,
    windowKey: window.windowKey,
    leaseSeconds: def.leaseSeconds,
    runnerId,
  });

  if (!claim.ok) {
    if (claim.reason === "already_held") {
      await emitAuditEvent({
        category: "runner_cycle",
        action: "preempted",
        severity: "DEBUG",
        decision: "already_held",
        subject: { kind: "RUNNER", id: def.name },
        runnerId,
        payload: {
          windowKey: window.windowKey,
          triggerReason,
        },
      });
      return {
        ok: true,
        leaseId: "",
        cycleName: def.name,
        windowKey: window.windowKey,
        runnerId,
        status: "succeeded",
        durationMs: Date.now() - startedAt,
        preempted: true,
      };
    }
    // db_error or other — emit and bubble
    await emitAuditEvent({
      category: "runner_cycle",
      action: "claim_failed",
      severity: "ERROR",
      decision: "db_error",
      subject: { kind: "RUNNER", id: def.name },
      runnerId,
      payload: { error: claim.details, windowKey: window.windowKey },
    });
    return {
      ok: false,
      leaseId: "",
      cycleName: def.name,
      windowKey: window.windowKey,
      runnerId,
      status: "failed",
      error: claim.details,
      durationMs: Date.now() - startedAt,
      preempted: false,
    };
  }

  const { leaseId, leaseToken } = claim.lease;

  // ── Dry-run short-circuit ────────────────────────────────────────────────
  if (opts.dryRun) {
    await finalizeLease({
      leaseId,
      leaseToken,
      status: "succeeded",
      durationMs: Date.now() - startedAt,
    });
    await emitAuditEvent({
      category: "runner_cycle",
      action: "dry_run",
      severity: "INFO",
      decision: "ok",
      subject: { kind: "RUNNER", id: def.name },
      runnerId,
      payload: { windowKey: window.windowKey },
    });
    return {
      ok: true,
      leaseId,
      cycleName: def.name,
      windowKey: window.windowKey,
      runnerId,
      status: "succeeded",
      durationMs: Date.now() - startedAt,
      preempted: false,
    };
  }

  // ── Step 2: heartbeat loop + body ────────────────────────────────────────
  let preempted = false;
  const heartbeatIntervalMs = Math.max(5_000, Math.floor((def.leaseSeconds * 1000) / 2));
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let lastHeartbeatOk = true;

  const startHeartbeat = () => {
    heartbeatTimer = setInterval(async () => {
      lastHeartbeatOk = await heartbeatLease(leaseId, leaseToken, def.leaseSeconds);
      if (!lastHeartbeatOk) {
        // Lease lost — body's next heartbeat() call will report false too,
        // letting it abort cleanly. Also clear the timer.
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }, heartbeatIntervalMs);
  };
  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const ctx: RunnerContext = {
    runnerId,
    windowKey: window.windowKey,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    heartbeat: async () => {
      const ok = await heartbeatLease(leaseId, leaseToken, def.leaseSeconds);
      if (!ok) preempted = true;
      return ok;
    },
    replayId: null,
  };

  let result: TResult | undefined;
  let error: string | undefined;

  try {
    startHeartbeat();
    await emitAuditEvent({
      category: "runner_cycle",
      action: "started",
      severity: "INFO",
      decision: "claimed",
      subject: { kind: "RUNNER", id: def.name },
      runnerId,
      payload: {
        windowKey: window.windowKey,
        leaseSeconds: def.leaseSeconds,
        triggerReason,
      },
    });

    // Bind correlation context so any audit events inside body() inherit runnerId.
    result = await withCorrelationContextAsync(
      { runnerId, actorKind: "runner" },
      () => def.body(ctx)
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    stopHeartbeat();
  }

  // ── Step 3: finalize ─────────────────────────────────────────────────────
  const durationMs = Date.now() - startedAt;
  const status: "succeeded" | "failed" = error ? "failed" : "succeeded";
  await finalizeLease({ leaseId, leaseToken, status, durationMs, errorMessage: error });

  recordRunnerCycle(def.name, error ? "error" : "ok");
  recordRunnerCycleDuration(def.name, durationMs / 1000);

  await emitAuditEvent({
    category: "runner_cycle",
    action: "complete",
    severity: error ? "ERROR" : "INFO",
    decision: status,
    subject: { kind: "RUNNER", id: def.name },
    runnerId,
    reasonLog: error ? [`error=${error}`] : [],
    payload: {
      windowKey: window.windowKey,
      durationMs,
      triggerReason,
      preempted,
    },
  });

  return {
    ok: !error,
    leaseId,
    cycleName: def.name,
    windowKey: window.windowKey,
    runnerId,
    status,
    result,
    error,
    durationMs,
    preempted,
  };
}

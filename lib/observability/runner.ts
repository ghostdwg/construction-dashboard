// ──────────────────────────────────────────────────────────────────────────────
//  lib/observability/runner.ts
//  Phase O1.2 — Runner-cycle observability primitives (for O2 schedulers).
//
//  Future O2 ships scheduled runners (forecast cycle, calibration cycle,
//  briefing generator, alert evaluator, outcome detector). Each runner
//  must emit:
//
//    1. A heartbeat AuditEvent at cycle start (category=runner_cycle,
//       action=heartbeat, severity=DEBUG).
//    2. A correlation context (runnerId) bound for the cycle duration.
//    3. A completion AuditEvent at cycle end with elapsed time + status.
//    4. Prometheus runner-cycle counter + duration histogram.
//    5. Optional lease / lock semantics for at-most-once execution when
//       multiple instances might fire (uses BackgroundJob table at the
//       cheap end; Redis at the expensive end — deferred to O2).
//
//  This module exposes the primitives so O2 runner authors don't reinvent
//  the wheel. It's intentionally light — no scheduler, no cron parsing,
//  no leader election. Just the observability envelope.
// ──────────────────────────────────────────────────────────────────────────────

import { withCorrelationContextAsync, newRunnerId } from "./correlation";
import { emitAuditEvent } from "./audit";
import { recordRunnerCycle, recordRunnerCycleDuration } from "./metrics";

export interface RunnerCycleOptions {
  /** Stable runner identity, e.g. "forecast-daily", "calibration-weekly". */
  runner: string;
  /** Optional reason marker — "scheduled", "manual", "backfill". */
  triggerReason?: string;
  /** Optional subject scope when the cycle is targeted at a single subject. */
  subject?: { kind: string; id: string };
}

export interface RunnerCycleResult<T> {
  ok: boolean;
  result?: T;
  error?: string;
  elapsedSeconds: number;
  runnerId: string;
}

/**
 * Wrap a runner cycle body with full observability:
 *   - heartbeat + completion audit events
 *   - correlation context bound for the cycle
 *   - prometheus counters + duration histogram
 *   - try/catch with structured error reporting
 *
 * Returns the body's result + cycle metadata.
 */
export async function runRunnerCycle<T>(
  options: RunnerCycleOptions,
  body: () => Promise<T>
): Promise<RunnerCycleResult<T>> {
  const runnerId = newRunnerId(options.runner);
  const startedAt = Date.now();

  return withCorrelationContextAsync({ runnerId, actorKind: "runner" }, async () => {
    await emitAuditEvent({
      category: "runner_cycle",
      action: "heartbeat",
      severity: "DEBUG",
      decision: "started",
      subject: options.subject ?? null,
      payload: {
        runner: options.runner,
        triggerReason: options.triggerReason ?? "scheduled",
        startedAt: new Date(startedAt).toISOString(),
      },
    });

    try {
      const result = await body();
      const elapsedSeconds = (Date.now() - startedAt) / 1000;

      recordRunnerCycle(options.runner, "ok");
      recordRunnerCycleDuration(options.runner, elapsedSeconds);

      await emitAuditEvent({
        category: "runner_cycle",
        action: "complete",
        severity: "INFO",
        decision: "ok",
        subject: options.subject ?? null,
        payload: {
          runner: options.runner,
          elapsedSeconds,
          finishedAt: new Date().toISOString(),
        },
      });

      return { ok: true, result, elapsedSeconds, runnerId };
    } catch (err) {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const errMsg = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : undefined;

      recordRunnerCycle(options.runner, "error");
      recordRunnerCycleDuration(options.runner, elapsedSeconds);

      await emitAuditEvent({
        category: "runner_cycle",
        action: "complete",
        severity: "ERROR",
        decision: "failed",
        subject: options.subject ?? null,
        payload: {
          runner: options.runner,
          elapsedSeconds,
          error: errMsg,
          stack: errStack,
          finishedAt: new Date().toISOString(),
        },
      });

      return { ok: false, error: errMsg, elapsedSeconds, runnerId };
    }
  });
}

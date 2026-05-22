// ──────────────────────────────────────────────────────────────────────────────
//  lib/runners/alertEval.ts
//  Phase O2.2 PR8 — Recurring alert-evaluation runner.
//
//  Fires hourly (cron entry: "30 * * * *" — minute 30 to avoid colliding
//  with the top-of-hour municipal-agenda-ingestion runner). Each cycle:
//    1. Run nine deterministic detectors against the last 24h of state.
//    2. For each candidate: apply fingerprint-based cooldown via existing
//       AlertEvent rows. Persist non-suppressed candidates via the existing
//       MI-10 recordAlertEvent path.
//    3. Update post-cycle gauges (unread alerts by severity).
//
//  This runner adds NO new MI-10 logic. All scorers, persistence helpers,
//  and the AlertEvent / AlertExplanation tables are re-used from MI-10 PR1.
//  PR8 provides:
//    * The detector layer (runnerAlerts.ts)
//    * The severity-normalization layer (alertSeverityNormalize.ts)
//    * This thin orchestration runner
//
//  Lease contract:
//    * windowGranularity=hourly → at-most-once/hour via RunnerLease unique.
//    * leaseSeconds=900 (15 min lease).
//    * maxDurationSeconds=2700 — alert if cycle approaches 45 min.
//    * retryOnFailure=false — operator-initiated retry.
//
//  Replay safety: persistRunnerAlert deduplicates via fingerprint, so
//  replaying the same window is a no-op (unless cooldown has elapsed).
// ──────────────────────────────────────────────────────────────────────────────

import { registerRunner } from "./registry";
import { prisma } from "@/lib/prisma";
import {
  DETECTORS,
  detectorConfig,
  persistRunnerAlert,
  emptySummary,
  type RunnerAlertSummary,
} from "@/lib/services/operatorWorkspace";
import {
  recordAlertCandidate,
  recordAlertSuppressed,
  recordAlertPersisted,
  setAlertsUnreadCount,
  recordAlertFired,
} from "@/lib/observability";

export const ALERT_EVAL_RUNNER_NAME = "alert-eval";

/** Hard cap on persisted alerts per cycle. Defense against runaway
 *  detectors. */
export const ALERT_EVAL_MAX_PERSISTS_PER_CYCLE = 200;

registerRunner<RunnerAlertSummary>({
  name: ALERT_EVAL_RUNNER_NAME,
  windowGranularity: "hourly",
  leaseSeconds: 900,
  maxDurationSeconds: 2700,
  retryOnFailure: false,
  body: async (ctx) => {
    const summary = emptySummary();
    let totalPersisted = 0;

    for (const detector of DETECTORS) {
      if (!(await ctx.heartbeat())) {
        throw new Error(`lease preempted mid-cycle after ${totalPersisted} alert(s) persisted`);
      }

      let candidates;
      try {
        candidates = await detector.run(ctx.windowStart);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push({ triggerKind: detector.kind, error: message });
        recordAlertSuppressed(detector.kind, "detector_error");
        console.warn(`[${ALERT_EVAL_RUNNER_NAME}] detector ${detector.kind} threw:`, message);
        continue;
      }

      summary.candidatesProduced[detector.kind] = candidates.length;
      for (const c of candidates) recordAlertCandidate(detector.kind);

      const cfg = detectorConfig(detector.kind);
      for (const candidate of candidates) {
        if (totalPersisted >= ALERT_EVAL_MAX_PERSISTS_PER_CYCLE) {
          recordAlertSuppressed(detector.kind, "cooldown"); // surfacing as cooldown for backstop
          summary.candidatesSuppressedByCooldown[detector.kind] += 1;
          continue;
        }
        try {
          const result = await persistRunnerAlert(candidate, cfg.cooldownMinutes, ctx.windowStart, false);
          if (result.persisted) {
            summary.alertsPersisted[detector.kind] += 1;
            summary.persistedBySeverity[candidate.severity] += 1;
            totalPersisted += 1;
            recordAlertPersisted(detector.kind, candidate.severity);
            // Also bump the long-standing O1.2 alert-fired counter for
            // back-compat with existing dashboards.
            recordAlertFired(candidate.severity, detector.kind);
          } else if (result.suppressedReason === "cooldown") {
            summary.candidatesSuppressedByCooldown[detector.kind] += 1;
            recordAlertSuppressed(detector.kind, "cooldown");
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          summary.errors.push({ triggerKind: detector.kind, error: `persist:${message}` });
          recordAlertSuppressed(detector.kind, "detector_error");
        }
      }
    }

    // Post-cycle: refresh unread-alerts gauge by severity. Cheap aggregate
    // query — bounded count() per severity.
    const unreadGroups = await prisma.alertEvent.groupBy({
      by: ["severity"],
      where: { reviewStatus: "UNREAD" },
      _count: { _all: true },
    });
    const seenSeverities = new Set<string>();
    for (const g of unreadGroups) {
      setAlertsUnreadCount(g.severity, g._count._all);
      seenSeverities.add(g.severity);
    }
    // Explicitly reset gauges for our four normalized bands so the dashboard
    // doesn't show stale values for severities that fell to zero.
    for (const sev of ["INFO", "WATCH", "IMPORTANT", "CRITICAL"]) {
      if (!seenSeverities.has(sev)) setAlertsUnreadCount(sev, 0);
    }

    return summary;
  },
});

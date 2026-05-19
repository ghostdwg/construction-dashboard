# O2 Runtime Design — Recurring MI Cycle Orchestration

Authoring phase: O1.4 (companion design doc for the O2 implementation).

This document is the architectural plan for **O2** — the phase where the
recurring MI cycles (forecast, calibration, briefing, alert-eval,
outcome-detect, backfill) actually run on a schedule against staging and
production. O1.4 ships the framework; O2 ships the runners that use it.

---

## 1. Scope

### 1.1 Out-of-scope (DO NOT DO IN O2)

- Adding cognition models
- Changing AI strategy
- Implementing autonomous decision flows
- Multi-tenancy
- Production deployment (gated by O1.5 + O1.6)

### 1.2 In-scope

For each of the six recurring cycles below, ship:

- A `RunnerDefinition` registered in `lib/runners/registry.ts`
- A pure body function that operates on existing services (no new services)
- Idempotency proven by tests (same windowKey → second invocation preempts)
- Observability via the dispatcher (correlation context + metrics + audit)
- Documentation in `runtime/runbooks/runner-<name>.md`

Plus the cron / scheduler container that fires them.

---

## 2. The six cycles

| Cycle name | Granularity | Lease | Body composition | Trigger |
|---|---|---|---|---|
| **forecast-daily** | daily | 3600s | walks active Projects + Parcels; calls `computeEmergenceScore` + `persistForecast` from MI-8 | 03:00 UTC |
| **calibration-weekly** | weekly | 7200s | walks recent Outcomes; calls `calibrateForecastWeights` from MI-9; writes recommendations | Sunday 04:00 UTC |
| **briefing-daily** | daily | 1800s | generates WEEKLY_EMERGENCE briefing for the prior day; persists via MI-10 | 07:00 UTC |
| **briefing-corridor-weekly** | weekly | 1800s | per top-N corridors, generates CORRIDOR_SUMMARY | Friday 14:00 UTC |
| **alert-eval-hourly** | hourly | 600s | walks active AlertRules; for each, fetches context and runs `evaluateAlertRule` from MI-10; persists fires | hourly :00 |
| **outcome-detect-daily** | daily | 1800s | walks recent ProjectStateTransitions + MarketSignal stream for permit-issued/construction-started patterns; auto-files Outcome rows | 04:00 UTC |
| **backfill-forecast** | manual | 3600s | full forecast snapshot history rebuild; operator-triggered with explicit windowKey | manual |
| **backfill-parcel-pressure** | manual | 3600s | full parcel pressure history rebuild | manual |

(The two manual `backfill-*` runners are not on a cron — they exist to
prove the framework works for one-shot replay-class work.)

---

## 3. Scheduler topology

Two options, both supported by the framework. Pick ONE for O2; pick the
simpler one unless throughput requirements force the other.

### Option A — Single cron container (RECOMMENDED for current scale)

```
┌────────────────────┐         ┌─────────────────────┐
│ cron container     │ tick →  │ scripts/run-cycle   │
│  (node-cron)       │         │  (one invocation    │
│  per cycle:        │         │   per tick)         │
│   "0 3 * * *"      │         │                     │
│   forecast-daily   │         └──────┬──────────────┘
│   ...              │                │
└────────────────────┘                ▼
                                  ┌─────────────────────┐
                                  │  dispatcher         │
                                  │  → lease + body     │
                                  │  → AuditEvent       │
                                  │  → Prometheus       │
                                  └─────────────────────┘
```

- Single process; no leader election needed.
- Idempotent: even if the cron container restarts mid-tick, the lease
  guarantees no double-invocation.
- Trivially debuggable via `docker compose logs cron`.
- New container in `runtime/compose/observability.yml`-style overlay.

Dockerfile sketch:

```Dockerfile
# runtime/cron/Dockerfile
FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN npx prisma generate
CMD ["node", "scripts/cron-loop.mjs"]
```

The cron loop reads `runtime/cron/schedule.json` (file-backed config so
operators can edit schedules without code changes) and dispatches via
`npm run run:cycle -- --runner=<name> --trigger=scheduled`.

### Option B — Kubernetes CronJob (REJECTED for now)

CronJobs run as separate pods per schedule. Cleaner separation but
introduces k8s as a dependency. Not justified at metro scale.

Defer until single-host can't keep up.

---

## 4. Idempotency contract per cycle

**Forecast-daily.** Daily window. If the cron fires twice on the same day,
the second invocation gets `preempted=true` and exits success. Operator
forcing a re-run (e.g. after fixing data) uses `--window-key=2026-05-19-rerun`
to bypass the duplicate-window guard.

**Calibration-weekly.** ISO-week window. Same idempotency story.

**Alert-eval-hourly.** Hourly window. Each rule's cooldownMinutes (from MI-10
schema) provides a second layer of dedup — even if alert-eval fires twice
in the same hour, the rule's lastFiredAt + cooldown gates the AlertEvent
write.

**Backfill-*.** Manual windowKey. Operator MUST supply a stable string
(e.g. `--window-key=full-rebuild-2026-05-19`) so two operators don't both
start the backfill. The lease ensures only one wins.

---

## 5. Runner body authoring template

```typescript
// lib/runners/forecast-daily.ts (O2 PR)
import { registerRunner } from "@/lib/runners";
import { prisma } from "@/lib/prisma";
import {
  computeEmergenceScore,
  persistForecast,
  // ... etc
} from "@/lib/services/emergenceProbability";

registerRunner<{ projectsScored: number; parcelsScored: number }>({
  name: "forecast-daily",
  windowGranularity: "daily",
  leaseSeconds: 3600,         // 1h hard ceiling
  maxDurationSeconds: 3000,   // alert if takes longer
  retryOnFailure: false,      // re-runs are operator-driven
  body: async (ctx) => {
    let projectsScored = 0;
    let parcelsScored = 0;

    // ── Project pass ────────────────────────────────────────────────
    const projects = await prisma.project.findMany({
      where: { reviewStatus: { notIn: ["REJECTED", "MERGED"] } },
      take: 5000,
    });
    for (const project of projects) {
      if (!(await ctx.heartbeat())) {
        throw new Error("lease preempted mid-cycle");
      }
      // build context, score, persist — see MI-8 for shape
      // ...
      projectsScored++;
    }

    // ── Parcel pass ────────────────────────────────────────────────
    // ... similar pattern ...

    return { projectsScored, parcelsScored };
  },
});
```

Patterns to follow:

- Always call `ctx.heartbeat()` inside any per-subject loop.
- When `ctx.heartbeat()` returns false, **abort immediately** — the
  lease was preempted (almost certainly a stale-cleanup tool flipped it).
- Throw on unrecoverable errors — the dispatcher catches and finalizes
  the lease as failed + emits ERROR audit.
- Return a structured summary — used by the operator review UI.
- Use `withCorrelationContextAsync` inside the body when calling other
  services that emit audits, so all events share `runnerId`.

---

## 6. Retry semantics

Three layers:

1. **In-cycle retries** (operator-friendly):
   The body owns retries for transient errors (network blips, etc.).
   `for (let attempt = 0; attempt < 3; attempt++)` patterns inside body
   are appropriate. The lease holds; AuditEvents may emit retry attempts
   via `severity=WARN`.

2. **Cycle retry within same window**:
   NOT automatic. If the body throws, the lease finalizes as `failed`
   and the unique-windowKey constraint blocks re-claim. Operator must
   either:
   - Wait for the next window
   - Manually invoke with `--window-key=<recovery-key>` to bypass
   - Operator-marked-stale via a janitor (future O2)

3. **Stale cleanup**:
   `findStaleLeases()` returns leases where `leaseExpiresAt < now()` but
   status is still `claimed` or `running`. A periodic janitor (also a
   registered runner: `runner-janitor-hourly`) flips them to `stale`,
   freeing the windowKey for future runs.

---

## 7. Observability per cycle

Every cycle automatically emits via the dispatcher:

| Event | Severity | When |
|---|---|---|
| `runner_cycle / started` | INFO | lease claimed, body begins |
| `runner_cycle / complete` (ok) | INFO | body returned cleanly |
| `runner_cycle / complete` (failed) | ERROR | body threw |
| `runner_cycle / preempted` | DEBUG | another holder owned the window |

Plus Prometheus metrics:
- `neuroglitch_runner_cycles_total{runner, status}` — counter
- `neuroglitch_runner_cycle_duration_seconds{runner}` — histogram

Grafana **Platform Health** dashboard has the "Runner cycles / hr" panel
that surfaces these.

Cycles that fail repeatedly will trigger the future O1.4 alerting rule:
`rate(neuroglitch_runner_cycles_total{status="error"}[1h]) > 0` → notify.

---

## 8. Schedule definition (O2 deliverable)

File: `runtime/cron/schedule.json`

```json
{
  "schedules": [
    { "cron": "0 3 * * *",       "runner": "forecast-daily",         "trigger": "scheduled" },
    { "cron": "0 4 * * 0",       "runner": "calibration-weekly",     "trigger": "scheduled" },
    { "cron": "0 7 * * *",       "runner": "briefing-daily",         "trigger": "scheduled" },
    { "cron": "0 14 * * 5",      "runner": "briefing-corridor-weekly","trigger": "scheduled" },
    { "cron": "0 * * * *",       "runner": "alert-eval-hourly",      "trigger": "scheduled" },
    { "cron": "0 4 * * *",       "runner": "outcome-detect-daily",   "trigger": "scheduled" },
    { "cron": "*/15 * * * *",    "runner": "runner-janitor-hourly",  "trigger": "scheduled" }
  ]
}
```

Operator-editable without deploys. Cron container watches the file and
hot-reloads its schedule. (Or restarts on file change — simpler.)

---

## 9. O2 PR sequence (suggested)

1. **O2.1 — cron container + schedule.json loader.** Brings up the
   container with a no-op loop. Validates Docker + compose changes.
2. **O2.2 — forecast-daily runner.** Highest-value cycle; ship first
   and let it run on staging for a week before others.
3. **O2.3 — alert-eval-hourly + runner-janitor-hourly.** Operator-visible
   first wins.
4. **O2.4 — outcome-detect-daily.** Closes the calibration loop.
5. **O2.5 — calibration-weekly + briefing-daily + briefing-corridor-weekly.**
   Once outcomes are landing, calibration has real data; briefings
   become useful.
6. **O2.6 — backfill-*. ** Manual runners for one-shot rebuilds.

Each PR follows the O1 CI discipline: replay-validation green,
migration-lint green, typecheck + tests green, no unmarked destructive
changes.

---

## 10. Operational dashboards (O2 follow-up)

Add to Grafana:

- **Cycle Health** dashboard:
  - Per-runner success rate (last 30d)
  - Per-runner p50/p95 duration trend
  - Active leases (status=claimed|running)
  - Stale leases (status=claimed|running AND leaseExpiresAt < now)
  - Recent runner_cycle audit events (Loki tail)

- **Cycle Calendar** dashboard:
  - Heat map of cycles run per day per runner
  - Missed cycle detection (no row for expected windowKey in last 25h)

These are operator surfaces — they're how on-call sees the platform's
recurring health at a glance.

---

## 11. What this design explicitly does NOT include

- **Distributed runners.** A single cron container is sufficient at
  metro scale. The lease primitive supports multi-instance but the
  scheduler is single-process. Add leader-election when there's a
  reason.
- **Dynamic schedules from DB.** Schedule lives in a JSON file
  operators edit. Avoids the bootstrap problem of "how does the
  scheduler know what to schedule when the DB is the source of truth".
- **Priority queues.** Cron-based; lowest-cost dependency.
- **Per-tenant runners.** Single-tenant. O6 + per-tenant cron when
  multi-tenancy lands.

These are deliberate omissions. Add them when there's evidence — not
before.

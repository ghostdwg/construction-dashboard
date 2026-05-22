# runtime/cron — Autonomous cadence runtime

Phase O2.2 PR4. Brings the platform from "operator-triggered scrapes only" to
"continuously ingesting intelligence."

## Files

| File | Purpose |
|---|---|
| [Dockerfile](Dockerfile) | Cron container image (node:20 + tini + tsx). |
| [schedule.json](schedule.json) | Cron entries. Operator-editable; restart container to reload. |
| [../compose/overrides/cron.yml](../compose/overrides/cron.yml) | Compose overlay that adds the `cron` service. |
| [../../scripts/cron-loop.mjs](../../scripts/cron-loop.mjs) | The cron loop itself. Pure-Node ESM, no extra deps. |
| [../../lib/runners/municipalAgendaIngestion.ts](../../lib/runners/municipalAgendaIngestion.ts) | The first recurring runner. |
| [../runbooks/o2.1-first-bloodstream.md](../runbooks/o2.1-first-bloodstream.md) | Design context. |

## How it works

```
cron container (tini → node scripts/cron-loop.mjs)
        │
        │ every minute:
        │   touch /tmp/cron.tick     ← healthcheck signal
        │   for each entry in schedule.json:
        │     if cron expr matches current UTC minute:
        │       if previous instance still running: skip (in-flight lock)
        │       else: spawn `npx tsx scripts/run-cycle.ts --runner=<name> --trigger=scheduled`
        │
        ▼
run-cycle.ts → dispatcher.runCycle()
        │
        │ claims RunnerLease (UNIQUE on windowKey) — at-most-once per window
        │ binds correlation context (runnerId)
        │ invokes the runner body
        │ heartbeats every leaseSeconds/2
        │ finalizes lease (succeeded | failed)
        │ emits runner_cycle AuditEvent + Prometheus metrics
```

Two layers of double-fire protection:
- **In-process**: `cron-loop.mjs` tracks an in-flight Map keyed by runner name; skips spawn if already running.
- **DB-side**: `RunnerLease.windowKey` UNIQUE constraint — second invocation in the same hour returns `preempted=true`.

## Editing the schedule

`schedule.json` is operator-editable. Restart the cron container to apply.

```bash
# After editing schedule.json:
docker compose restart cron
```

### Supported cron syntax

This is NOT a full cron parser. Only four patterns are supported:

| Pattern | Meaning | Example |
|---|---|---|
| `*/N * * * *` | Every N minutes (N divides 60) | `*/15 * * * *` (every 15 min) |
| `M * * * *` | At minute M of every hour | `0 * * * *` (top of every hour) |
| `M H * * *` | At H:M UTC daily | `0 3 * * *` (03:00 UTC) |
| `M H * * D` | At H:M UTC on day-of-week D (0=Sun..6=Sat) | `0 14 * * 5` (Fri 14:00 UTC) |

Day-of-month and month fields MUST be `*` — anything else throws on schedule load. All times are UTC.

## Operator procedures

### Start
```bash
docker compose -f runtime/compose/base.yml -f runtime/compose/overrides/cron.yml -p neuroglitch up -d cron
```

### Tail logs
```bash
docker compose logs -f cron
```
All stdout lines are single-line JSON prefixed `[cron]` for Loki indexing.

### Verify it's ticking
```bash
docker compose exec cron stat /tmp/cron.tick
```
The mtime should be within the last 60 seconds. The container healthcheck verifies this every minute.

### Replay a cycle (off-schedule, operator-initiated)
```bash
docker compose exec app tsx scripts/run-cycle.ts \
  --runner=municipal-agenda-ingestion \
  --window-key=replay-2026-05-21-rerun \
  --trigger=replay
```

`--window-key` bypasses the standard hourly window — required so the dispatcher doesn't return `preempted=true` against the existing lease. Each individual `scrapeOneSource` is idempotent (MarketSourceDoc dedup + liveIngestion's `alreadyAttached` check), so replay cleanly re-runs without duplicating signals.

### Reset a STALE_PUBLISH source
Use the SourcesPanel "Mark healthy" button (PR3), or directly:
```bash
curl -X PATCH http://app:3000/api/market-intelligence/sources \
  -H 'Content-Type: application/json' \
  -d '{"id":"<sourceId>","publishStatus":"HEALTHY"}'
```

## Failure modes

| Symptom | Likely cause | Action |
|---|---|---|
| `[cron] schedule_load_failed` and container restart loop | Malformed `schedule.json` | Validate JSON, fix, restart. The healthcheck will pull the container down before any cycle fires. |
| Cycles fire but never produce signals | Sidecar unreachable, or all MarketSources are STALE_PUBLISH | Check `[scrape-bridge]` logs in the app container; check `publishStatus` distribution via the SourcesPanel. |
| `processed:0` after several cycles | Heuristic classifier is suppressing too aggressively, OR no due sources | Inspect `neuroglitch_signals_suppressed_total` vs `neuroglitch_signals_classified_total`. If suppression is high, review `MarketSignal.heuristicsJson` on persisted rows to understand factor patterns. |
| Same runner appears in two `[cron] spawn` log lines for the same minute | Multiple cron containers running | Single-process design assumes one cron container. RunnerLease catches the duplicate at the DB layer; remove duplicate container. |
| Healthcheck failing without obvious errors | NTP clock skew or process hung between ticks | `docker compose restart cron`. If recurs, capture `docker logs cron` and file under the operational risks list in `o2.1-first-bloodstream.md`. |

## What's NOT in scope here

- **Distributed coordination**: a single cron container is sufficient at metro scale. RunnerLease supports multi-instance writers; the scheduler is single-process by design.
- **Dynamic schedule from DB**: schedule.json is a file. Avoids the bootstrap problem of "how does the scheduler know what to schedule when the DB is the source of truth?"
- **Priority queues**: cron-based; lowest-cost dependency.
- **Per-tenant runners**: single-tenant. Add when multi-tenancy lands.

Add these only when there's evidence the simpler design can't keep up.

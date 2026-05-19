# Observability Stack (Phase O1.2)

Loki + Promtail + Prometheus + Grafana, configured as infrastructure-as-code.

## Bring it up

```bash
docker compose \
  -f runtime/compose/base.yml \
  -f runtime/compose/observability.yml \
  up -d
```

After bring-up:
- **Grafana** at `http://<host>:3000` (proxied through Caddy in real
  deployments). Login with `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`
  from your env file. Three dashboards auto-load:
  - Platform Health
  - Intelligence Throughput
  - Audit Stream (Loki-backed live tail)
- **Prometheus** at `http://<host>:9090` (internal). Scrapes `/metrics`
  on the app every 15s.
- **Loki** at `http://<host>:3100` (internal). Receives audit + general
  container stdout from Promtail.
- **Promtail** runs as a sidecar, scraping the Docker socket for all
  `groundworx_*` containers.

## What flows where

```
┌─────────────────────────┐                ┌───────────────────────┐
│ Next.js app container   │                │ Future cron container │
│  · stdout audit JSON    │                │  · stdout audit JSON  │
│  · /metrics (text/plain)│                │  · /metrics           │
└──────────┬──────────────┘                └─────────┬─────────────┘
           │ docker logs                              │ docker logs
           ▼                                          ▼
       ┌──────────────────────────────────────────────────────┐
       │            Promtail (sidecar)                        │
       │   parses [audit] / [entity-resolver] / etc. prefixes │
       │   extracts category / action / severity as labels    │
       └──────────────────────────┬───────────────────────────┘
                                  │ HTTP push
                                  ▼
                          ┌───────────────┐
                          │     Loki      │
                          │   90d hot     │
                          └───────┬───────┘
                                  │
                                  ▼ datasource
       ┌───────────────────────────────────────────────────┐
       │                  Grafana                          │
       │  · Platform Health (Prom-backed)                  │
       │  · Intelligence Throughput (Prom-backed)          │
       │  · Audit Stream (Loki-backed live tail)           │
       └───────────────────────────────────────────────────┘
                                  ▲
                                  │ datasource
                          ┌───────┴───────┐
                          │  Prometheus   │
                          │   15d local   │
                          └───────────────┘
```

## Retention

| Tier | Storage | Default |
|---|---|---|
| Loki hot | local disk | 90 days |
| Loki cold | S3 archive | operator-driven (not in compose) |
| Prometheus | local disk | 15 days |
| Grafana | local disk | dashboards forever; queries don't store |
| AuditEvent table | Turso DB | forever (operator-trim per O3) |

## Cold backup

Loki retention is 90 days. For longer-term audit, run the AuditEvent
table as the canonical store — every event in `DB_PERSISTED_CATEGORIES`
lives in Turso forever (see `lib/observability/taxonomy.ts`).

Recommended monthly cron (future O3): export Loki chunks to S3-compatible
storage. Out of O1.2 scope.

## Adding metrics

In service code:

```typescript
import { recordIngestionProcessed, recordIngestionDuration } from "@/lib/observability";

const start = Date.now();
const result = await processSignal(...);
recordIngestionProcessed("MARKET_SIGNAL", result.decision);
recordIngestionDuration("MARKET_SIGNAL", (Date.now() - start) / 1000);
```

Metric definitions live in `lib/observability/metrics.ts`. Adding a new
metric:
1. Register it via `registerCounter(...)` or `registerHistogram(...)`
2. Export a public `record<Name>(...)` helper
3. Document the meaning in `lib/observability/index.ts`
4. Add a Grafana panel that queries it

## Adding audit events

For NEW canonical events (operator actions, runner cycles, replay runs):

```typescript
import { emitAuditEvent } from "@/lib/observability";

await emitAuditEvent({
  category: "operator_override",
  action: "force_acknowledge_alert",
  severity: "NOTICE",
  subject: { kind: "ALERT_EVENT", id: alertId },
  actor: { kind: "operator", userId: user.id, email: user.email },
  decision: "acknowledged",
  reasonLog: ["operator clicked acknowledge"],
  payload: { previousState: "UNREAD" },
});
```

Categories in `DB_PERSISTED_CATEGORIES` (taxonomy.ts) auto-route to
both stdout AND the `AuditEvent` DB table. Others stay stdout-only.

Existing service emitters (entity-resolver, project-aggregator, etc.)
continue working unchanged.

## Local testing

```bash
# Install + run docker compose stack
docker compose -f runtime/compose/observability.yml up -d loki prometheus grafana
# (skip promtail in pure-local mode; it needs the docker socket)

# In another shell, exercise the app
npm run dev

# In another shell, scrape metrics manually
curl http://localhost:3000/metrics

# Open Grafana
open http://localhost:3000
```

## Operational notes

- Loki ingestion limits in `loki-config.yaml` are set for metro-scale
  volume (16 MB/s sustained, 32 MB/s burst). Raise if Promtail starts
  dropping samples.
- Prometheus is configured for 15-day local retention. For long-term
  metric trend analysis, ship remote-write to a managed Prometheus
  service (operator-driven, not in compose).
- Grafana dashboards are file-provisioned read-only by default. Edits
  in the UI are saved to its own DB (volume-backed) but not back to
  source — re-import the JSON if you want to capture UI edits.

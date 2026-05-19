# Staging Activation — Full Runbook (Phase O1.4)

Comprehensive operator procedure for bringing the staging environment to
**fully operational state** — not just "the app boots" but the complete
intelligence-platform substrate: app, sidecar, worker, observability stack,
Turso migrations, AuditEvent persistence, RunnerLease coordination, and
end-to-end metrics flow.

This is the procedure that activates the platform for safe continuous
deployment.

## Prerequisites

- [ ] SSH access to the host (superglitch via Tailscale)
- [ ] Turso CLI installed (`turso db list` works)
- [ ] Staging Turso DB exists: `groundworx-staging-<initials>`
  - If not: `turso db create groundworx-staging-<initials> --group <group>`
- [ ] `/opt/neuroglitch/.env.staging` exists on host with all required vars
  - APP_ENV=staging
  - DATABASE_URL=libsql://groundworx-staging-...?authToken=...
  - AUTH_SECRET, NEXTAUTH_SECRET, NEXTAUTH_URL
  - ANTHROPIC_API_KEY
  - WORKER_TOKEN
  - GRAFANA_ADMIN_USER, GRAFANA_ADMIN_PASSWORD
- [ ] `/opt/neuroglitch/storage-staging` directory exists (empty is fine)
- [ ] Current branch on the host: `feat/mi-10-operator-workspace` or later
  (after O1.3 merge: `main`)
- [ ] Local replay-validation passes (`npm run validate:replay`)
- [ ] Local migration-lint passes (`npm run lint:migrations:all`)
- [ ] Local typecheck + tests pass (`npm run typecheck && npm test`)

## Step 1 — Apply migrations to staging Turso

The Prisma CLI refuses libsql:// URLs (Phase R6.5). Use the bespoke runner.

```bash
# On the host, in the repo directory:
cd /opt/neuroglitch/construction-dashboard

# Dry-run first — never apply migrations blindly:
APP_ENV=staging \
DATABASE_URL=libsql://groundworx-staging-...?authToken=... \
  npm run migrate:turso:status

# Apply for real:
APP_ENV=staging \
DATABASE_URL=libsql://groundworx-staging-...?authToken=... \
  npm run migrate:turso
```

Expected output: 84 migrations applied (83 + drift repair + AuditEvent +
RunnerLease).

If any migration fails, the runner exits with code 2 and the DB is in
partial state. Inspect via:
```bash
turso db shell groundworx-staging-... \
  "SELECT migration_name, finished_at FROM _prisma_migrations WHERE finished_at IS NULL"
```
Resolve before continuing.

## Step 2 — Pull / build images

```bash
cd /opt/neuroglitch/construction-dashboard

# Pull pre-built images from GHCR (if CI publishes):
docker pull ghcr.io/ghostdwg/groundworx-app:<staging-sha>
docker pull ghcr.io/ghostdwg/groundworx-sidecar:<staging-sha>
docker pull ghcr.io/ghostdwg/groundworx-worker:<staging-sha>

# OR build locally:
docker build -t ghcr.io/ghostdwg/groundworx-app:local -f Dockerfile .
docker build -t ghcr.io/ghostdwg/groundworx-sidecar:local -f sidecar/Dockerfile sidecar
# worker uses runtime/worker/Dockerfile when active
```

Update `runtime/compose/overrides/staging.yml` to reference the correct
image tags (replace `<staging-sha>` placeholders).

## Step 3 — Bring up the staging Compose project

```bash
# Bring up app + sidecar + worker (NOT caddy / landing / hello / api — those
# belong to the production project and are shared).
docker compose \
  -f runtime/compose/base.yml \
  -f runtime/compose/overrides/staging.yml \
  -p neuroglitch-staging \
  up -d --force-recreate app sidecar worker
```

Verify all 3 containers reach healthy:

```bash
docker compose -p neuroglitch-staging ps
# Expect: app, sidecar, worker — all (healthy)

# Watch initial logs for ~60s:
docker compose -p neuroglitch-staging logs --tail 50 app sidecar worker
```

Common failure modes:
- **app unhealthy**: usually `DATABASE_URL` mismatch or `prisma generate`
  not run. Check `/api/health` response body for diagnostic info.
- **worker waiting for app**: normal during first 30s. Worker's readiness
  gate (entrypoint.sh) polls `/api/health` until app responds.
- **sidecar 503**: check `/opt/neuroglitch/.env.staging` for missing
  ANTHROPIC_API_KEY or DATABASE_URL.

## Step 4 — Bring up the observability stack

```bash
# Bring up Loki + Promtail + Prometheus + Grafana:
docker compose \
  -f runtime/compose/base.yml \
  -f runtime/compose/overrides/staging.yml \
  -f runtime/compose/observability.yml \
  -p neuroglitch-staging \
  up -d loki promtail prometheus grafana

# All 4 must be running before validation:
docker compose -p neuroglitch-staging ps loki promtail prometheus grafana
```

Verify:
- Loki: `curl http://<host>:3100/ready` returns `ready`
- Promtail: check `docker logs neuroglitch-staging-promtail-1` for
  "scrape config" entries
- Prometheus: `curl http://<host>:9090/-/healthy`
- Grafana: open `http://<host>:3000`, login, verify 3 dashboards exist

## Step 5 — Run staging validation gate

This is the single check that proves staging is **operational**, not just
"running".

```bash
APP_ENV=staging \
APP_URL=https://staging.groundworx.neuroglitch.ai \
SIDECAR_URL=http://sidecar.internal:8001 \
PROMETHEUS_URL=http://prometheus.internal:9090 \
LOKI_URL=http://loki.internal:3100 \
DATABASE_URL=libsql://groundworx-staging-...?authToken=... \
  npm run validate:staging
```

Expected output:

```
[validate-staging] starting
  ✔ PASS  app health — status=200
  ✔ PASS  sidecar health — status=200
  ✔ PASS  /metrics endpoint — 6 counters, 6 histograms
  ✔ PASS  migration folder readable — 84 migrations on disk
  ✔ PASS  Turso migration parity — 84/84 applied
  ✔ PASS  Prometheus scrape target — 1/1 up
  ✔ PASS  Loki ingestion — 42 lines in last 10 min
  ✔ PASS  AuditEvent write/read — id=audittest_validate-...
  ✔ PASS  RunnerLease coordination — claim/dup-reject/finalize ok

═══════════════════════════════════════════════════════════
  STAGING VALIDATION — 9 pass · 0 fail · 0 skip
═══════════════════════════════════════════════════════════
```

If any check FAILs:
- Do NOT proceed to step 6
- Diagnose using the detail line
- Re-run after fix

Common FAILs:
- **/metrics endpoint FAIL**: app container probably out of date — rebuild
- **Turso migration parity FAIL**: re-run step 1
- **Prometheus scrape target FAIL**: prometheus.yml job name mismatch with
  Docker container name; verify networks
- **Loki ingestion FAIL** with "no audit lines in last 10 min": Promtail
  not seeing app stdout — check Docker socket mount + container name regex
- **AuditEvent write/read FAIL**: app didn't run migrate:turso for the
  AuditEvent migration; re-check step 1

## Step 6 — Exercise the runner framework

Prove the new RunnerLease + dispatcher is operational by firing the
health-check built-in runner on staging:

```bash
APP_ENV=staging \
DATABASE_URL=libsql://groundworx-staging-...?authToken=... \
  npm run run:cycle -- --runner=health-check --window-key=staging-activation-$(date +%Y%m%d)
```

Expected:
```
[run-cycle] runner=health-check trigger=manual
[run-cycle] status=succeeded preempted=false durationMs=42
```

Re-running with the same `--window-key` should be PREEMPTED (idempotent):
```
[run-cycle] status=succeeded preempted=true durationMs=12
```

Verify in Turso:
```bash
turso db shell groundworx-staging-... \
  "SELECT cycleName, windowKey, status, durationMs FROM RunnerLease
   WHERE cycleName='health-check' ORDER BY leasedAt DESC LIMIT 5"
```

And in the AuditEvent table:
```bash
turso db shell groundworx-staging-... \
  "SELECT category, action, decision, emittedAt FROM AuditEvent
   WHERE category='runner_cycle' ORDER BY emittedAt DESC LIMIT 5"
```

## Step 7 — Connect staging to public DNS (operator action)

If staging is to be reachable at `staging.groundworx.neuroglitch.ai`:

1. Verify the production Caddy is on the shared external network
   `neuroglitch_edge` (per `runtime/runbooks/staging-bootstrap.md` Phase R6).
2. Connect `neuroglitch-staging-app` to the same network.
3. Add the staging upstream block to the production Caddyfile.
4. `docker compose -p neuroglitch exec caddy caddy reload`.

Snippet template lives at `runtime/caddy/staging-route.example.snippet`.

## Step 8 — Verify Grafana shows live data

Open Grafana → Dashboards → GroundWorX folder:
- **Platform Health**: `Audit emissions / sec by category` should show
  non-zero stream
- **Intelligence Throughput**: `Ingestion throughput` likely zero until
  scrapers run; `/metrics` counters > 0
- **Audit Stream**: live tail panel should show recent `[audit]` lines
  including the validate-staging + health-check events from steps 5-6

## Step 9 — Document the activation in AuditEvent

Append a manual `system_health` AuditEvent so the activation is part of
the cognition platform's own lineage:

```bash
APP_ENV=staging \
DATABASE_URL=libsql://groundworx-staging-...?authToken=... \
turso db shell groundworx-staging-... <<SQL
INSERT INTO AuditEvent (id, category, action, severity, actorKind, actorEmail,
  schemaVersion, decision, payloadJson, emittedAt)
VALUES (
  'staging-activation-' || strftime('%Y-%m-%d', 'now'),
  'system_health',
  'staging_activated',
  'NOTICE',
  'operator',
  '<your-email>',
  '1.0',
  'activated',
  json_object('runbook', 'staging-activation-full', 'phase', 'O1.4'),
  datetime('now')
);
SQL
```

## Step 10 — Backup verification (drill)

Take a snapshot via Turso branching and validate restore:

```bash
# Create a point-in-time branch from staging
turso db create groundworx-staging-snapshot-$(date +%Y%m%d) \
  --from-db groundworx-staging-<initials>

# List branches
turso db list

# Verify branch is queryable
turso db shell groundworx-staging-snapshot-$(date +%Y%m%d) \
  "SELECT COUNT(*) FROM _prisma_migrations"

# Delete the snapshot after verification
turso db destroy groundworx-staging-snapshot-$(date +%Y%m%d) --yes
```

This proves rollback confidence: at any future point, you can fork
production to a snapshot, validate a hypothetical change, then either
promote or destroy the snapshot.

## Rollback procedure

If any step 1-9 fails irrecoverably and you need to take staging down:

```bash
# Stop staging containers (preserves volumes)
docker compose -p neuroglitch-staging down

# Recreate from a known-good image tag
docker compose \
  -f runtime/compose/base.yml \
  -f runtime/compose/overrides/staging.yml \
  -p neuroglitch-staging \
  up -d --force-recreate app sidecar worker
```

If migrations went wrong and corrupted state:

```bash
# Restore from the most recent Turso branch (created in step 10 or
# manually before any risky migration):
turso db shell groundworx-staging-<initials> \
  --from-branch <branch-name>
```

The platform's append-only contract means **no migration can destroy data**
on cognition tables (enforced by the migration-lint CI gate from O1.1).
Rollback is therefore always non-destructive in the cognition layer.

## Sign-off

Staging is considered ACTIVATED when:

- [ ] All 9 validation checks PASS
- [ ] Both health-check runner invocations executed (one succeeded, one
      preempted)
- [ ] Grafana shows live audit + metrics data
- [ ] DNS + Caddy connected (or explicit decision to keep staging
      Tailscale-only)
- [ ] Backup drill completed
- [ ] Activation AuditEvent row exists

Record the activation date + git SHA + Turso DB name in
`runtime/STATUS.md`.

After sign-off, O1.5 (production deployment) can proceed with confidence.

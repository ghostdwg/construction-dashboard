# Staging First-Activation Runbook

How to bring a fully-isolated staging tier up for the first time on host `superglitch`. Phase R6 of `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md`.

**Read this entirely before starting.** The procedure is split into two phases:

- **Phase 6.a — Isolated activation** (no public access). Validate the staging stack works without exposing it to the internet. **Zero production-compose changes.**
- **Phase 6.b — Shared-edge activation** (public access via staging hostname). Requires a one-time additive change to the production Caddy network attachments.

Phase 6.a is sufficient to validate end-to-end staging behavior. Phase 6.b is optional polish that comes after.

---

## Critical principle

**Production remains authoritative.** R6 is additive. Staging may fail catastrophically without harming production:

- Staging Turso DB is separate from prod Turso DB.
- Staging Compose project is namespaced `neuroglitch-staging`; all containers, volumes, and networks carry that prefix.
- Staging storage bind is `/opt/neuroglitch/storage-staging` (separate host directory).
- Staging env file is `/opt/neuroglitch/.env.staging` (separate file).
- Staging secrets are all per-tier from `GroundWorX-staging` 1Password vault.

If any step in this runbook fails, abort and document. Do not improvise on production.

---

## Prerequisites

Confirm ALL of the following before starting:

| # | Prerequisite | How to verify |
|---|---|---|
| 1 | Phase R5 deployed to production | Production responds with `X-App-Env: production` header on `curl -sI https://groundworx.neuroglitch.ai/` |
| 2 | Production env file has `APP_ENV=production` | `ssh superglitch grep '^APP_ENV=' /opt/neuroglitch/.env` returns `APP_ENV=production` |
| 3 | Production containers are healthy | `docker compose -p neuroglitch ps` shows all services `Up (healthy)` |
| 4 | Turso CLI installed locally | `turso --version` returns a version string |
| 5 | 1Password CLI or vault access available | Operator can read items from a `GroundWorX-staging` vault (creating it is Step 1 below if absent) |
| 6 | SSH access to `superglitch` | `ssh superglitch echo ok` returns `ok` |
| 7 | R6 PR merged to main | `git log main --oneline | head -1` shows the R6 commit |
| 8 | Sufficient disk on superglitch | `df -h /opt/neuroglitch` shows > 10 GiB free |

Abort if any prerequisite fails.

---

## Phase 6.a — Isolated activation (zero prod-compose touch)

### Step 1 — Provision the staging Turso DB

```text
turso db create groundworx-staging-ghostdwg --group default
turso db tokens create groundworx-staging-ghostdwg --expiration 90d > /tmp/staging-token.txt
```

Copy the token from `/tmp/staging-token.txt` into the `GroundWorX-staging` 1Password vault, item `Turso Staging Token`. Then:

```text
shred -u /tmp/staging-token.txt
```

**Verify:** `turso db list | grep groundworx-staging-ghostdwg` shows the new DB.

### Step 2 — Generate per-tier secrets

Generate each independently. **None may equal any production secret.**

```text
openssl rand -hex 32   # AUTH_SECRET
openssl rand -hex 32   # SETTINGS_ENCRYPTION_KEY
openssl rand -hex 32   # CREDENTIAL_MASTER_KEY
openssl rand -hex 32   # SIDECAR_API_KEY
openssl rand -hex 32   # SIDECAR_CALLBACK_TOKEN
openssl rand -hex 32   # WORKER_TOKEN
```

Store each in `GroundWorX-staging` 1Password vault with the matching item name. **Cross-check:** every value must differ from `GroundWorX-prod` equivalents.

### Step 3 — Populate `/opt/neuroglitch/.env.staging`

On host:

```text
ssh superglitch
sudo cp /opt/neuroglitch/.env.staging /opt/neuroglitch/.env.staging.backup.$(date +%Y%m%d-%H%M%S) 2>/dev/null || true

# Copy template:
#   construction-dashboard/runtime/env/staging.env.bootstrap.example
# Fill in placeholders with values from GroundWorX-staging vault.

sudo nano /opt/neuroglitch/.env.staging
sudo chmod 600 /opt/neuroglitch/.env.staging
sudo chown root:root /opt/neuroglitch/.env.staging
```

**Verify line-by-line:**
- `APP_ENV=staging` (exact)
- `DATABASE_URL` contains `groundworx-staging-ghostdwg` (NOT `groundworx-prod-ghostdwg`)
- `NEXTAUTH_URL=https://staging.groundworx.neuroglitch.ai` (NOT the prod URL)
- `AUTH_DISABLED=false`
- All `*_TOKEN` and `*_KEY` and `*_SECRET` values are distinct from prod

### Step 4 — Apply migrations to staging Turso

The Phase R6.6 runner enforces an APP_ENV tier fence and refuses any URL that does not match `groundworx-staging`. Run from inside the staging worktree:

```text
ssh superglitch
cd /opt/neuroglitch/apps/construction-dashboard-staging

APP_ENV=staging \
  DATABASE_URL=$(grep '^DATABASE_URL=' /opt/neuroglitch/.env.staging | sed 's/^DATABASE_URL=//') \
  npm run migrate:turso
```

Use `npm run migrate:turso:status` for a dry-run that lists pending migrations without applying.

**Verify:** the script reports `Done. Applied N migration(s).` and the in-DB count of `_prisma_migrations` rows matches the `prisma/migrations/` directory count. Empty DB starts at 0; after running, count equals the local migrations dir.

Full procedure, exit codes, and failure recovery: `runtime/runbooks/turso-migrations.md`.

### Step 5 — Create staging storage directory

```text
ssh superglitch
sudo mkdir -p /opt/neuroglitch/storage-staging
sudo chown neuroglitch:65533 /opt/neuroglitch/storage-staging
sudo chmod 775 /opt/neuroglitch/storage-staging
```

Permissions mirror the production storage path so the containerized `nextjs` user (uid 1001) can write.

**Verify:** `ls -ld /opt/neuroglitch/storage-staging` shows `drwxrwxr-x neuroglitch 65533`.

### Step 6 — Bring up the staging compose stack (Phase 6.a)

Operator decides the SHA to deploy (typically `main` HEAD or an explicitly-tagged staging candidate). Set the env var:

```text
ssh superglitch
cd /opt/neuroglitch/construction-dashboard
git fetch && git checkout <staging-sha>
export APP_SHA=<staging-sha>

# Phase 6.a invocation: no edge network, no caddy route.
docker compose \
  -f runtime/compose/base.yml \
  -f runtime/compose/overrides/staging.active.yml \
  -p neuroglitch-staging \
  up -d --force-recreate app sidecar worker
```

**Note:** the `up -d <service-list>` explicitly limits services to `app sidecar worker`. The `caddy`, `landing`, `hello`, `api` services defined in base.yml are NOT started in staging.

### Step 7 — Validate (Phase 6.a, internal-only)

```text
# Confirm three containers running
docker compose -p neuroglitch-staging ps

# Expected:
#   neuroglitch-staging-app      Up (healthy)
#   neuroglitch-staging-sidecar  Up (healthy)
#   neuroglitch-staging-worker   Up

# Confirm APP_ENV propagated
docker exec neuroglitch-staging-app     printenv APP_ENV   # → staging
docker exec neuroglitch-staging-sidecar printenv APP_ENV   # → staging
docker exec neuroglitch-staging-worker  printenv APP_ENV   # → staging

# Confirm app responds healthy internally
docker exec neuroglitch-staging-app curl -sf http://localhost:3000/api/health

# Confirm X-App-Env header
docker exec neuroglitch-staging-app curl -sI http://localhost:3000/ | grep -i 'X-App-Env'
# Expected: X-App-Env: staging

# Confirm the visible orange staging banner renders
docker exec neuroglitch-staging-app curl -s http://localhost:3000/ | grep -i 'STAGING'
# Expected: at least one match (the banner text)

# Confirm storage bind is staging-only
docker exec neuroglitch-staging-app sh -c 'echo staging-test > /storage/_isolation-check.txt'
ls -l /opt/neuroglitch/storage-staging/_isolation-check.txt   # exists
ls -l /opt/neuroglitch/storage/_isolation-check.txt 2>/dev/null  # does NOT exist
docker exec neuroglitch-staging-app rm /storage/_isolation-check.txt

# Confirm production untouched
docker exec neuroglitch-app printenv APP_ENV         # → production
curl -sf https://groundworx.neuroglitch.ai/api/health   # → 200
```

**All six checks must pass before proceeding to Phase 6.b.**

If any check fails:
1. Capture logs: `docker compose -p neuroglitch-staging logs --since 5m > /tmp/staging-failure.log`.
2. Tear down staging (rollback per §Rollback below).
3. Investigate. Production is untouched.

### Step 8 — Smoke staging end-to-end (Phase 6.a)

With staging healthy in isolation, run light smoke from inside the staging app container:

```text
docker exec neuroglitch-staging-app curl -sf -X POST \
  -H "X-Worker-Token: <staging-WORKER_TOKEN-from-vault>" \
  http://localhost:3000/api/jobs/run-due
# Expected: {"processed":0,...} or similar valid JSON
```

If the BackgroundJob table is empty (fresh staging), `processed:0` is expected. If you want to validate the full path, create a stub job row via Prisma Studio against the staging Turso DB.

---

## Phase 6.b — Shared-edge activation (public access)

**Optional.** Phase 6.a is sufficient to validate staging. Phase 6.b adds public access at `staging.groundworx.neuroglitch.ai`. This step touches production Caddy.

### Step 9 — Add staging DNS record

Add an A record: `staging.groundworx.neuroglitch.ai → <superglitch public IP>`. Wait for propagation (verify with `dig staging.groundworx.neuroglitch.ai` from an external resolver).

### Step 10 — Create the external Docker network

```text
ssh superglitch
docker network create neuroglitch_edge
docker network ls | grep neuroglitch_edge   # verify created
```

This network is shared between the production and staging Compose projects.

### Step 11 — Connect production Caddy to the external network

```text
ssh superglitch
docker network connect neuroglitch_edge neuroglitch-caddy
docker network inspect neuroglitch_edge | grep neuroglitch-caddy   # verify
```

**Caveat:** this is an imperative `docker network connect`. It persists until the Caddy container is recreated. To make it permanent, the production compose file must be modified to declare `neuroglitch_edge` in caddy's networks list — that is a separate production-compose change requiring its own review.

For Phase 6.b first activation, the imperative `network connect` is acceptable provided the operator documents that the next caddy recreate must re-attach the network.

### Step 12 — Connect staging app to the external network

```text
docker network connect neuroglitch_edge neuroglitch-staging-app
```

Same caveat applies — persists until staging-app is recreated. Long-term: add `neuroglitch_edge` to `runtime/compose/overrides/staging.active.yml` as an `external` network declaration.

### Step 13 — Add the staging route to Caddyfile

```text
ssh superglitch
sudo cp /opt/neuroglitch/infrastructure/caddy/Caddyfile \
        /opt/neuroglitch/infrastructure/caddy/Caddyfile.backup.$(date +%Y%m%d-%H%M%S)

# Edit Caddyfile to append the snippet from:
#   construction-dashboard/runtime/caddy/staging-route.example.snippet

sudo nano /opt/neuroglitch/infrastructure/caddy/Caddyfile
```

The snippet to add:

```text
staging.groundworx.neuroglitch.ai {
    reverse_proxy neuroglitch-staging-app:3000
}
```

### Step 14 — Validate and reload Caddy

```text
docker exec neuroglitch-caddy caddy validate \
  --config /etc/caddy/Caddyfile

# Only proceed if validate succeeds.

docker exec neuroglitch-caddy caddy reload \
  --config /etc/caddy/Caddyfile
```

Caddy reload is online — no app downtime. ACME issues the staging cert automatically; first request may take a few seconds.

### Step 15 — Validate public staging access

```text
# From any external host
curl -sf https://staging.groundworx.neuroglitch.ai/api/health
# Expected: 200, JSON body with "status":"ok"

curl -sI https://staging.groundworx.neuroglitch.ai/
# Expected headers include:
#   X-App-Env: staging
#   server: Caddy
#   strict-transport-security: ...

# Confirm production STILL works
curl -sf https://groundworx.neuroglitch.ai/api/health
# Expected: 200 (unchanged)
```

Open `https://staging.groundworx.neuroglitch.ai/` in a browser. Confirm:
- Orange "STAGING" banner visible at the top.
- Login flow works with a freshly-created staging user (no shared session with prod).
- Pages render normally.

---

## Rollback

### Rollback Phase 6.b (return to Phase 6.a state)

```text
ssh superglitch

# Remove the staging route from the live Caddyfile (edit and remove the block,
# OR restore the backup taken in Step 13):
sudo cp /opt/neuroglitch/infrastructure/caddy/Caddyfile.backup.<TS> \
        /opt/neuroglitch/infrastructure/caddy/Caddyfile

docker exec neuroglitch-caddy caddy reload --config /etc/caddy/Caddyfile

# Disconnect app from external network
docker network disconnect neuroglitch_edge neuroglitch-staging-app
docker network disconnect neuroglitch_edge neuroglitch-caddy

# Optionally remove the external network (only if no other project uses it):
docker network rm neuroglitch_edge
```

Production is untouched throughout (the Caddyfile change adds the staging block; removing it returns to the pre-R6 state). Staging compose stack continues running in isolation (Phase 6.a state).

### Rollback Phase 6.a (full staging teardown)

```text
ssh superglitch

# Stop and remove staging containers (preserves volumes and storage)
docker compose -p neuroglitch-staging down

# To also remove the staging Docker volume (caution — preserves the host
# bind directory but loses Docker metadata):
docker volume rm neuroglitch-staging_storage 2>/dev/null

# The staging Turso DB persists. To wipe it:
turso db destroy groundworx-staging-ghostdwg

# /opt/neuroglitch/storage-staging persists on disk. Remove if desired:
sudo rm -rf /opt/neuroglitch/storage-staging

# /opt/neuroglitch/.env.staging persists. Move aside if not needed:
sudo mv /opt/neuroglitch/.env.staging /opt/neuroglitch/.env.staging.disabled
```

Production is untouched. Operator can rerun Phase 6.a Steps 1-8 to re-activate.

---

## Post-activation operator log

Record in `planning/ops-log-<year>.md`:

```text
## YYYY-MM-DD — Staging Phase 6.a activated

- APP_SHA deployed:                     <sha>
- Turso DB created:                     groundworx-staging-ghostdwg
- Storage bind:                         /opt/neuroglitch/storage-staging
- Env file:                             /opt/neuroglitch/.env.staging
- All 6 isolation checks passed:        yes
- Smoke run-due returned:               processed:0
- Production health post-activation:    200

## YYYY-MM-DD — Staging Phase 6.b activated (optional)

- DNS record verified:                  staging.groundworx.neuroglitch.ai
- External network created:             neuroglitch_edge
- Caddyfile snippet applied:            yes
- ACME staging cert issued:             yes
- Public URL responds:                  https://staging.groundworx.neuroglitch.ai/api/health → 200
- Production URL still responds:        https://groundworx.neuroglitch.ai/api/health → 200
```

---

## Future hardening (not Phase 6)

After staging stabilizes:

1. **Make the `neuroglitch_edge` network declaration persistent** in the production compose file (so Caddy reconnects on recreate). Requires a small production-compose PR.
2. **Make the `neuroglitch_edge` network declaration persistent** in `runtime/compose/overrides/staging.active.yml` as an `external` network. Documented under R7+.
3. **Enable Procore sandbox** in staging.env.staging if staging needs to exercise the integration.
4. **Enable Resend** in staging.env.staging with a sandbox sender domain.
5. **Drift detection job** that compares staging Turso schema against prod Turso schema before each prod deploy.

---

## Canonical references

- `runtime/compose/base.yml` — service topology.
- `runtime/compose/overrides/staging.active.yml` — the activatable staging override (Phase R6).
- `runtime/compose/overrides/staging.yml` — Phase R3 documentation placeholder.
- `runtime/env/staging.env.bootstrap.example` — env template for Step 3.
- `runtime/env/staging.env.example` — general staging env template (R2).
- `runtime/caddy/staging-route.example.snippet` — Caddy route for Step 13.
- `runtime/runbooks/environment-promotion.md` — ongoing deploy flow after activation.
- `runtime/runbooks/app-env-rollout.md` — APP_ENV rollout ordering.
- `runtime/deployment/compose-governance.md` — layering and immutable expectations.
- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §4 — staging strategy.
- `Migration/Production Runtime Assessment.txt` — current production state.

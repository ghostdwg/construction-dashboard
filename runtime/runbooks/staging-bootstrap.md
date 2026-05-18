# Staging Bootstrap Runbook

How staging gets stood up the first time. **No deploy commands appear in this runbook** — those land in Phase R7. This document captures the **intended configuration** the operator establishes during staging activation (Phase R6 of workspace normalization).

Today (Phase R2), staging is partially provisioned: `/opt/neuroglitch/.env.staging` exists on host `superglitch` (unused), and `/opt/neuroglitch/storage-staging/` exists (empty). No staging containers run. This runbook describes the target end state.

---

## Goal

Bring up a **fully isolated staging tier** on the existing production host `superglitch`, sharing only the Caddy edge with production. Same hardware, same Docker daemon, completely separate Compose project, network, volumes, and Turso DB.

After bootstrap:

- `staging.groundworx.neuroglitch.ai` serves the staging app.
- `groundworx.neuroglitch.ai` continues to serve production, untouched.
- Both routes terminate at the single shared Caddy container.

---

## Intended configuration (target state after bootstrap)

### Compose project naming

| Tier | Compose project | Container name pattern |
|---|---|---|
| Production (existing) | `neuroglitch` | `neuroglitch-app`, `neuroglitch-sidecar`, `neuroglitch-worker`, `neuroglitch-caddy`, `neuroglitch-landing`, `neuroglitch-hello`, `neuroglitch-api` |
| Staging (new) | `neuroglitch-staging` | `neuroglitch-staging-app`, `neuroglitch-staging-sidecar`, `neuroglitch-staging-worker` |

The shared Caddy container belongs to the `neuroglitch` project (production). Staging does NOT run its own Caddy. The production Caddy's Caddyfile gains a staging route (see below). The vestigial `landing`, `hello`, and `api` containers do not run in staging.

### Storage paths

| Tier | Host bind | Container mount |
|---|---|---|
| Production | `/opt/neuroglitch/storage` | `/storage` |
| Staging | `/opt/neuroglitch/storage-staging` | `/storage` |

Staging never writes to the production storage path. The bind mount is enforced by the Compose override at `runtime/compose/overrides/compose.staging.yml` (authored in Phase R3).

### DNS / subdomain structure

| Hostname | Tier | Backed by |
|---|---|---|
| `groundworx.neuroglitch.ai` | production | `neuroglitch-app:3000` |
| `staging.groundworx.neuroglitch.ai` | staging | `neuroglitch-staging-app:3000` |
| `neuroglitch.ai` | n/a | `neuroglitch-landing:80` (static marketing) |
| `hello.neuroglitch.ai`, `api.neuroglitch.ai` | n/a | vestigial; decommission candidates |

The staging hostname requires a DNS record. ACME via Caddy issues the cert automatically once the record resolves to the host's IP and the Caddyfile route is reloaded.

### Caddy routing model

Production Caddy gains a new vhost block (added to `/opt/neuroglitch/infrastructure/caddy/Caddyfile`, mirrored in `runtime/caddy/Caddyfile.prod.example`):

```text
# Staging vhost (added during staging bootstrap)
staging.groundworx.neuroglitch.ai {
    reverse_proxy neuroglitch-staging-app:3000
}
```

The existing `groundworx.neuroglitch.ai` block is left untouched. Caddy is reloaded (`docker exec neuroglitch-caddy caddy reload --config /etc/caddy/Caddyfile`) — no container restart, no app downtime.

Caddy's named volumes (`neuroglitch_caddy_data`, `neuroglitch_caddy_config`) hold the ACME state for both certs after issuance. **Backup these volumes before any subsequent Caddy recreate.**

### Turso separation

| Tier | Turso DB |
|---|---|
| Production | `groundworx-prod-ghostdwg` (existing) |
| Staging | `groundworx-staging-ghostdwg` (provisioned during bootstrap) |

Each tier has:

- A separate Turso DB.
- A separate Turso auth token (scoped to its DB only).
- Independent migration history (`_prisma_migrations` table inside each DB).

The Phase R5 Zod fence in `lib/env.ts` enforces this: an `APP_ENV=staging` process refuses to start if `DATABASE_URL` does not contain `staging`. Symmetric refusal for production.

### APP_ENV values

| Tier | `APP_ENV` |
|---|---|
| Local (laptop) | `local` |
| Staging | `staging` |
| Production | `production` |

The `APP_ENV` value is set in the host env file (`/opt/neuroglitch/.env.staging` for staging) and consumed by the Compose `env_file:` directive. No image rebuild is required to change the value — it is runtime-only.

---

## Bootstrap order (high-level; no commands)

The operator performs these steps **in order**. Each step is independently reversible until step 7.

1. **Provision Turso staging DB.** Create `groundworx-staging-ghostdwg` via Turso CLI. Generate a scoped auth token. Store in the `GroundWorX-staging` 1Password vault.
2. **Provision encryption keys for staging.** Generate `AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `CREDENTIAL_MASTER_KEY`, `SIDECAR_API_KEY`, `SIDECAR_CALLBACK_TOKEN`, `WORKER_TOKEN`. Each is independent of production. Store all in the `GroundWorX-staging` 1Password vault.
3. **Populate `/opt/neuroglitch/.env.staging` on `superglitch`.** Source values from the vault. Use `runtime/env/staging.env.example` as the shape reference. Verify file permissions match production env file (`chmod 600`, root-owned).
4. **Add staging DNS record.** Point `staging.groundworx.neuroglitch.ai` at the host's public IP. Wait for propagation (~5 min).
5. **Add staging route to Caddyfile.** Edit `/opt/neuroglitch/infrastructure/caddy/Caddyfile` (and the in-repo `runtime/caddy/Caddyfile.prod.example` so they stay aligned). Reload Caddy. ACME issues the staging cert.
6. **Apply migrations to staging Turso.** Invoke `scripts/apply-turso-migrations.mjs` with the staging `DATABASE_URL` and token. Verify the migration count matches what production has.
7. **First Compose recreate** for staging — bring up `neuroglitch-staging-app`, `neuroglitch-staging-sidecar`, `neuroglitch-staging-worker`. This is the one-way step; subsequent deploys are normal `runtime/deployment/deploy-staging.ps1` invocations.
8. **Smoke test.** Auth flow, bid CRUD, spec upload, sidecar parse round-trip, GPU smoke if Tailscale ACL permits.

After step 7, staging is live. Subsequent staging deploys follow `environment-promotion.md` flow.

---

## Refusal conditions during bootstrap

The operator aborts the bootstrap if any of the following:

- The staging Turso DB has prod data accidentally cloned into it. (Staging starts EMPTY — schema only, no rows.)
- Any encryption key matches the production value. (Per-tier isolation is mandatory.)
- The Caddyfile edit introduced a typo that breaks the production vhost. (Reload Caddy with `--dry-run` first if available; otherwise edit a copy and validate before swapping.)
- The DNS record has not propagated. (Wait; do not proceed.)
- The host has insufficient disk space for the staging storage path. (Verify `df -h /opt/neuroglitch/storage-staging` shows headroom.)

---

## Post-bootstrap verification

| Check | Expected |
|---|---|
| `docker compose -p neuroglitch-staging ps` | three healthy containers (app, sidecar, worker) |
| `curl -sf https://staging.groundworx.neuroglitch.ai/api/health` | `{"status":"ok",…}` |
| `curl -sf https://groundworx.neuroglitch.ai/api/health` | unchanged from before staging bootstrap |
| `docker volume ls` | both `neuroglitch_storage` and (host bind for) `storage-staging` present |
| Staging Turso row count | matches expected seed (typically: User table empty or with the bootstrap operator only) |
| ACME state | both certs issued, expiration > 30 days |

---

## What this runbook does NOT do

- Does not contain executable provisioning commands. Those scripts arrive in Phase R7.
- Does not document day-to-day staging deploys (see `environment-promotion.md`).
- Does not document staging-to-prod promotion gates (see `environment-promotion.md`).
- Does not document rollback (see `environment-promotion.md` §Rollback philosophy; concrete rollback runbook in Phase R8).
- Does not bootstrap a SECOND production tier. There is exactly one prod tier; multi-region or DR is a Phase 2 concern.

---

## Canonical references

- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §4 (staging strategy), §7 Phase R6 (staging activation).
- `Migration/ARCHITECTURE_V1` §3 (production topology), §11 Phase C' (staging stand-up).
- `Migration/TURSO_ENVIRONMENT_SEPERATION_STRATEGY.md` §3 (migration-safe DB strategy).
- `Migration/Production Runtime Assessment.txt` §1, §3, §10 (current host state, including `.env.staging` and `storage-staging/`).
- `runtime/env/staging.env.example` — env shape.
- `runtime/runbooks/environment-promotion.md` — ongoing deploy flow after bootstrap.

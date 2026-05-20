# Compose Governance

Layering rules, override philosophy, and operational expectations for the GroundWorX Compose stack. Phase R3 of `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md`.

This document does not contain executable commands. It describes the **rules** that govern how `runtime/compose/base.yml` combines with the per-tier overrides, and what operators may and may not change at each layer.

---

## 1. Layering rules

GroundWorX Compose is structured in **two required layers** per tier, plus an optional operationally-additive observability overlay:

| Layer | File | Responsibility | Required? |
|---|---|---|---|
| **Base** | `runtime/compose/base.yml` | Service topology — what services exist, how they depend on each other, what networks they share, what volumes they mount, what healthchecks they run, how they restart. Tier-agnostic. | Yes |
| **Tier overlay** | `runtime/compose/overrides/<tier>.yml` (or `<tier>.active.yml` for staging) | Tier-specific values — image tags, env_file paths, volume bind sources, host port publishing, Caddyfile bind source. Plus any tier-only services or settings. | Yes |
| **Observability overlay** | `runtime/compose/observability.yml` | Adds Loki, Promtail, Prometheus, Grafana to the stack and joins Prometheus to the `neuroglitch` network so it can scrape `app:3000/metrics`. Does NOT redefine `app`/`sidecar`/`worker`. | Optional (per §10) |

Operator-personal overrides do not exist; if an operator needs to test something locally, they author a fourth file under `runtime/compose/overrides/local.yml` (Phase R3+ if needed) — never editing `base.yml` or a tier overlay in place.

Standard tier invocation (no observability):

```text
docker compose -f base.yml -f overrides/<tier-overlay>.yml -p <project-name> up -d [services...]
```

Full activation graph (with observability):

```text
docker compose \
  -f base.yml \
  -f overrides/<tier-overlay>.yml \
  -f observability.yml \
  -p <project-name> \
  up -d
```

Order matters: `base.yml` first, tier overlay second, observability overlay last. Compose merges left-to-right; later overlays' values win on conflict. The observability overlay does not collide with tier overlays today — it only adds services and an additional network.

### Staging overlay selection

Two staging overlays are committed; only one is activatable:

- `overrides/staging.yml` — R3 PLACEHOLDER. Literal `:<staging-sha>` image strings. Documentation only; never invoked by any runbook or deploy script.
- `overrides/staging.active.yml` — R6 ACTIVATABLE. Uses `${APP_SHA:?...}` substitution. This is the overlay every staging activation must use.

Worker `APP_URL=http://app:3000` is set exclusively in `staging.active.yml`. Setting it elsewhere creates dead duplicate authority — see §10 below and the [overrides/README.md](../compose/overrides/README.md) APP_URL authority note.

---

## 2. Override philosophy

The override exists to do two things:

1. **Specialize values** that are tier-dependent (image tag, env file location, host bind source, host port).
2. **Add services** that are tier-only (e.g., production includes `caddy`, `landing`, `hello`, `api` which staging does not).

The override does NOT exist to:

- Rename services from base.
- Change healthcheck shape.
- Change `depends_on` relationships.
- Change network membership.
- Remove services already declared in base (Compose merge does not support removal; tier-specific exclusion is via the `up -d <service-list>` argument).
- Introduce new tier-specific networks beyond the shared `neuroglitch` network. (Cross-project networking — e.g., shared Caddy edge — uses **external** networks declared explicitly; see §6.)

If a change would require breaking these rules, it belongs in `base.yml`, not the override. If it belongs in `base.yml` but the change is itself tier-specific (a contradiction), the architecture needs a discussion before code, not a hack in the override.

---

## 3. Immutable expectations

Across all tiers, these properties of the Compose stack are immutable and any change requires an architectural decision recorded in `planning/`:

1. **Service names**: `caddy`, `app`, `sidecar`, `worker`, `landing`, `hello`, `api`. Renames require a coordinated app code, runbook, and deploy-script update. Never rename in an override.
2. **Compose project naming convention**: `neuroglitch` (prod), `neuroglitch-staging` (staging), `neuroglitch-<tier>` (future tiers). Never invoke production deploys without explicit `-p neuroglitch`.
3. **Network name**: `neuroglitch` declared inside the compose file. With project `neuroglitch`, Docker produces network `neuroglitch_neuroglitch`. Match for staging: `neuroglitch-staging_neuroglitch`. Never declare a different network name in an override.
4. **Storage volume name**: `storage` declared in base; bind source is set in override. Never rename the volume in an override.
5. **Caddy volumes**: `caddy_data`, `caddy_config` are Docker-managed named volumes that hold ACME state and runtime config. Never recreate Caddy without backing up these volumes first.
6. **Restart policy**: `unless-stopped` on every service. Match the rest of the stack — do not introduce `always` or `on-failure` selectively without justification.
7. **Healthchecks**: `app` probes `/api/health`; `sidecar` probes `/health`. Worker tick-file healthcheck is added in Phase R4. Do not weaken or remove these.
8. **`depends_on` start order**: worker → app → sidecar. Caddy depends on `hello` (vestigial). Never break this chain without architectural review — the worker's historical DNS failures (Production Runtime Assessment §17, DEPLOYMENT_DNS_ANALYSIS-Corrected) traced to violating start order.

---

## 4. Deploy sequencing

For every tier, every deploy follows the same six-step ordered sequence:

```text
1. VERIFY     ─ git working tree clean
              ─ CI green for target SHA
              ─ SHA on main (or approved branch)
              ─ image tags exist in registry (Phase R8+)

2. SNAPSHOT   ─ (production only) Turso PITR via snapshot-prod.sh

3. MIGRATE    ─ scripts/apply-turso-migrations.mjs (NOT prisma migrate deploy)
              ─ refuses if DATABASE_URL pattern doesn't match target tier

4. RECREATE   ─ docker compose -f base.yml -f overrides/<tier>.yml \
                  -p <project> up -d --force-recreate <services>
              ─ Compose pulls tagged images (Phase R8+)
              ─ containers reattach to existing named volumes
              ─ Caddy is NOT recreated unless its image or Caddyfile changes
                (ACME state stays warm)

5. HEALTH     ─ health-check.sh <tier>
              ─ probes /api/health, /health, worker tick file
              ─ deploy is NOT successful until all probes return expected

6. RECORD     ─ ops log entry: SHA, tier, operator, start, end, smoke result
              ─ (production only) git tag prod-YYYY-MM-DD.N
```

This sequencing is encoded in `runtime/deployment/deploy-staging.ps1` and `deploy-prod.ps1` (Phase R4 stubs, R7 real). Sequence is non-negotiable: **migrate before recreate**, **snapshot before migrate in prod**.

---

## 5. Rollback expectations

Rollback is **image-tag based**, not git-revert based.

| Scenario | Action |
|---|---|
| Bad image, schema unchanged | `docker compose ... up -d --force-recreate <services>` with previous image tag. |
| Bad image, schema changed | Restore the Turso PITR snapshot taken in step 2; redeploy at previous image tag. |
| Migration applied to wrong tier | Forward-fix only. Never reverse-migrate prod data manually. |
| Caddy state wiped (ACME volumes lost) | Restore from offline backup of `neuroglitch_caddy_data`. Avoid issuing new certs until backup is verified missing — LE rate limits. |

The rollback script (`runtime/deployment/rollback.ps1`, Phase R4 stub) refuses to proceed if:

- No previous image tag exists.
- The previous tag is older than 30 days (warn; operator can override).
- Current state cannot be snapshotted first.

---

## 6. Environment isolation philosophy

Each tier is fully isolated at the Compose layer:

| Dimension | Production | Staging |
|---|---|---|
| Compose project | `neuroglitch` | `neuroglitch-staging` |
| Network (default for project) | `neuroglitch_neuroglitch` | `neuroglitch-staging_neuroglitch` |
| Volume `storage` | `neuroglitch_storage` (bind `/opt/neuroglitch/storage`) | `neuroglitch-staging_storage` (bind `/opt/neuroglitch/storage-staging`) |
| Volume `caddy_data` | `neuroglitch_caddy_data` (managed) | — (no caddy in staging) |
| env_file | `/opt/neuroglitch/.env` | `/opt/neuroglitch/.env.staging` |
| Image tags | `<prod-sha>` | `<staging-sha>` (typically newer) |
| Container names | `neuroglitch-app`, … | `neuroglitch-staging-app`, … |
| Turso DB | `groundworx-prod-ghostdwg` | `groundworx-staging-ghostdwg` |
| Encryption keys | prod vault | staging vault |
| Public hostname | `groundworx.neuroglitch.ai` | `staging.groundworx.neuroglitch.ai` |

### Shared resources (deliberate, controlled)

Two resources are deliberately shared between tiers:

1. **The host `superglitch`** — both projects run on it; the kernel and Docker daemon are shared. Resource pressure is a real consideration for capacity planning, not a correctness concern.
2. **The Caddy edge** — one Caddy container in the `neuroglitch` project serves both the prod hostname and the staging hostname. This requires an **external Docker network** declared in both compose projects so Caddy can resolve `neuroglitch-staging-app:3000` across project boundaries.

   - The external network (suggested name: `neuroglitch_edge`) is created once by the operator, outside Compose.
   - Production's compose declares it as `external: true` and attaches Caddy + app to it.
   - Staging's compose declares the same external network and attaches its app.
   - Phase R6 staging bootstrap is the moment this external network is introduced. R3 documents the requirement; R6 implements it.

Beyond these two, every other resource is per-project and per-tier.

---

## 7. The "no live edits" rule

The host-side `/opt/neuroglitch/docker-compose.yml` is the live production compose today. After Phase R7 cutover, the live file is replaced by a thin invocation that references `construction-dashboard/runtime/compose/base.yml + overrides/production.yml` (either by symlink, by copy-on-deploy, or by reading directly from the host's git checkout — the choice is a Phase R7 operator decision).

Once that cutover lands, **edits to the live compose file are forbidden**. Any change goes through:

1. Edit `runtime/compose/base.yml` or `overrides/<tier>.yml` on the laptop.
2. PR, review, merge to main.
3. Deploy via the normal flow (`deploy-prod.ps1 <sha>`).

This rule exists because edits to the live file on the host are invisible to Git and to staging. They cause production drift that can break the next deploy (the next `docker compose up` reverts the live edit if it deploys from Git, or preserves the drift if it deploys from the host file — neither is what the operator usually wants).

---

## 8. What changes when (phase mapping)

| Phase | What lands in compose governance |
|---|---|
| R3 (this phase) | `TOPOLOGY.md`, `base.yml` (reconstruction), `overrides/*.yml` (placeholders), this governance doc |
| R4 | Worker entrypoint hardening reflects in `runtime/worker/`; worker healthcheck eventually adds to base.yml |
| R5 | App-level `APP_ENV` enforcement (no compose change) — operator MUST add `APP_ENV=production` to `/opt/neuroglitch/.env` BEFORE deploying R5 code |
| R6 | Staging activated; `neuroglitch_edge` external network introduced; `staging.yml` becomes invokable |
| R7 | Production cutover from `/opt/neuroglitch/docker-compose.yml` to runtime/compose/. Verify line-by-line equivalence first. |
| R8 | GHCR image tags become real; deploy scripts switch from `docker compose build` to `docker compose pull` |
| Z | Decommission vestigial services (landing, hello, api) from base.yml; archive deploy/ and infra/ |

---

## 9. Canonical references

- `runtime/compose/base.yml` — the base layer this document governs.
- `runtime/compose/overrides/production.yml`, `staging.yml` (R3 placeholders), `staging.active.yml` (R6 activatable) — the tier overlays.
- `runtime/compose/observability.yml` — operationally-additive Loki/Promtail/Prometheus/Grafana overlay (O1.2).
- `runtime/compose/TOPOLOGY.md` — descriptive snapshot of current production topology.
- `runtime/runbooks/environment-promotion.md` — the per-deploy procedure that invokes the compose stack.
- `runtime/runbooks/staging-first-activation.md` — Phase R6 isolated-activation runbook (uses `staging.active.yml`).
- `runtime/runbooks/staging-bootstrap.md` — earlier R3 provisioning notes.
- `Migration/Production Runtime Assessment.txt` — authoritative description of current production runtime.
- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §4, §7 — staging strategy and phase plan.

---

## 10. Observability overlay (O1.2)

`runtime/compose/observability.yml` is sanctioned as an **operationally-additive** overlay. It is the only file outside the base + tier-overlay pair that the deploy invocation may include, and it is governed by these rules:

1. **Additive only.** The overlay declares its own services (`loki`, `promtail`, `prometheus`, `grafana`) and a dedicated network (`groundworx_observability`). It MUST NOT redefine any service from `base.yml`. The one cross-layer reference it makes is joining `prometheus` to the base-declared `neuroglitch` network so it can resolve `app:3000` for the `/metrics` scrape — that connection is the entire reason the overlay exists.

2. **No tier-specific values.** The overlay reads no host paths and pins explicit image versions. It works identically against the production project (`-p neuroglitch`) and the staging project (`-p neuroglitch-staging`). Tier-specific concerns (retention windows, alert routing) live inside the configuration files under `runtime/observability/`, not in the compose overlay.

3. **Optional at the tier level.** Staging activation Phase 6.a (isolated) MAY run without observability. The staging-activation-full runbook brings it up once the base activation has been validated. Production activation MUST include it after Phase R7 cutover.

4. **No collision authority.** If a future need creates a real conflict between the observability overlay and a tier overlay, that signals a missing service in `base.yml`, not a justification to redefine services in the overlay.

5. **CI validation.** `.github/workflows/runtime-compose-lint.yml` validates every meaningful invocation graph:
   - `base + production`
   - `base + staging` (R3 placeholder)
   - `base + staging.active` (R6 activatable)
   - `base + staging.active + observability`
   - `base + production + observability`

   Any PR that breaks any of these renders fails CI.

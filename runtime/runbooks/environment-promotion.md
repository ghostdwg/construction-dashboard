# Environment Promotion Runbook

How a change moves from `local` → `staging` → `production`. **No deploy commands appear in this runbook** — those land in Phase R7 once the deploy scripts (`runtime/deployment/*.ps1`) are implemented. This document captures the **flow, sequencing, and refusal conditions** that the eventual scripts will encode.

## Three tiers, three roles

| Tier | Role | Authorized to write to |
|---|---|---|
| `local` | Developer iteration | Laptop SQLite (`dev.db`) only |
| `staging` | Pre-production validation | Staging Turso DB (`groundworx-staging-ghostdwg`) |
| `production` | Live customer-facing | Production Turso DB (`groundworx-prod-ghostdwg`) |

A change must pass through each tier in order. No change skips staging on its way to production.

---

## Promotion flow

```text
   ┌──────────────────────────────────────────────────────────────┐
   │  1. Local — develop                                           │
   │      • APP_ENV=local                                          │
   │      • file:./dev.db                                          │
   │      • npm run dev:all                                        │
   │      • npm run typecheck && npm run lint && npm run test      │
   └─────────────────────────┬────────────────────────────────────┘
                             │ git commit on feat/* | fix/* | infra/*
                             ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  2. CI on PR                                                  │
   │      • typecheck, test, build (placeholder DB envs)           │
   │      • compose-lint if runtime/compose/** changed             │
   │      • shellcheck if runtime/deployment/** changed            │
   │      • env-template-check if runtime/env/** changed           │
   │      All lanes must pass before merge.                        │
   └─────────────────────────┬────────────────────────────────────┘
                             │ merge to main
                             ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  3. CI image-publish on main                                  │
   │      • Build + tag images at <git-sha>:                       │
   │        ghcr.io/.../groundworx-app:<sha>                       │
   │        ghcr.io/.../groundworx-sidecar:<sha>                   │
   │        ghcr.io/.../groundworx-worker:<sha>                    │
   └─────────────────────────┬────────────────────────────────────┘
                             │ operator triggers staging deploy
                             ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  4. Staging deploy (operator-driven from laptop)              │
   │      • Refusal conditions checked before any host action.     │
   │      • Migrations applied against staging Turso FIRST.        │
   │      • Compose recreate against neuroglitch-staging project.  │
   │      • Health checks pass.                                    │
   └─────────────────────────┬────────────────────────────────────┘
                             │ smoke + sanity, N hours
                             ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  5. Staging validation                                        │
   │      • Smoke test the changed surface end-to-end.             │
   │      • Watch for new error-level log lines.                   │
   │      • Re-run any tests that touched the changed area.        │
   │      • Hold for the agreed soak period.                       │
   └─────────────────────────┬────────────────────────────────────┘
                             │ operator confirms promotion
                             ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  6. Production deploy (operator-driven, deploy window)        │
   │      • snapshot-prod.sh — Turso PITR before any migrate.      │
   │      • Migrations applied against prod Turso.                 │
   │      • Compose recreate against neuroglitch project.          │
   │      • Health checks pass.                                    │
   │      • git tag prod-YYYY-MM-DD.N at the deployed SHA.         │
   │      • Ops log entry.                                         │
   └──────────────────────────────────────────────────────────────┘
```

---

## Deploy sequencing expectations

Every deploy (staging or prod) follows the same six-step ordered sequence:

1. **Verify**. Working tree clean. CI green for target SHA. Target SHA on `main` (or an approved branch).
2. **Snapshot** (prod only). `snapshot-prod.sh` — Turso PITR. Refuse to continue if snapshot fails.
3. **Migrate**. `apply-migrations.sh <tier>` — invokes the bespoke `scripts/apply-turso-migrations.mjs` against the target Turso. **Refuses** unless `DATABASE_URL` pattern matches the target tier. Never runs `prisma migrate deploy` against `libsql://` (returns P1013).
4. **Recreate**. `docker compose -f runtime/compose/base.yml -f runtime/compose/overrides/compose.<tier>.yml -p <project> up -d --force-recreate <services>`. Pulls tagged images from GHCR (Phase R8) rather than building on the host.
5. **Health check**. `health-check.sh <tier>` — probes `/api/health`, `/health`, and (post-R4) the worker tick file. Refuse to mark deploy successful until all probes return expected output.
6. **Record**. Log the deploy in `planning/ops-log-<year>.md` with: target SHA, tier, operator, start time, end time, smoke result.

The order is non-negotiable. **Migrate before recreate** — otherwise containers boot expecting a schema that doesn't exist yet. **Snapshot before migrate** in prod — otherwise an inadvertent migration is unrecoverable.

---

## Rollback philosophy

GroundWorX rollback is **image-tag based**, not git-revert based. Production never rebuilds; it pulls a previously-built image at a previously-tagged SHA.

| Scenario | Rollback action |
|---|---|
| Image is healthy but a feature misbehaves | Roll back to previous image tag: `deploy-prod.ps1 <prev-sha>` |
| Migration applied successfully but introduces a schema problem | **Forward-fix only.** A reverse migration is authored, deployed via the normal flow. Never `git revert` a migration that has run against prod data. |
| Migration applied AND data was lost | Restore the Turso PITR snapshot taken in step 2; re-deploy at the prior image SHA. |
| Caddy ACME state lost (named volumes wiped) | Restore from offline backup of `neuroglitch_caddy_data` and `neuroglitch_caddy_config`. Avoid re-issuing certs until backup is verified missing. |

Refusal conditions in the rollback script:

- No previous image tag exists → script refuses.
- The previous image tag is older than 30 days → script warns; operator must override.
- Snapshot of current state cannot be taken before rollback → script refuses (prevents losing forward-state).

---

## Migration-order expectations

1. **Migrations are explicit operator actions**, never automatic on app boot. The app's `next start` does not invoke Prisma migration. Verified per `construction-dashboard/Dockerfile` and `scripts/apply-turso-migrations.mjs`.
2. **`prisma migrate deploy` is NOT used** against `libsql://` URLs. The bespoke `scripts/apply-turso-migrations.mjs` is the only sanctioned migration runner against Turso.
3. **CI fence** (Phase R5/R8): a CI lane refuses any PR that adds a `prisma migrate deploy` invocation when the target `DATABASE_URL` starts with `libsql://`.
4. **Drift detection** (Phase R8): a periodic job runs `prisma migrate diff --from-url=$STAGING_URL --to-url=$PROD_URL` and reports if non-empty. Cheap insurance.

---

## Staging validation expectations

Before promoting any change from staging to production, the operator confirms:

1. All health checks have stayed green for the agreed soak window (default: 2 hours; extend per change risk).
2. No new `level=error` log lines from any container in the staging stack since deploy.
3. Smoke test the specific feature surface that the change touched.
4. If the change affects auth or sessions: log in, log out, and reload as a real test user. Auth.js sessions surviving the deploy is the actual signal.
5. If the change affects GPU paths: a real audio file passes through the meeting transcription flow end-to-end.
6. If the change affects Procore or Resend webhooks: replay a known-good webhook and verify the expected handler executes.

No promotion without all six confirmed for the affected surfaces. The operator's confirmation is recorded in `planning/ops-log-<year>.md` as part of the deploy entry.

---

## What this runbook does NOT do

- Does not contain executable deploy commands (those live in `runtime/deployment/*.ps1` and `*.sh`, Phase R4 stubs → Phase R7 real).
- Does not document tier provisioning (see `staging-bootstrap.md` for staging-tier setup).
- Does not document secret rotation (see `rotate-turso-token.md`, `rotate-credential-master-key.md` once authored).
- Does not document Caddy config changes (see Phase R3 Caddyfile runbook once authored).

---

## Canonical references

- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §3 (deployment architecture), §4 (staging strategy).
- `Migration/ARCHITECTURE_V1` §17 (deployment boundaries), §11 (phased implementation).
- `Migration/TURSO_ENVIRONMENT_SEPERATION_STRATEGY.md` §3 (migration-safe DB strategy).
- `Migration/Production Runtime Assessment.txt` §6 (current operator-driven deploy reality).
- `runtime/env/README.md` — APP_ENV semantics.
- `runtime/runbooks/staging-bootstrap.md` — initial staging provisioning.

# runtime/runbooks/

Operator procedures for staging and production: deploys, rollbacks, secret rotation, incident response, environment bootstrap.

## Status (Phase R1)

**Empty.** No runbooks yet.

## Planned runbooks (Phase R2 baseline; populated through R7)

| File | Purpose | Lands in |
|---|---|---|
| `deploy-staging.md` | Step-by-step laptop-side staging deploy procedure | Phase R2 (skeleton), R7 (real) |
| `deploy-prod.md` | Step-by-step laptop-side production deploy procedure | Phase R2 (skeleton), R7 (real) |
| `rollback.md` | Image-tag rollback procedure | Phase R8 |
| `add-secret.md` | How to add a new env var across tiers (vault, host env file, container recreate) | Phase R2 |
| `rotate-turso-token.md` | Token rotation procedure with zero-downtime steps | Phase R2 |
| `rotate-credential-master-key.md` | The riskiest rotation — requires re-encrypting every `IntegrationCredential` row | Phase R2 (placeholder), Phase F' (real implementation) |
| `new-environment-tier.md` | How to add a fourth tier (preview, ephemeral) | Phase R6+ |
| `prod-host-setup.md` | Bootstrap procedure for replacing or expanding the `superglitch` host | Phase R7 |
| `worker-incident-checklist.md` | How to diagnose the worker container; based on `Migration/DEPLOYMENT_DNS_ANALYSIS-Corrected.md` | Phase R4 |
| `turso-migrations.md` | How to apply Prisma migrations to a Turso DB via `scripts/apply-turso-migrations.mjs`; APP_ENV tier fence, dry-run, failure recovery | Phase R6.6 ✅ |
| `staging-backup-restore.md` | Staging DB + `/storage` backup requirements, checksum manifest, retention, isolated restore-drill procedure, and manual approval gates. Documentation foundation only — no backup/restore script yet. | Backup/Restore Runbook Foundation ✅ (doc); execution scripts deferred |
| `specbook-staging-validation.md` | Manual validation procedure for the Spec Book flow (upload → split → serve section PDF → delete → re-upload) against staging: exact routes, safe evidence, pass/fail criteria, rollback boundaries, what's provable while the Anthropic 401 stands, auth-posture checks, and a future versioned-key recommendation. Documentation foundation only; optional dry-run-by-default smoke helper at `scripts/specbook-staging-smoke.mjs`. | Spec Book Staging Validation ✅ (doc) |
| `staging-release-bridge.md` | Controlled rollout plan for bringing the `integration/foundation-ci-divergence` line to staging: which of app/sidecar/worker/cron actually need rebuilding (with file-path evidence), the exact rollout-layer sequence (build → pin → activate → health → readiness route → one controlled provider call → Spec Book smoke → cleanup → rollback), why the Spec Book smoke cannot double as the provider-verification step, and rollback boundaries. Documentation foundation only; no Compose/Docker/source file was modified and no live/Docker call was made while authoring it. | Staging Release Bridge ✅ (doc) |

## Runbook style guide

- Each runbook is a numbered procedure with explicit commands.
- Commands include their refusal conditions ("if X, abort; if Y, escalate").
- Each runbook ends with a verification section ("how to confirm it worked").
- Each runbook lists which env vars and which 1Password items it touches.
- Each runbook references `secrets-pointers/vault-map.md` for vault item lookups.

## What does NOT belong in runbooks

- Inline secret values.
- Operator-personal credentials.
- Long architectural narrative (those belong in `Migration/ARCHITECTURE_V1` or `docs/`).

## Canonical references

- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §7 — phase plan.
- `Migration/Production Runtime Assessment.txt` §6 — current operator-driven deploy reality (becomes the baseline that the runbooks codify).

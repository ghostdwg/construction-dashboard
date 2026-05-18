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

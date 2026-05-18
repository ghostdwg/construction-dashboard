# runtime/deployment/

Laptop-side deploy scripts that orchestrate staging and production deploys against host `superglitch`.

## Status (Phase R1)

**Empty.** No scripts yet.

## Planned contents (Phase R4 stubs → Phase R7 real)

```text
deployment/
├── deploy-staging.ps1        # Laptop → SSH → host: pull images, migrate, recreate
├── deploy-prod.ps1           # Laptop → SSH → host: snapshot, migrate, recreate
├── rollback.ps1              # Laptop → SSH → host: recreate at previous image tag
├── apply-migrations.sh       # Host-side: invokes scripts/apply-turso-migrations.mjs
├── snapshot-prod.sh          # Host-side: Turso PITR snapshot before migrate
└── health-check.sh           # Host-side: probes /api/health + /health
```

## Refusal conditions (designed in, not optional)

Every script must refuse to proceed when:

- **`deploy-staging.ps1`** — Git working tree dirty; CI not green for the target SHA; SHA not on `main`.
- **`deploy-prod.ps1`** — Same as staging plus: target SHA not currently running in staging for ≥ N hours; no `--confirm-prod` flag; `snapshot-prod.sh` failed.
- **`rollback.ps1`** — no previous image tag found.
- **`apply-migrations.sh`** — `DATABASE_URL` pattern does not match the target tier (e.g., refuses if invoked with `prod` but `DATABASE_URL` points at staging or vice versa).
- **`snapshot-prod.sh`** — Turso API unavailable.

Refusal conditions are the actual safety surface. A script that "always proceeds" is the same as no script at all.

## Current deploy process

Today, production deploys are operator-driven: SSH to `superglitch`, `git pull` into `/opt/neuroglitch/`, run `scripts/apply-turso-migrations.mjs`, `docker compose up -d --force-recreate`. There is no laptop-side automation, no rollback-by-tag, no green-staging gate. Phase R7 + R8 close those gaps.

## Canonical references

- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §3, §4 — deployment architecture and staging strategy.
- `Migration/ARCHITECTURE_V1` §17 — deployment boundaries.
- `Migration/Production Runtime Assessment.txt` §6, §17 — current deploy reality and risks.

# runtime/env/

Per-tier environment-variable templates. **Placeholders only — never real secret values.**

## Status (Phase R1)

**Empty.** No env templates yet.

## Planned contents (Phase R2)

```text
env/
├── app.dev.env.example         # Laptop dev — file:./dev.db, AUTH_DISABLED=true permitted
├── app.staging.env.example     # Staging tier — libsql://groundworx-staging-ghostdwg
├── app.prod.env.example        # Production tier — libsql://groundworx-prod-ghostdwg
├── sidecar.dev.env.example
├── sidecar.staging.env.example
├── sidecar.prod.env.example
├── worker.dev.env.example
├── worker.staging.env.example
└── worker.prod.env.example
```

Nine files: three services × three tiers.

## Strict rule: placeholders only

These templates document **what variables exist** and **what shape they should take per tier**. They never contain real values. Examples of acceptable content:

```text
DATABASE_URL=libsql://groundworx-staging-ghostdwg.turso.io?authToken=<paste-staging-token>
AUTH_SECRET=<generate-with-openssl-rand-hex-32>
ANTHROPIC_API_KEY=sk-ant-<staging-key>
```

Real values live on the consuming host:

- Laptop: `construction-dashboard/.env.local` (gitignored).
- Staging: `/opt/neuroglitch/.env.staging` on `superglitch` (host-only, never on laptop).
- Production: `/opt/neuroglitch/.env` on `superglitch` (host-only, never on laptop).

The 1Password vaults are the source of truth for the real values. See `secrets-pointers/vault-map.md` at the workspace root for the index of which vault item holds which secret per tier.

## What goes in each template

- Every env var the corresponding service reads at runtime.
- A short comment per variable: what it does, where it's used, who consumes it.
- Per-tier expected shape (e.g., `staging` expects libsql URL containing `staging`).

## What never goes in any template

- Real API keys, tokens, encryption keys, JWT secrets, or passwords — even staging or dev.
- Real Turso authTokens.
- Real `CREDENTIAL_MASTER_KEY` / `SETTINGS_ENCRYPTION_KEY` values.
- Operator-specific paths.

## Canonical references

- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §3 — env file strategy.
- `Migration/TURSO_ENVIRONMENT_SEPERATION_STRATEGY.md` — per-tier secret matrix.
- `docs/SECRET_GOVERNANCE.md` (workspace canon) — secret handling rules.
- `secrets-pointers/vault-map.md` — vault item index.

# runtime/env/

Per-tier environment-variable templates for the GroundWorX platform. **Placeholders only — never real secret values.**

## Status (Phase R2)

This folder now holds:

- `README.md` (this file) — canonical APP_ENV governance.
- `local.env.example` — laptop dev tier template.
- `staging.env.example` — staging tier template.
- `production.env.example` — production tier template.

The templates document **what variables exist** and **what shape they should take per tier**. They are NOT consumed by any running process. Each tier's real env file lives on the host that needs it:

- Laptop: `construction-dashboard/.env.local` (gitignored).
- Staging: `/opt/neuroglitch/.env.staging` on host `superglitch`.
- Production: `/opt/neuroglitch/.env` on host `superglitch`.

The 1Password vaults (`GroundWorX-dev`, `GroundWorX-staging`, `GroundWorX-prod`) are the source of truth for real values. See `secrets-pointers/vault-map.md` at the workspace root for the index of which vault item holds which secret per tier.

---

## Canonical APP_ENV semantics

`APP_ENV` is the first-class **deployment tier discriminator**, separate from `NODE_ENV`. It takes one of three values:

| Value | Meaning |
|---|---|
| `local` | Laptop development. Solo dev work, fast iteration, no network DB. |
| `staging` | Operator-controlled deploy target on the production host, isolated from prod data. The promotion-before-prod tier. |
| `production` | Live customer-facing tier. The only tier authorized to hold and serve real production data. |

`APP_ENV` is the orthogonal axis to `NODE_ENV`:

- `NODE_ENV=development` for `next dev` on the laptop. `NODE_ENV=production` for any built artifact (staging or prod).
- `APP_ENV=local` for the laptop. `APP_ENV=staging` and `APP_ENV=production` for the two deploy tiers.

Phase R5 introduces strict Zod validation in `lib/env.ts` to fence the platform against tier confusion. R2 only documents the shape; it does not enforce it. **No app code reads `APP_ENV` today.** (Verified via repo grep on `2026-05-18`.)

### Per-tier expectations

| Dimension | `local` | `staging` | `production` |
|---|---|---|---|
| **Public URL** | `http://localhost:3000` | `https://staging.groundworx.neuroglitch.ai` | `https://groundworx.neuroglitch.ai` |
| **Database** | `file:./dev.db` (laptop SQLite) | `libsql://<staging-db>.turso.io` (isolated Turso) | `libsql://<prod-db>.turso.io` (isolated Turso) |
| **DB isolation** | Single-developer file on laptop | Separate Turso DB; never reads or writes prod | Live customer data; never accessed from laptop |
| **Storage** | `construction-dashboard/uploads/` (gitignored, local FS) | `/opt/neuroglitch/storage-staging/` → `/storage` (host bind) | `/opt/neuroglitch/storage/` → `/storage` (host bind) |
| **Storage isolation** | Local filesystem only | Separate host directory; never shares with prod | Host directory; the canonical artifact store |
| **Auth behavior** | `AUTH_DISABLED=true` **permitted** (solo-dev escape hatch) | `AUTH_DISABLED=false` **enforced** | `AUTH_DISABLED=false` **enforced** |
| **`AUTH_SECRET`** | Local-only; generated on laptop | Staging-only; generated for this tier | Production-only; rotated annually |
| **`SETTINGS_ENCRYPTION_KEY`** | Local-only; optional | **Required**, staging-only | **Required**, production-only — never leaves prod vault |
| **`CREDENTIAL_MASTER_KEY`** | Local-only; optional | **Required**, staging-only | **Required**, production-only |
| **`NODE_ENV`** | `development` | `production` | `production` |
| **Compose project name** | n/a (no Compose) | `neuroglitch-staging` | `neuroglitch` |
| **Image tags** | n/a (local build) | `:<staging-sha>` | `:<prod-sha>` |
| **AI provider keys** | Low-limit dev keys or empty | Staging keys with allowlisted recipients | Prod keys |
| **`AUTH_DISABLED`** allowed value | `true` or `false` | `false` only | `false` only |
| **Visible tier indicator (UI)** | Blue stripe "DEV" (Phase R5) | Amber stripe "STAGING" (Phase R5) | Thin red stripe, no label (Phase R5) |

### Visual environment differentiation requirements (Phase R5)

Three independent surfaces so an operator cannot mistake the active tier:

1. **Server startup banner** — colored ANSI box printed once per process start. Shows `APP_ENV`, DB hostname, auth state, sidecar URL, GPU URL, build SHA. Color: blue (local), amber (staging), red (production).
2. **HTTP response header `X-App-Env`** — set on every response. Machine-readable, useful for monitoring and DevTools debugging.
3. **Browser-side indicators** — three independent expressions of `APP_ENV`:
   - Top stripe on every page (color + tier label, 2-4px).
   - Window title prefix: `[DEV]`, `[STAGING]`, or unprefixed in production.
   - Tier-specific favicon: `favicon-dev.ico`, `favicon-staging.ico`, `favicon-prod.ico`.

Drift between these surfaces is a signal of misconfiguration; an operator must investigate before acting.

---

## Strict rule: placeholders only

Templates document **what variables exist** and **what shape they should take per tier**. They never contain real values. Acceptable content:

```text
DATABASE_URL=libsql://<staging-db-name>.turso.io?authToken=<paste-from-1password>
AUTH_SECRET=<generate-with-openssl-rand-hex-32>
ANTHROPIC_API_KEY=sk-ant-<staging-key>
```

Unacceptable content:

- Real API keys, tokens, encryption keys, JWT secrets, passwords — even staging or dev.
- Real Turso authTokens.
- Real `CREDENTIAL_MASTER_KEY` / `SETTINGS_ENCRYPTION_KEY` values.
- Operator-personal paths or machine names.

The `.gitignore` carve-out `!runtime/env/*.env.example` (Phase R2) allows these placeholder files past the workspace's `.env*` block. Any file in this folder NOT matching `*.env.example` would be re-ignored.

---

## What each template covers

Each template is a **complete** env file for its tier — i.e., all env vars the corresponding tier's app, sidecar, and worker consume. Compose `env_file:` directives point at a single file per service per tier. Operators copy the template, fill in real values from 1Password, and place the result on the appropriate host.

### Variable categories present in each template

1. **Tier discriminator**: `APP_ENV`, `NODE_ENV`.
2. **Database**: `DATABASE_URL`, `DATABASE_AUTH_TOKEN`.
3. **Auth**: `AUTH_SECRET`, `AUTH_DISABLED`, `NEXTAUTH_URL`, `APP_URL`.
4. **Encryption keys**: `SETTINGS_ENCRYPTION_KEY`, `CREDENTIAL_MASTER_KEY`.
5. **Inter-service**: `SIDECAR_URL`, `SIDECAR_API_KEY`, `SIDECAR_CALLBACK_TOKEN`, `WORKER_TOKEN`.
6. **AI providers**: `ANTHROPIC_API_KEY`, `WHISPERX_URL`, `WHISPERX_API_KEY`, `OLLAMA_URL`, `OLLAMA_MODEL`, `ASSEMBLYAI_API_KEY`.
7. **Stub-mode flags**: `ADDENDUM_STUB_MODE`, `BRIEF_STUB_MODE`, `GAP_STUB_MODE`.
8. **DB-overridable settings**: documented but operator's primary path is the `/settings` UI which writes encrypted `AppSetting` rows. Examples: `RESEND_API_KEY`, `SMTP_PASSWORD`, `PROCORE_CLIENT_SECRET`, `PROCORE_WEBHOOK_SECRET`.

---

## Canonical references

- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §3 — env file lifecycle.
- `Migration/TURSO_ENVIRONMENT_SEPERATION_STRATEGY.md` §6 — APP_ENV fence design (lands in Phase R5).
- `Migration/ARCHITECTURE_V1` §12, §16 — per-tier matrix and secret inventory.
- `Migration/Production Runtime Assessment.txt` §6 — actual env keys in production today.
- `docs/SECRET_GOVERNANCE.md` (workspace canon) — secret handling rules.
- `secrets-pointers/vault-map.md` (workspace root) — vault item index per tier.

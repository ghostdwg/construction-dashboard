# runtime/ — Status

Phase R1 of `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md`.

## Authoritative status

- `runtime/` is the **future** authoritative operational substrate for GroundWorX.
- `runtime/` is **NOT** authoritative today. Production deploys continue to use:
  - `/opt/neuroglitch/docker-compose.yml` on host `superglitch` (live Compose).
  - `/opt/neuroglitch/infrastructure/caddy/Caddyfile` on host (live Caddy config).
  - `construction-dashboard/Dockerfile` + `sidecar/Dockerfile` (live image builds).
  - `construction-dashboard/fly.toml`, `fly.sidecar.toml` at repo root (dormant alt plane).
- `construction-dashboard/deploy/` and `construction-dashboard/infra/` remain **active during transition**. They are marked deprecated via `DEPRECATED.md` sentinels in each folder but are NOT removed. See `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` Phase Z for removal timing (deferred until `runtime/` is proven authoritative across staging + production).

## What Phase R1 changes

Additive only. R1 introduces:

- This subtree (`runtime/` with empty subfolders + README markers).
- `STATUS.md` (this file).
- `construction-dashboard/deploy/DEPRECATED.md`.
- `construction-dashboard/infra/DEPRECATED.md`.

That is the full extent of R1. No other files are modified.

## What Phase R1 explicitly does NOT change

- No Compose files are created or modified.
- No deployment scripts are created.
- No environment templates with real or placeholder values are created (those land in Phase R2).
- No worker entrypoint or Dockerfile is modified.
- No `fly.toml` / `fly.sidecar.toml` move occurs (those move in Phase R4).
- No production behavior changes.
- No staging activation.
- No SSH session to `superglitch`.
- No Docker invocation.
- No Git push (operator's call after review).

## Phase progression

Phase R1 is followed by:

- **R2** — author env templates (placeholders) and initial runbooks.
- **R3** — Compose split: snapshot prod Compose into `runtime/compose/base.yml`, refactor into base + per-tier overrides.
- **R4** — worker entrypoint hardening, deploy script stubs, Fly relocation to `runtime/fly/`.
- **R5** — `APP_ENV` enum + tier fences + visible environment indicator (app code change).
- **R6** — staging tier activation (operator work: provisioning, secrets, Caddy route).
- **R7** — promote `runtime/` to authoritative production deploy path.
- **R8** — GHCR image publish + image-tag rollback discipline.
- **Z** — delete `deploy/` and `infra/`.

See `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §7 for the full sequencing.

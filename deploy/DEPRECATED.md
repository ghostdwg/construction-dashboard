# deploy/ — DEPRECATED

**Status:** deprecated by Phase R1 of `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md`. Authoritative replacement: `construction-dashboard/runtime/`.

## Why deprecated

The single-repo runtime governance decision (see `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` and `Migration/ARCHITECTURE_V1`) consolidates Compose, Caddy, deployment scripts, env templates, and runbooks into a single `runtime/` subtree. This folder duplicates that intent at a smaller scale and contains files that have drifted from production reality:

| File | Status | Replacement |
|---|---|---|
| `docker-compose.yml` | **Stale** — never matched the running production Compose at `/opt/neuroglitch/docker-compose.yml`. Documented in `Migration/Production Runtime Assessment.txt`. | `runtime/compose/base.yml` + `runtime/compose/overrides/compose.prod.yml` (Phase R3, derived from the actual prod Compose) |
| `Dockerfile` | Duplicate of the repo-root `Dockerfile` with minor differences. Build context confusion risk. | Repo-root `Dockerfile` remains canonical for the app build |
| `nginx.conf` | Pre-Caddy artifact. Production has used Caddy since 2026-05-08 (see `Migration/Production Runtime Assessment.txt` §3). | `runtime/caddy/Caddyfile.prod.example` (Phase R3) |
| `.env.production.example` | Postgres-flavored example; conflicts with the libSQL/Turso production reality. | `runtime/env/app.prod.env.example` (Phase R2) |

## Not authoritative

- This folder is **not** the source of truth for any production behavior.
- Files here are preserved to avoid filesystem movement during Phase R1 (additive only) and to ease historical reference for anyone tracing prior decisions.

## Do not use

- Do not add new files to this folder.
- Do not edit existing files in this folder.
- Do not run `docker compose -f deploy/docker-compose.yml` — it does not describe what is running.
- Do not reference `deploy/.env.production.example` for actual env shape — use `runtime/env/app.prod.env.example` once Phase R2 lands.

## Removal

Removal is deferred to **Phase Z** of the workspace normalization plan, executed after `runtime/` has been authoritative for both staging and production across at least three successful deployments. Until then, this folder remains in place as an inert sentinel.

## Canonical references

- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §7 (Phase R1, Phase Z) and §8 (migration mapping).
- `Migration/ARCHITECTURE_V1` revised — single-repo runtime decision.
- `Migration/Production Runtime Assessment.txt` §1, §2 — actual production Compose topology.

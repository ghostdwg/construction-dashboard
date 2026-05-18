# runtime/compose/overrides/

Per-tier Compose overrides applied on top of `runtime/compose/base.yml`.

## Status (Phase R1)

**Empty.** No override files yet.

## Planned overrides (Phase R3)

| File | Compose project | Tier | Purpose |
|---|---|---|---|
| `compose.dev.yml` | `groundworx-dev` (laptop) | development-parity | Optional laptop parity testing; mounts `${HOME}/.groundworx/storage`, uses local image builds |
| `compose.staging.yml` | `neuroglitch-staging` | staging | Mounts `/opt/neuroglitch/storage-staging`, env_file `/opt/neuroglitch/.env.staging`, image tags `:<staging-sha>` |
| `compose.prod.yml` | `neuroglitch` | production | Mounts `/opt/neuroglitch/storage`, env_file `/opt/neuroglitch/.env`, image tags `:<prod-sha>` |

## Why per-tier overrides instead of duplicate base files

Compose merges overrides into a single rendered specification at runtime. This means:

- The **service topology** (which services exist, what they depend on, what they expose) lives once in `base.yml`.
- The **per-tier specifics** (which image tag, which volume path, which env file, which Compose project name) live in the override.
- Changing topology (adding a service, renaming a network) is a single-file edit reviewed in PR.
- Changing tier behavior (rotating an image tag, changing a storage path) is a one-line edit in the relevant override.

## What overrides must NOT contain

- Real secrets (env values themselves) — those stay in `/opt/neuroglitch/.env*` on the host, never in Git.
- Operator-personal paths — overrides describe host-canonical paths, not laptop-specific paths.

## Canonical references

- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §4 (staging strategy) and §4b (Compose override skeleton).
- `runtime/compose/README.md` — parent folder.

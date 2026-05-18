# runtime/compose/

Canonical Docker Compose definitions for the GroundWorX platform.

## Status (Phase R1)

**Empty.** This folder is structural only. No Compose files exist here yet.

## Planned contents (Phase R3)

```text
compose/
├── base.yml          # Canonical service definitions: caddy, app, sidecar, worker,
│                     # landing (+ hello, api during decommission).
│                     # No env_file, no image tags, no host bindings —
│                     # pure service topology.
│
└── overrides/
    ├── compose.dev.yml      # Laptop Compose parity testing (optional)
    ├── compose.staging.yml  # project=neuroglitch-staging, storage-staging mount,
    │                          staging env_file, staging image tags
    └── compose.prod.yml     # project=neuroglitch, storage mount, prod env_file,
                               prod image tags
```

## Compose override invocation pattern

When this folder is populated, the deployment scripts invoke Compose as:

```text
docker compose \
  -f construction-dashboard/runtime/compose/base.yml \
  -f construction-dashboard/runtime/compose/overrides/compose.<tier>.yml \
  -p neuroglitch[-staging] \
  up -d --force-recreate <services>
```

Staging (`-p neuroglitch-staging`) and production (`-p neuroglitch`) coexist on the same host with separate Compose projects, separate volumes, separate networks, separate env files, and a shared Caddy edge.

## Source of the eventual `base.yml`

Phase R3 derives `base.yml` from a snapshot of the **active** production Compose file at `/opt/neuroglitch/docker-compose.yml` on host `superglitch`. **Not** from the stale `construction-dashboard/deploy/docker-compose.yml` (which never matched prod — see `deploy/DEPRECATED.md`).

## Canonical references

- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §4 — staging strategy + Compose override pattern.
- `Migration/Production Runtime Assessment.txt` §1, §3 — current Compose topology on `superglitch`.
- `runtime/STATUS.md` — overall transition state.

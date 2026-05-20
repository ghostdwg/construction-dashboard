# runtime/compose/overrides/

Per-tier Compose overlays applied on top of `runtime/compose/base.yml`.

## Status (Phase O1.5.b)

Three overlay files committed. One is activatable today; the other two are R3 documentation placeholders pending later phases.

| File | Phase | Activatable today? | Compose project | Purpose |
|---|---|---|---|---|
| `production.yml` | R3 | **No** — literal `:<sha>` image placeholders. Awaits Phase R7 cutover (replaces the live `/opt/neuroglitch/docker-compose.yml`). | `neuroglitch` | Production tier override |
| `staging.yml` | R3 | **No** — literal `:<staging-sha>` image placeholders. Superseded by `staging.active.yml` for real deploys; preserved as documentation of the intended R3 override shape. | `neuroglitch-staging` | Staging tier placeholder (documentation only) |
| `staging.active.yml` | R6 | **Yes** — uses `${APP_SHA:?...}` env substitution. This is the file invoked by `runtime/runbooks/staging-first-activation.md`. | `neuroglitch-staging` | Staging tier (real activatable) |

## Activation file (today)

For any actual staging activation, use `staging.active.yml`:

```text
APP_SHA=<reviewed-sha> docker compose \
  -f runtime/compose/base.yml \
  -f runtime/compose/overrides/staging.active.yml \
  -p neuroglitch-staging \
  up -d --force-recreate app sidecar worker
```

The `staging.yml` placeholder is **never invoked** by any runbook or deploy script. Edits to `staging.yml` do not affect any running staging stack. (O1.5.a misrouted a worker `APP_URL` override into `staging.yml`; O1.5.b ported that override to `staging.active.yml` and removed the dead duplicate.)

## Single APP_URL authority for the worker

The `worker` service in `staging.active.yml` carries one explicit `environment.APP_URL=http://app:3000` override, so the worker routes its job-polling loop through Docker's embedded DNS within the staging Compose network rather than through the public FQDN in `/opt/neuroglitch/.env.staging`. The shared env file's `APP_URL` continues to drive the app itself (auth callback absolute URLs etc.). No other overlay sets `APP_URL` on the worker — that authority lives exclusively in `staging.active.yml`.

## Why per-tier overrides instead of duplicate base files

Compose merges overlays into a single rendered specification at runtime. This means:

- The **service topology** (which services exist, what they depend on, what they expose) lives once in `base.yml`.
- The **per-tier specifics** (image tag, env_file path, storage bind source, host port) live in the tier overlay.
- The **observability overlay** (`runtime/compose/observability.yml`) is a separate operationally-additive overlay — it adds Loki/Promtail/Prometheus/Grafana services and a second network; it does not redefine app/sidecar/worker. See `runtime/deployment/compose-governance.md` §1 and §10.

## What overrides must NOT contain

- Real secrets (env values themselves) — those stay in `/opt/neuroglitch/.env*` on the host, never in Git.
- Operator-personal paths — overrides describe host-canonical paths, not laptop-specific paths.
- Service renames, healthcheck weakening, or removal of services defined in `base.yml`. (Tier-specific exclusion is via the `up -d <service-list>` argument, never by deleting from base.)

## Canonical references

- `runtime/compose/README.md` — parent folder; full authority matrix.
- `runtime/compose/TOPOLOGY.md` — descriptive production topology.
- `runtime/deployment/compose-governance.md` — layering rules and immutable expectations.
- `runtime/runbooks/staging-first-activation.md` — operator activation procedure (uses `staging.active.yml`).
- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §4 — staging strategy.

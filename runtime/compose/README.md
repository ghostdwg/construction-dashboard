# runtime/compose/

Canonical Docker Compose definitions for the GroundWorX platform. **Reconstruction status — not yet authoritative.**

## Status

Phase R3 populated this folder with a reconstruction of the live production compose topology. Phase R4 introduces CI validation for the merged YAML.

```text
compose/
├── README.md             this file
├── TOPOLOGY.md           descriptive snapshot of current production runtime
├── base.yml              canonical service topology (RECONSTRUCTED — see warning below)
├── observability.yml     Loki/Promtail/Prometheus/Grafana overlay (O1.2, ACTIVATABLE)
└── overrides/
    ├── README.md         override invocation pattern
    ├── production.yml    R3 PLACEHOLDER — production tier override (literal <sha>; not deployable until R7)
    ├── staging.yml       R3 PLACEHOLDER — staging tier override (literal <staging-sha>; superseded by staging.active.yml)
    └── staging.active.yml R6 ACTIVATABLE — staging tier override (${APP_SHA} substitution; used by the activation runbook)
```

### File authority at a glance

| File | Phase | Activatable today? | Image syntax | Used by |
|---|---|---|---|---|
| `base.yml` | R3 | No (requires tier overlay) | — | every invocation |
| `overrides/production.yml` | R3 | No (literal `<sha>`) | `:<sha>` placeholder | pending R7 cutover |
| `overrides/staging.yml` | R3 | No (literal `<staging-sha>`) | `:<staging-sha>` placeholder | documentation only |
| `overrides/staging.active.yml` | R6 | **Yes** | `:${APP_SHA:?...}` env substitution | `runtime/runbooks/staging-first-activation.md` |
| `observability.yml` | O1.2 | **Yes** (additive overlay) | pinned versions | `runtime/runbooks/staging-activation-full.md` |

### Canonical invocations (O1.5.b)

```text
# Staging — isolated activation (Phase 6.a)
APP_SHA=<sha> docker compose \
  -f runtime/compose/base.yml \
  -f runtime/compose/overrides/staging.active.yml \
  -p neuroglitch-staging \
  up -d --force-recreate app sidecar worker

# Staging — with observability stack
APP_SHA=<sha> docker compose \
  -f runtime/compose/base.yml \
  -f runtime/compose/overrides/staging.active.yml \
  -f runtime/compose/observability.yml \
  -p neuroglitch-staging \
  up -d

# Production — pending R7 cutover; uses the placeholder file until then
docker compose \
  -f runtime/compose/base.yml \
  -f runtime/compose/overrides/production.yml \
  -p neuroglitch \
  up -d --force-recreate
```

## ⚠ Verification warning

`runtime/compose/base.yml` is a **reconstruction** of the live production compose file, derived from `Migration/Production Runtime Assessment.txt` (dated 2026-05-17). It has NOT been verified line-by-line against the actual `/opt/neuroglitch/docker-compose.yml` on host `superglitch`.

**No runtime/compose/ file is authoritative until the operator validates parity.**

Required verification before any Phase R7 cutover:

1. Render `runtime/compose/base.yml + overrides/production.yml`:
   ```text
   docker compose \
     -f runtime/compose/base.yml \
     -f runtime/compose/overrides/production.yml \
     -p neuroglitch \
     config > runtime-prod-rendered.yml
   ```
2. Render the live file:
   ```text
   docker compose -f /opt/neuroglitch/docker-compose.yml -p neuroglitch config > live-prod-rendered.yml
   ```
3. Diff:
   ```text
   diff -u live-prod-rendered.yml runtime-prod-rendered.yml
   ```
4. Reconcile any differences by updating either `runtime/compose/base.yml` or `runtime/compose/overrides/production.yml`.
5. Repeat until the diff is empty (or empty modulo intentional changes recorded in `planning/`).
6. ONLY THEN promote `runtime/compose/` to authoritative (Phase R7 cutover step).

The CI workflow `.github/workflows/runtime-compose-lint.yml` (added Phase R4) validates structural correctness of the merged YAML on every PR touching `runtime/compose/**`. It does NOT validate parity with the live host file — that requires operator action with access to `superglitch`.

## What's authoritative today (NOT in this folder)

Until the verification above is complete:

- The live production compose is `/opt/neuroglitch/docker-compose.yml` on host `superglitch`.
- The live Caddyfile is `/opt/neuroglitch/infrastructure/caddy/Caddyfile`.
- The live worker entrypoint is `/opt/neuroglitch/infrastructure/worker/entrypoint.sh`.

These three host paths drive production behavior. The corresponding in-repo files (`runtime/compose/`, `runtime/caddy/`, `runtime/worker/`) are governance artifacts pending verification.

## Override invocation pattern (when active)

```text
docker compose \
  -f runtime/compose/base.yml \
  -f runtime/compose/overrides/<tier>.yml \
  -p <project> \
  up -d [services...]
```

| Tier | Project | Override |
|---|---|---|
| Production | `-p neuroglitch` | `overrides/production.yml` |
| Staging | `-p neuroglitch-staging` | `overrides/staging.yml` |

See `runtime/deployment/compose-governance.md` for layering rules, refusal conditions, and rollback expectations.

## Canonical references

- `runtime/compose/TOPOLOGY.md` — descriptive snapshot of current production topology.
- `runtime/compose/base.yml` — service topology in YAML.
- `runtime/compose/overrides/` — per-tier overlays.
- `runtime/deployment/compose-governance.md` — governance and rules.
- `Migration/Production Runtime Assessment.txt` — authoritative description of current runtime.
- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §7 Phase R3, Phase R7 — phasing.

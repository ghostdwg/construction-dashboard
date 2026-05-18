# runtime/

In-repo operational substrate for the GroundWorX platform. Compose files, Caddy templates, worker container source, deployment scripts, environment templates, runbooks, and the dormant Fly alternate plane all live here.

## Status (Phase R1)

**Scaffolding only.** This subtree is structural — empty subfolders with README markers. No Compose definitions, no deploy scripts, no env templates, no runbooks have been authored yet. See `STATUS.md` for the explicit transition state.

The current authoritative production runtime continues to be driven by:

- `construction-dashboard/deploy/docker-compose.yml` — **stale**, never matched prod (see `deploy/DEPRECATED.md`).
- `/opt/neuroglitch/docker-compose.yml` — **actually-running** prod Compose (on host `superglitch`).
- `construction-dashboard/Dockerfile`, `construction-dashboard/sidecar/Dockerfile` — app and sidecar image builds (canonical; unchanged by R1).
- `construction-dashboard/fly.toml`, `construction-dashboard/fly.sidecar.toml` — dormant alternate plane at repo root (relocated to `runtime/fly/` in Phase R4).

Nothing in this subtree is authoritative yet. R1 only establishes the layout.

## Subtree map

```text
runtime/
├── README.md              this file
├── STATUS.md              transition state, scope of R1
├── compose/               Compose base.yml + per-tier overrides (Phase R3)
│   ├── README.md
│   └── overrides/
│       └── README.md
├── caddy/                 Caddyfile templates (Phase R3)
│   └── README.md
├── worker/                hardened curl-loop worker container (Phase R4)
│   └── README.md
├── deployment/            laptop-side deploy scripts (Phase R4 stubs, R7 real)
│   └── README.md
├── env/                   per-tier env templates, placeholders only (Phase R2)
│   └── README.md
├── runbooks/              operator procedures (Phase R2+)
│   └── README.md
└── fly/                   dormant alternate deploy plane (populated in Phase R4)
    └── README.md
```

## Canonical references

- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §1b, §7 — single-repo runtime governance plan.
- `Migration/ARCHITECTURE_V1` — overall architecture; production topology in §6.
- `Migration/Production Runtime Assessment.txt` — ground-truth inventory of what is running today.

## Single-repo decision

This subtree exists inside `construction-dashboard/` rather than in a separate `neuroglitch-runtime` repository for explicit reasons documented in `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §10 (Risks avoided + risks accepted by staying single-repo). The placeholder workspace-root `neuroglitch-runtime/` folder reserves the namespace for future extraction (Phase G'), deferred.

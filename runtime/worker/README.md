# runtime/worker/

Background-job worker container source — the curl-loop poller that drives `/api/jobs/run-due`.

## Status (Phase R4)

**Scaffold present, NOT deployed.** The hardened entrypoint and Dockerfile in this folder are the future replacement for the currently-running `neuroglitch-worker` container. Until an operator-driven deploy switches the worker over, the live container continues to use `/opt/neuroglitch/infrastructure/worker/entrypoint.sh` (off-repo, on host `superglitch`).

## Files

| File | Role |
|---|---|
| `entrypoint.sh` | Hardened shell loop with readiness gate, always-on heartbeat logging, healthcheck tick file, exponential backoff |
| `Dockerfile` | Alpine + tini + curl image, drops to non-root user, has a `HEALTHCHECK` based on the tick file |
| `README.md` | This file |

## What the scaffold fixes

Per `Migration/DEPLOYMENT_DNS_ANALYSIS-Corrected.md` (the operator-authored worker DNS analysis), the current worker has four observability/hygiene flaws:

1. **No readiness gate.** Worker enters the loop immediately on start; if the app isn't up yet, it logs a flood of DNS errors. Caused the 11-minute outage window on 2026-05-16.
2. **Silent success.** When the app returns `{"processed":0}`, the entrypoint logs nothing. The loop appears frozen in `docker logs`.
3. **No healthcheck.** `docker ps` shows "Up" even if the loop is wedged.
4. **Runs as root.** The container only forks curl; no privilege required.

This scaffold addresses all four:

| Flaw | Fix in this scaffold |
|---|---|
| No readiness gate | `entrypoint.sh` polls `${APP_URL}/api/health` up to `READINESS_MAX` times (default 60 × 5s = 5 min) before entering the loop |
| Silent success | Every iteration's response is logged with a timestamp, success or failure |
| No healthcheck | `Dockerfile` `HEALTHCHECK` checks that `/tmp/worker.tick` was touched within the last 3 minutes |
| Runs as root | `Dockerfile` `USER worker` (uid auto-assigned by Alpine `adduser -S`) |

Additionally:

- **Exponential backoff** on failures: doubles up to a 600-second cap, resets on success. Eliminates "1 DNS error per minute for 90 minutes" log spam during an outage.
- **Refuses to start** if `WORKER_TOKEN` is empty — fail fast rather than send unauthenticated requests.
- **tini** as PID 1 for proper signal handling — Docker `stop` now waits gracefully instead of SIGKILL.

## How it eventually deploys

(Not part of Phase R4 — these are downstream steps for context.)

1. **Phase R4+ (when operator approves a worker recreate window):** Replace `/opt/neuroglitch/infrastructure/worker/entrypoint.sh` with this file (or have Compose build from this Dockerfile directly via `runtime/compose/overrides/production.yml`). Single Compose `up -d --force-recreate worker` invocation.
2. **Phase R7 (full runtime cutover):** Worker image becomes part of the GHCR-tagged release alongside app and sidecar.
3. **Phase F' (eventual):** Replace the worker container entirely with an in-process scheduler in the Next.js app (DB-backed leader election). This scaffold is the bridge between today's worker and tomorrow's no-worker model.

## Build invocation (when activated)

```text
docker build -t ghcr.io/ghostdwg/groundworx-worker:<sha> runtime/worker/
```

Build context is `runtime/worker/` — the Dockerfile and entrypoint.sh.

## Run invocation (when activated, via Compose)

The Compose service definition lives in `runtime/compose/base.yml`. The image tag and env_file come from the tier override (`overrides/production.yml` or `overrides/staging.yml`). The worker's `entrypoint.sh` reads:

| Env var | Required | Default | Source |
|---|---|---|---|
| `WORKER_TOKEN` | **yes** | — | per-tier env_file (`/opt/neuroglitch/.env` or `.env.staging`) |
| `APP_URL` | no | `http://app:3000` | per-tier env_file |
| `WORKER_INTERVAL` | no | `60` (seconds) | per-tier env_file or `runtime/compose/base.yml` |
| `READINESS_MAX` | no | `60` (5 min @ 5s each) | per-tier env_file |

## Canonical references

- `Migration/DEPLOYMENT_DNS_ANALYSIS-Corrected.md` — diagnosis driving this hardening.
- `Migration/Production Runtime Assessment.txt` §3, §17 — current worker behavior.
- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` Phase R4, Phase F' — worker hardening + future replacement.
- `runtime/compose/base.yml` — where the worker service is declared.
- `runtime/deployment/compose-governance.md` §3 — immutable expectations (worker `depends_on app`).

# runtime/worker/

Background-job worker container source — the curl-loop poller that drives `/api/jobs/run-due`.

## Status (Phase R1)

**Empty.** No worker source here yet.

## Planned contents (Phase R4)

```text
worker/
├── Dockerfile          # Alpine + tini + curl base image
└── entrypoint.sh       # Hardened loop:
                        #   - readiness gate (waits for app /api/health)
                        #   - always-log heartbeat (no silent processed:0)
                        #   - healthcheck tick file
                        #   - exponential backoff on failure
                        #   - log rotation (configured at Compose level)
                        #   - non-root user
```

## Current production worker

The currently-deployed `neuroglitch-worker` container is a 50-line Alpine + tini + curl script. Its entrypoint source lives on the host at `/opt/neuroglitch/infrastructure/worker/entrypoint.sh` (NOT in this repo today). It:

- Polls `app:3000/api/jobs/run-due` every 60 seconds with `X-Worker-Token`.
- **Silences `processed:0` responses**, which obscures the worker's liveness. (See `Migration/DEPLOYMENT_DNS_ANALYSIS-Corrected.md` for the diagnosis.)
- Has no readiness gate — the historical "11-minute outage window" on 2026-05-16 was caused by the worker starting 1h41m before the app + sidecar were recreated.
- Runs as root for no functional reason.

## What Phase R4 changes

Phase R4 lands a hardened entrypoint here (per the DNS-corrected analysis Tier 1 recommendations). The change is operator-deployed as a single Compose worker recreate during a deploy window. Worker behavior at the *contract* level (POST /api/jobs/run-due every 60s with the token) is preserved exactly; only the surrounding hygiene improves.

## Eventual replacement

`Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §7 Phase F' contemplates replacing the worker container entirely with an in-process scheduler in the Next.js app (DB-backed leader election). The hardened entrypoint is the bridge between "current curl loop" and "no worker container needed." Both are valid; Tier 2 (in-process) is the eventual destination.

## Canonical references

- `Migration/DEPLOYMENT_DNS_ANALYSIS-Corrected.md` — the worker's observability flaw and the Tier 1/2/3 options.
- `Migration/WORKSPACE_NORMALIZATION_SINGLE_REPO.md` §7 Phase R4, Phase F'.
- `Migration/Production Runtime Assessment.txt` §3, §17 — current worker behavior.

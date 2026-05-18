#!/bin/sh
# ──────────────────────────────────────────────────────────────────────────────
#  runtime/worker/entrypoint.sh
#  Hardened background-job worker entrypoint (SCAFFOLD — Phase R4)
# ──────────────────────────────────────────────────────────────────────────────
#
#  STATUS: SCAFFOLD. NOT YET DEPLOYED.
#
#  The currently-deployed worker container on superglitch uses
#  /opt/neuroglitch/infrastructure/worker/entrypoint.sh — NOT this file. This
#  file is the future replacement that lands when the operator deploys the
#  hardened worker (planned Phase R4 deploy or later). Until then this script
#  is unused and inert.
#
#  Source-of-truth for the design: Migration/DEPLOYMENT_DNS_ANALYSIS-Corrected.md
#  (Tier 1 hardening). The current worker silences "processed:0" responses,
#  has no readiness gate, runs as root, and has no healthcheck. This script
#  addresses all four.
#
#  Expected env vars (set in the worker's env_file via Compose, NOT here):
#    APP_URL           Base URL of the app (default http://app:3000)
#    WORKER_TOKEN      Shared bearer secret used in X-Worker-Token header
#    WORKER_INTERVAL   Loop interval in seconds (default 60)
#    READINESS_MAX     Max readiness gate iterations (default 60 = 5 min @ 5s)
#
#  Healthcheck tick file:
#    /tmp/worker.tick     Touched at the start of each loop iteration. The
#                         container Dockerfile HEALTHCHECK checks freshness.
#
# ──────────────────────────────────────────────────────────────────────────────

set -eu

APP_URL="${APP_URL:-http://app:3000}"
WORKER_INTERVAL="${WORKER_INTERVAL:-60}"
READINESS_MAX="${READINESS_MAX:-60}"
TICK_FILE="/tmp/worker.tick"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*"; }

# ── Refuse to start without required env ─────────────────────────────────────
if [ -z "${WORKER_TOKEN:-}" ]; then
  log "FATAL: WORKER_TOKEN is not set. Refusing to start."
  log "       (This worker requires the shared secret matching the app's expectation.)"
  exit 1
fi

# ── Readiness gate ───────────────────────────────────────────────────────────
# Wait until the app responds on /api/health before entering the loop.
# Closes the 11-minute "Could not resolve host: app" outage class observed
# on 2026-05-16 (see Migration/DEPLOYMENT_DNS_ANALYSIS-Corrected.md).
log "Worker starting. APP_URL=${APP_URL}. Waiting for app readiness (max ${READINESS_MAX} attempts, 5s each)..."

attempts=0
until curl -sf -m 3 "${APP_URL}/api/health" >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "${attempts}" -gt "${READINESS_MAX}" ]; then
    log "FATAL: app never came up after ${READINESS_MAX} attempts. Exiting; restart policy will retry."
    exit 1
  fi
  sleep 5
done

log "App is ready after ${attempts} readiness probe(s). Entering work loop."

# ── Main loop ────────────────────────────────────────────────────────────────
# Behavior:
#  - Touch tick file at the start of every iteration (healthcheck signal).
#  - Always log the response (no silent processed:0; see DNS analysis).
#  - On error, exponential backoff up to a cap; reset on success.

interval="${WORKER_INTERVAL}"
backoff_cap=600  # 10 minutes max backoff
consecutive_failures=0

while true; do
  touch "${TICK_FILE}"
  out=$(curl -sS -m 1700 -X POST \
              -H "X-Worker-Token: ${WORKER_TOKEN}" \
              "${APP_URL}/api/jobs/run-due" 2>&1) \
    || out="{\"error\":\"curl_failed\",\"exit\":$?}"

  log "${out}"

  case "${out}" in
    *'"error"'*)
      consecutive_failures=$((consecutive_failures + 1))
      # Exponential backoff: WORKER_INTERVAL, 2x, 4x, ..., capped.
      backoff=$((WORKER_INTERVAL * (1 << (consecutive_failures - 1))))
      if [ "${backoff}" -gt "${backoff_cap}" ]; then
        backoff="${backoff_cap}"
      fi
      log "Failure #${consecutive_failures} — backing off ${backoff}s before next attempt."
      interval="${backoff}"
      ;;
    *)
      if [ "${consecutive_failures}" -gt 0 ]; then
        log "Recovered after ${consecutive_failures} failure(s). Resuming normal interval."
      fi
      consecutive_failures=0
      interval="${WORKER_INTERVAL}"
      ;;
  esac

  sleep "${interval}"
done

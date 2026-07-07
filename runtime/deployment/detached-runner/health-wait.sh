#!/usr/bin/env bash
# runtime/deployment/detached-runner/health-wait.sh
#
# Shared bounded health-wait helper for future GWX app-only deploy packets.
# Fixes the concrete bug found in GWX-Q03.4's audit
# (/tmp/gwx-ssh-release-reliability-audit.md §3a): every existing deploy
# script read container health immediately after `docker compose up -d
# --force-recreate`, with no wait loop — given this repo's Dockerfile
# HEALTHCHECK (start-period=30s, interval=30s, retries=3), that read is
# guaranteed to show "starting", not "healthy", on essentially every run.
#
# DEFAULT TIMEOUT, justified (not guessed): Dockerfile:83 declares
# `--interval=30s --timeout=10s --start-period=30s --retries=3`. A
# container that becomes genuinely ready right at the end of its
# start-period can take up to start-period + one more interval before its
# FIRST successful probe lands (30s + 30s = 60s best-realistic-case); to
# also cover the case where it's borderline/flapping before settling,
# this helper waits up to start-period + (interval × retries) = 30 + 90 =
# 120s, plus a 10s buffer = 130s, before declaring a real timeout.
#
# Never prints rendered Compose config, env values, secrets, or cookies —
# only image tags, health-state strings, and HTTP status codes.
#
# Usable two ways:
#   1. Sourced:   source health-wait.sh; wait_for_healthy "$CONTAINER"
#   2. Standalone: health-wait.sh <container> [timeout_s] [interval_s]

set -uo pipefail

HEALTH_WAIT_DEFAULT_TIMEOUT=130
HEALTH_WAIT_DEFAULT_INTERVAL=5

wait_for_healthy() {
  local container="$1"
  local timeout="${2:-$HEALTH_WAIT_DEFAULT_TIMEOUT}"
  local interval="${3:-$HEALTH_WAIT_DEFAULT_INTERVAL}"
  local deadline=$(( $(date +%s) + timeout ))

  while true; do
    local status
    status=$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || echo "unknown")
    case "$status" in
      healthy)
        echo "HEALTH: healthy (container=$container)"
        return 0
        ;;
      unhealthy)
        echo "HEALTH: FAIL — unhealthy (container=$container)"
        return 1
        ;;
    esac
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "HEALTH: FAIL — still '$status' after ${timeout}s (container=$container)"
      return 1
    fi
    sleep "$interval"
  done
}

check_image() {
  local container="$1" expected="$2"
  local actual
  actual=$(docker inspect --format '{{.Config.Image}}' "$container" 2>/dev/null || echo "unknown")
  if [ "$actual" = "$expected" ]; then
    echo "IMAGE: PASS ($actual)"
    return 0
  fi
  echo "IMAGE: FAIL — expected $expected, got $actual"
  return 1
}

check_internal_health() {
  local container="$1"
  local code
  code=$(docker exec "$container" curl -sf -o /dev/null -w '%{http_code}' http://localhost:3000/api/health 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    echo "INTERNAL_HEALTH: PASS (200)"
    return 0
  fi
  echo "INTERNAL_HEALTH: FAIL ($code)"
  return 1
}

check_public_health() {
  # Bounded retry, not a single immediate curl — a fresh container's edge
  # path may need a moment even after the container itself is healthy.
  local url="$1"
  local attempts="${2:-3}"
  local delay="${3:-5}"
  local i code
  for i in $(seq 1 "$attempts"); do
    code=$(curl -sf -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
      echo "PUBLIC_HEALTH: PASS (200, attempt $i/$attempts)"
      return 0
    fi
    [ "$i" -lt "$attempts" ] && sleep "$delay"
  done
  echo "PUBLIC_HEALTH: FAIL (last=$code after $attempts attempts)"
  return 1
}

check_smoke_mode_unset() {
  local container="$1"
  if docker exec "$container" sh -c '[ -z "${STORAGE_SMOKE_MODE_ENABLED+x}" ]' 2>/dev/null; then
    echo "SMOKE_MODE: PASS (unset)"
    return 0
  fi
  echo "SMOKE_MODE: FAIL — set (unexpected)"
  return 1
}

prove_deploy() {
  # Runs every check above in sequence; returns nonzero if any fail.
  # Usage: prove_deploy <container> <expected_image> <public_health_url>
  local container="$1" expected_image="$2" public_url="$3"
  local rc=0
  wait_for_healthy "$container" || rc=1
  check_image "$container" "$expected_image" || rc=1
  check_internal_health "$container" || rc=1
  check_public_health "$public_url" || rc=1
  check_smoke_mode_unset "$container" || rc=1
  return "$rc"
}

# Standalone CLI usage: only runs wait_for_healthy (the specific bug this
# helper fixes) when invoked directly rather than sourced — callers that
# want the full prove_deploy sequence should source this file and call it
# themselves with their own image tag / public URL.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  [ $# -ge 1 ] || { echo "Usage: $0 <container> [timeout_s] [interval_s]" >&2; exit 2; }
  wait_for_healthy "$@"
fi

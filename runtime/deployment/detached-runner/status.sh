#!/usr/bin/env bash
# runtime/deployment/detached-runner/status.sh
#
# Read-only. Never writes, never touches Docker/Compose/tmux state. Takes
# explicit paths (printed by run-detached.sh at launch) rather than looking
# things up by name in a shared registry — deliberately, to avoid needing
# any predictable shared /tmp path that a status-lookup mechanism would
# otherwise depend on.
#
# Usage:
#   status.sh <status-file>                 # show current + full history
#   status.sh --logs <log-file> [--tail N]  # tail the log (default N=50)

set -euo pipefail

if [ "${1:-}" = "--logs" ]; then
  LOG_FILE="${2:?Usage: $0 --logs <log-file> [--tail N]}"
  TAIL_N=50
  if [ "${3:-}" = "--tail" ]; then
    TAIL_N="${4:-50}"
  fi
  [ -r "$LOG_FILE" ] || { echo "FAIL: cannot read $LOG_FILE"; exit 1; }
  tail -n "$TAIL_N" "$LOG_FILE"
  exit 0
fi

STATUS_FILE="${1:?Usage: $0 <status-file>}"
[ -r "$STATUS_FILE" ] || { echo "FAIL: cannot read $STATUS_FILE"; exit 1; }

echo "=== Full status history ==="
cat "$STATUS_FILE"
echo ""
echo "=== Current state ==="
tail -n 1 "$STATUS_FILE"

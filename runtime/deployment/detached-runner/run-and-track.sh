#!/usr/bin/env bash
# runtime/deployment/detached-runner/run-and-track.sh
#
# Internal helper — invoked by run-detached.sh inside the tmux pane. Not
# meant to be run directly by an operator. Executes the target script with
# its stdout/stderr tee'd to the log file, and guarantees EXIT/INT/TERM/HUP
# all leave a terminal PASS or FAIL line in the status file — never leaves
# it stuck at RUNNING.
#
# Usage (as invoked by run-detached.sh):
#   run-and-track.sh <status-file> <log-file> <target-script> [target-args...]

set -uo pipefail
# Deliberately NOT `set -e` here — this wrapper needs to observe the exact
# exit code of the target script itself (via $?) to write an accurate
# PASS/FAIL line, not bail early on the first nonzero from something else.

STATUS_FILE="$1"
LOG_FILE="$2"
TARGET="$3"
shift 3

exec > >(tee -a "$LOG_FILE") 2>&1

write_status() {
  # $1=state $2=exit-code(optional) $3=phase(optional)
  printf 'STATE=%s TS=%s SCRIPT=%s EXIT=%s PHASE=%s\n' \
    "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$TARGET")" "${2:-}" "${3:-unknown}" \
    >> "$STATUS_FILE"
}

finalize() {
  local ec=$?
  trap - EXIT
  if [ "$ec" -eq 0 ]; then
    write_status PASS "$ec" complete
  else
    write_status FAIL "$ec" complete
  fi
}
trap finalize EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

write_status RUNNING "" launch
echo "[run-and-track] launching: $TARGET $*"
echo "[run-and-track] log file: $LOG_FILE"
echo "[run-and-track] status file: $STATUS_FILE"
echo ""

bash "$TARGET" "$@"

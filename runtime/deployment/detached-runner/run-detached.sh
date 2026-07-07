#!/usr/bin/env bash
# runtime/deployment/detached-runner/run-detached.sh
#
# GWX-Q03.4 — launches a noninteractive deploy script inside a detached tmux
# session so a browser/SSH disconnect cannot kill the job or lose its
# output. Does not itself deploy anything — it is a wrapper around whatever
# target script the operator points it at (e.g. one of the /tmp qXX-*.sh
# packets from prior GWX rounds, or a future runtime/deployment script).
#
# WHY THIS EXISTS: GWX-Q03.4's audit
# (/tmp/gwx-ssh-release-reliability-audit.md) found every existing deploy
# script runs entirely in the foreground of whatever session invokes it,
# with no durable log/status and at least one blocking `read` mid-script —
# so a dropped session loses all progress information and leaves the
# operator unable to tell whether a job finished, failed, or is still
# running.
#
# CONTRACT:
#   - Target script MUST be noninteractive (no unmarked `read` gates) unless
#     launched with --interactive --attach, in which case it runs ATTACHED
#     (a human is present) rather than detached — a truly detached session
#     with an unanswered prompt helps no one.
#   - Never prints the target script's own output to this command's stdout.
#     Everything the target script prints goes only into the log file
#     inside the tmux pane. This command's own stdout is limited to the
#     session name, PID, log path, status path, and reconnect commands.
#   - Log and status files are created via `mktemp` (random suffix, never a
#     predictable path) and chmod'd 600 immediately.
#   - Refuses to launch a target script whose source contains an obvious
#     secret-printing pattern (bare `printenv`, `cat .env*`, `env` with no
#     args), mirroring .claude/hooks/gwx-guard.mjs's philosophy for this
#     repo's other tooling — defense in depth, not a replacement for the
#     target script's own discipline.
#
# USAGE:
#   run-detached.sh <target-script> [target-args...]
#   run-detached.sh --interactive --attach <target-script> [target-args...]
#
# This script does not run docker, compose, or any deploy command itself —
# it only launches whatever target script the operator names, inside tmux.

set -euo pipefail

INTERACTIVE=0
ATTACH=0

while [ $# -gt 0 ]; do
  case "$1" in
    --interactive) INTERACTIVE=1; shift ;;
    --attach) ATTACH=1; shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done

if [ $# -lt 1 ]; then
  echo "Usage: $0 [--interactive --attach] <target-script> [target-args...]" >&2
  exit 2
fi

TARGET="$1"
shift
TARGET_ARGS=("$@")

command -v tmux >/dev/null 2>&1 || { echo "FAIL: tmux is required and was not found"; exit 1; }
[ -f "$TARGET" ] && [ -r "$TARGET" ] || { echo "FAIL: target script not found/readable: $TARGET"; exit 1; }

echo "== Pre-flight: interactive-read scan =="
# Best-effort static scan: a `read` builtin call, not preceded by the
# explicit acknowledgment marker on the immediately preceding non-blank
# line. This cannot parse arbitrary shell perfectly — it is a guard, not a
# proof — but it catches every pattern used by this repo's own scripts to
# date (bare `read -r ...`, `read -r -p ...`).
UNMARKED_READS=$(awk '
  /^[[:space:]]*#/ { last_marker = ($0 ~ /detached-runner:interactive-ok/) ? 1 : 0; next }
  /^[[:space:]]*$/ { next }
  /^[[:space:]]*read[[:space:]]/ {
    if (!last_marker) print NR": "$0
    last_marker = 0
    next
  }
  { last_marker = 0 }
' "$TARGET")

if [ -n "$UNMARKED_READS" ]; then
  if [ "$INTERACTIVE" -eq 1 ] && [ "$ATTACH" -eq 1 ]; then
    echo "NOTE: target script has interactive read gate(s); proceeding ATTACHED per --interactive --attach:"
    echo "$UNMARKED_READS"
  else
    echo "FAIL: target script contains unmarked interactive read gate(s) — refusing detached launch:" >&2
    echo "$UNMARKED_READS" >&2
    echo "" >&2
    echo "If this script is genuinely meant to be interactive, run it directly (not through this tool)," >&2
    echo "or re-run this command with --interactive --attach to launch it ATTACHED instead of detached." >&2
    exit 1
  fi
else
  echo "OK: no unmarked interactive read gates found"
fi

echo "== Pre-flight: secret-printing pattern scan =="
DANGEROUS_PATTERNS=$(grep -nE '(^|[^A-Za-z0-9_])(printenv|env)([[:space:]]*($|\|)|[[:space:]]+[A-Za-z_]+[[:space:]]*$)|cat[[:space:]]+[^|;&]*\.env(\.|$|[[:space:]])' "$TARGET" || true)
if [ -n "$DANGEROUS_PATTERNS" ]; then
  echo "FAIL: target script contains a pattern that could print secret values — refusing to launch:" >&2
  echo "$DANGEROUS_PATTERNS" >&2
  exit 1
fi
echo "OK: no obvious secret-printing pattern found (best-effort scan, not a guarantee)"

SESSION="gwx-deploy-$(basename "$TARGET" .sh)-$(date +%s)-$$"
SESSION="${SESSION//[^A-Za-z0-9_-]/-}"

LOG_FILE=$(mktemp /tmp/gwx-detached-XXXXXX.log)
STATUS_FILE=$(mktemp /tmp/gwx-detached-XXXXXX.status)
chmod 600 "$LOG_FILE" "$STATUS_FILE"

printf 'STATE=PENDING TS=%s SCRIPT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$TARGET")" >> "$STATUS_FILE"

RUNNER_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-and-track.sh"
[ -f "$RUNNER_LIB" ] || { echo "FAIL: missing $RUNNER_LIB"; exit 1; }

if [ "$INTERACTIVE" -eq 1 ] && [ "$ATTACH" -eq 1 ]; then
  echo "== Launching ATTACHED (interactive) — you will be dropped into the session now =="
  exec tmux new-session -s "$SESSION" \
    "bash '$RUNNER_LIB' '$STATUS_FILE' '$LOG_FILE' '$TARGET' ${TARGET_ARGS[*]@Q}"
fi

tmux new-session -d -s "$SESSION" \
  "bash '$RUNNER_LIB' '$STATUS_FILE' '$LOG_FILE' '$TARGET' ${TARGET_ARGS[*]@Q}"
tmux set-window-option -t "$SESSION" remain-on-exit on >/dev/null

PANE_PID=$(tmux list-panes -t "$SESSION" -F '#{pane_pid}' 2>/dev/null || echo "unavailable")

echo ""
echo "================================================================"
echo "DETACHED — session launched. Nothing above this line is target-script output."
echo "  session name : $SESSION"
echo "  pane PID     : $PANE_PID"
echo "  log path     : $LOG_FILE"
echo "  status path  : $STATUS_FILE"
echo ""
echo "  reconnect    : tmux attach -t $SESSION"
echo "  check status : bash '$(dirname "$RUNNER_LIB")/status.sh' '$STATUS_FILE'"
echo "  tail log     : bash '$(dirname "$RUNNER_LIB")/status.sh' --logs '$LOG_FILE'"
echo "================================================================"

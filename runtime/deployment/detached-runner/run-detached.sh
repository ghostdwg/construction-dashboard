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
#   - Log/status/launcher files are created via `mktemp` (random suffix,
#     never a predictable path) and chmod'd 600/700 immediately.
#   - The target is NEVER invoked through shell string interpolation of
#     operator-supplied paths/args. A mktemp launcher file (fixed-charset
#     path) is generated with `printf %q` argv quoting and executed by bash;
#     the only string tmux's `sh -c` ever parses is `bash <mktemp-path>`.
#   - Refuses to launch a target script whose source contains an obvious
#     secret-printing pattern (bare `printenv`, `cat .env*`, `env` with no
#     args), mirroring .claude/hooks/gwx-guard.mjs's philosophy for this
#     repo's other tooling — defense in depth, not a replacement for the
#     target script's own discipline.
#
# USAGE:
#   run-detached.sh <target-script> [target-args...]
#   run-detached.sh --interactive --attach <target-script> [target-args...]
#   run-detached.sh --scan-only <target-script>       # scans, exits 0/1, no launch
#   run-detached.sh --dry-run <target-script> [args]  # scans + generates launcher,
#                                                     # prints it, NO tmux, no run
#
# This script does not run docker, compose, or any deploy command itself —
# it only launches whatever target script the operator names, inside tmux.

set -euo pipefail

INTERACTIVE=0
ATTACH=0
SCAN_ONLY=0
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --interactive) INTERACTIVE=1; shift ;;
    --attach) ATTACH=1; shift ;;
    --scan-only) SCAN_ONLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done

if [ $# -lt 1 ]; then
  echo "Usage: $0 [--interactive --attach|--scan-only|--dry-run] <target-script> [target-args...]" >&2
  exit 2
fi

TARGET="$1"
shift
TARGET_ARGS=("$@")

if [ "$SCAN_ONLY" -eq 0 ] && [ "$DRY_RUN" -eq 0 ]; then
  command -v tmux >/dev/null 2>&1 || { echo "FAIL: tmux is required and was not found"; exit 1; }
fi
[ -f "$TARGET" ] && [ -r "$TARGET" ] || { echo "FAIL: target script not found/readable: $TARGET"; exit 1; }

echo "== Pre-flight: interactive-read scan =="
# Static scan for interactive `read` invocations in COMMAND POSITION. Each
# line is split into command segments on ; | & && || ( ) and backticks, then
# each segment's leading VAR=value assignments and wrapper words (if, while,
# until, elif, then, do, else, !, {, time, builtin, command, exec, sudo) are
# skipped; if the next word is exactly `read`, the line is flagged. This
# catches: bare `read`; `read foo`; `read -r foo`; `IFS= read -r foo`;
# `builtin read foo`; `command read foo`; `do_thing; read foo`;
# `do_thing && read foo`; `do_thing || read foo`; `if read foo`;
# `while read foo; do`; `x | read foo`; `(read foo)`.
# HONEST BOUNDARY (also in README): this is a guard, not a shell parser.
# It does NOT see `read` inside strings passed to `sh -c`/`bash -c`, inside
# `eval`, or inside files the target `source`s; and text like "; read x"
# INSIDE a quoted string can false-positive (fail-closed direction).
# The per-line escape hatch is a `# detached-runner:interactive-ok` comment
# on the immediately preceding line.
UNMARKED_READS=$(awk '
  /^[[:space:]]*#/ { last_marker = ($0 ~ /detached-runner:interactive-ok/) ? 1 : 0; next }
  /^[[:space:]]*$/ { next }
  {
    line = $0
    gsub(/&&|\|\||[;|&()`]/, "\n", line)
    n = split(line, segs, "\n")
    flagged = 0
    for (i = 1; i <= n; i++) {
      m = split(segs[i], w, /[ \t]+/)
      j = 1
      while (j <= m && (w[j] == "" || \
             w[j] ~ /^[A-Za-z_][A-Za-z0-9_]*=/ || \
             w[j] == "if" || w[j] == "while" || w[j] == "until" || \
             w[j] == "elif" || w[j] == "then" || w[j] == "do" || \
             w[j] == "else" || w[j] == "!" || w[j] == "{" || \
             w[j] == "time" || w[j] == "builtin" || w[j] == "command" || \
             w[j] == "exec" || w[j] == "sudo")) j++
      if (j <= m && w[j] == "read") flagged = 1
    }
    if (flagged && !last_marker) print NR": "$0
    last_marker = 0
  }
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
# Flags actual secret-DISCLOSURE commands, not mere filename references:
#   - bare `env`/`printenv` dumps (word-boundary, `/`-preceded excluded so
#     `/usr/bin/env <interpreter>` invocations don't false-positive) and the
#     explicit `/usr/bin/env` dump form (shebangs are comments — never
#     scanned);
#   - `cat` of a DOTFILE env path — a basename that STARTS with `.env`
#     (`.env`, `.env.staging`, `/opt/…/.env.local`), quoted or not,
#     immediate or later argument. Filenames merely ENDING in `.env`
#     (generated artifacts like `q03.2b-baseline-images.env`) are NOT
#     secret files and are NOT flagged;
#   - `cat` of a variable the script statically assigned to a dotfile env
#     path earlier (e.g. `ENV_FILE=/opt/…/.env.staging` … `cat "$ENV_FILE"`).
# NOT flagged (safe references): comment lines (incl. shebang); plain
# assignments; `source`/`--env-file`/`test -r`/`grep -q` uses of such a
# variable (they do not print the file); log/status filenames ending
# in `.env`. Boundary: `grep`-based dumping and dynamically built paths are
# not detected — best-effort guard, not a guarantee (see README).
DANGEROUS_PATTERNS=$(awk '
  /^[[:space:]]*#/ { next }
  {
    if (match($0, /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=["'\'']?(\/[^"'\''[:space:]]*\/)?\.env[A-Za-z0-9_.-]*["'\'']?[[:space:]]*$/)) {
      v = $0; sub(/^[[:space:]]+/, "", v); sub(/=.*$/, "", v); envvar[v] = 1; next
    }
    flagged = 0
    # command-position predecessors only (^ ; | & ( ` or whitespace) — a
    # token merely ENDING in ".env"/"env" (e.g. baseline-images.env) is a
    # filename, not a dump command, and must not match.
    if ($0 ~ /(^|[;|&(`[:space:]])(printenv|env)([[:space:]]*($|\|)|[[:space:]]+[A-Za-z_]+[[:space:]]*$)/) flagged = 1
    if ($0 ~ /(^|[[:space:]])\/usr\/bin\/env([[:space:]]*($|\|)|[[:space:]]+[A-Za-z_]+[[:space:]]*$)/) flagged = 1
    if ($0 ~ /(^|[^A-Za-z0-9_])cat[[:space:]]+["'\'']?\.env(\.|[[:space:]"'\'']|$)/) flagged = 1
    if ($0 ~ /(^|[^A-Za-z0-9_])cat[[:space:]]+[^|;&]*[\/"'\''[:space:]]\.env(\.|[[:space:]"'\'']|$)/) flagged = 1
    if (!flagged && $0 ~ /(^|[^A-Za-z0-9_])cat[[:space:]]/) {
      for (v in envvar) {
        if (index($0, "$" v) > 0 || index($0, "${" v "}") > 0) flagged = 1
      }
    }
    if (flagged) print NR": "$0
  }
' "$TARGET")
if [ -n "$DANGEROUS_PATTERNS" ]; then
  echo "FAIL: target script contains a pattern that could print secret values — refusing to launch:" >&2
  echo "$DANGEROUS_PATTERNS" >&2
  exit 1
fi
echo "OK: no obvious secret-printing pattern found (best-effort scan, not a guarantee)"

if [ "$SCAN_ONLY" -eq 1 ]; then
  echo "SCAN-ONLY: scans passed; nothing launched."
  exit 0
fi

SESSION="gwx-deploy-$(basename "$TARGET" .sh)-$(date +%s)-$$"
SESSION="${SESSION//[^A-Za-z0-9_-]/-}"

LOG_FILE=$(mktemp /tmp/gwx-detached-XXXXXX.log)
STATUS_FILE=$(mktemp /tmp/gwx-detached-XXXXXX.status)
chmod 600 "$LOG_FILE" "$STATUS_FILE"

printf 'STATE=PENDING TS=%s SCRIPT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$TARGET")" >> "$STATUS_FILE"

RUNNER_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-and-track.sh"
[ -f "$RUNNER_LIB" ] || { echo "FAIL: missing $RUNNER_LIB"; exit 1; }

# Launcher file: the ONLY thing tmux's `sh -c` ever parses is
# `bash <mktemp-path>` (fixed charset). All operator-supplied paths/args are
# written into this bash-executed file via `printf %q` — paths with spaces,
# quotes, shell metacharacters, or command-substitution-looking text execute
# literally as single argv words. No eval anywhere.
LAUNCHER=$(mktemp /tmp/gwx-detached-XXXXXX.launch)
chmod 700 "$LAUNCHER"
{
  printf '#!/usr/bin/env bash\n'
  printf '# generated by run-detached.sh — self-deletes on start\n'
  printf 'rm -f -- "$0"\n'
  printf 'exec bash'
  printf ' %q' "$RUNNER_LIB" "$STATUS_FILE" "$LOG_FILE" "$TARGET" ${TARGET_ARGS[@]+"${TARGET_ARGS[@]}"}
  printf '\n'
} > "$LAUNCHER"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "DRY-RUN: launcher generated, NOTHING launched (no tmux)."
  echo "  launcher path : $LAUNCHER"
  echo "  launcher body :"
  sed 's/^/    | /' "$LAUNCHER"
  echo "  (launcher retained for inspection — it self-deletes only if executed; remove with: rm -f $LAUNCHER)"
  exit 0
fi

if [ "$INTERACTIVE" -eq 1 ] && [ "$ATTACH" -eq 1 ]; then
  echo "== Launching ATTACHED (interactive) — you will be dropped into the session now =="
  exec tmux new-session -s "$SESSION" "bash $LAUNCHER"
fi

# remain-on-exit BEFORE the target starts (no fast-exit race): create the
# session running an idle shell (cannot exit on its own), set the window
# option, then respawn the pane onto the real command — by the time the
# target script can exit, remain-on-exit is already in force.
tmux new-session -d -s "$SESSION"
tmux set-window-option -t "$SESSION" remain-on-exit on >/dev/null
tmux respawn-pane -k -t "$SESSION" "bash $LAUNCHER"

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

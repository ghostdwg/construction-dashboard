# Detached Deploy Runner (GWX-Q03.4)

Operator tooling that runs a noninteractive deploy script inside a detached
`tmux` session with a durable log and status file, so a dropped browser/SSH
session cannot lose the job or make a healthy deploy falsely look failed.
Written in response to `/tmp/gwx-ssh-release-reliability-audit.md`.

**This does not replace, modify, or wrap any existing historical GWX
deploy/smoke script** (`q03.1-pdfjs-deploy.sh`, `q03.2b-admin-ai-deploy.sh`,
the smoke wrappers, or anything under `runtime/deployment/`'s existing six
stub scripts). Those are untouched. This is new infrastructure for **future**
deploy packets to opt into.

## Files

- `run-detached.sh` — launcher. Validates the target script, then starts it
  inside a detached tmux session.
- `run-and-track.sh` — internal helper invoked inside the tmux pane; not
  meant to be run directly. Handles logging and guarantees a terminal
  PASS/FAIL status line regardless of how the target script exits.
- `health-wait.sh` — shared bounded health-wait helper library (sourceable)
  fixing the immediate-health-check-false-negative bug found in the audit.
- `status.sh` — read-only status/log inspection.

## Noninteractive contract

`run-detached.sh` statically scans the target script for `read` calls before
launching. A `read` not immediately preceded by the comment
`# detached-runner:interactive-ok` on its own line causes a refusal — the
script will not be launched detached. This is deliberate: a prompt inside an
unattended detached session helps no one, since nobody is there to answer
it. If a script genuinely needs interactive input, run it directly (outside
this tool) or launch it with `--interactive --attach`, which runs it
**attached** — you are dropped straight into the tmux session instead of it
running in the background — so you're present for any prompt. Historical
scripts with `read -r -p` confirmation gates (the smoke wrappers) are
correctly outside this tool's default path for exactly this reason; keep
interactive confirmations and cookie entry (`--cookie-prompt`) in their own,
separately-run smoke workflows, not inside a future detached deploy script.

The scanner also refuses to launch a target script containing an obvious
secret-printing pattern (bare `printenv`, bare `env`, `cat` on a `.env*`
file) — defense in depth, mirroring `.claude/hooks/gwx-guard.mjs`'s
philosophy for this repo's other tooling. It is a best-effort static guard,
not a guarantee that a launched script is silent about secrets — that
remains the target script's own responsibility (as it always has been for
every packet this session produced: `config -q`/`config --images` only,
never a bare rendered `config` dump; `--cookie-prompt` for credential entry,
never a literal `--cookie` value).

## Runbook

### Launch

```
bash runtime/deployment/detached-runner/run-detached.sh /tmp/some-future-deploy.sh
```
Prints, and only prints: session name, pane PID (if available), log path,
status path, and the reconnect/status commands below. Nothing about the
target script's own progress appears here — that's all inside the tmux pane
and the log file.

### Reconnect (after a browser/SSH disconnect)

```
tmux attach -t <session-name>
```
The tmux server is a host process independent of any particular SSH/browser
connection — it keeps running regardless of what killed your client session.
`remain-on-exit` is set on the window, so even if the target script already
finished before you reconnect, the pane's final output is still there to
scroll back through, not auto-closed.

### Inspect final state without reconnecting

```
bash runtime/deployment/detached-runner/status.sh <status-file>
bash runtime/deployment/detached-runner/status.sh --logs <log-file> [--tail N]
```
Status file lines look like:
```
STATE=PENDING TS=2026-07-08T09:00:00Z SCRIPT=some-future-deploy.sh
STATE=RUNNING TS=2026-07-08T09:00:01Z SCRIPT=some-future-deploy.sh EXIT= PHASE=launch
STATE=PASS TS=2026-07-08T09:04:12Z SCRIPT=some-future-deploy.sh EXIT=0 PHASE=complete
```
`PASS`/`FAIL` is guaranteed to appear eventually — `run-and-track.sh` traps
`EXIT`, `HUP`, `INT`, and `TERM` so the target script finishing, crashing,
or being killed by any of those signals all funnel through the same
finalization path and write a terminal state. It can never be left stuck at
`RUNNING` by a signal the target script (or its parent tmux pane) receives.

Fine-grained `PHASE` values beyond `launch`/`complete` require the target
script itself to opt in by emitting its own status lines (append `STATE=...
PHASE=<name>` to the status file passed to it) — this is optional for future
scripts to adopt and is not retrofitted onto anything historical.

### Escalation / rollback decision point

If `status.sh` shows `FAIL`, or the session is gone with no terminal state
(should not happen given the trap coverage above, but if `tmux ls` no longer
lists the session and the status file's last line is still `RUNNING`, treat
that combination itself as a FAIL signal) — do not re-run the deploy script
blind. Read the log via `status.sh --logs`, confirm current live container
state directly (`docker inspect`/`docker compose ps`, same as every prior
GWX packet's post-deploy proof section), and only then decide: fix-forward
(re-run after correcting whatever failed) or roll back via that packet's own
rollback script. This tool does not make that decision for you — it only
ensures you have the evidence to make it.

## Adoption

Future app-only deploy packets should:
1. Launch through `run-detached.sh` instead of running directly in the
   foreground.
2. `source health-wait.sh` and call `wait_for_healthy`/`prove_deploy`
   instead of an immediate single `docker inspect` health read.
3. Keep any interactive step (confirmations, `--cookie-prompt`) in a
   separate script run on its own, not inside the detached path.

## Known limitation

`run-and-track.sh` redirects output via `exec > >(tee -a "$LOG_FILE") 2>&1`
(process substitution). Status-file writes go through a direct `>>` append,
not through that redirected stream, so status reporting is unaffected by
this — but in rare cases across bash versions, the very last lines of the
*log* file can be written slightly after the process substitution's writer
finishes flushing relative to the script's own exit. The status file is
always the authoritative source for PASS/FAIL/exit code; the log is for
human-readable detail.

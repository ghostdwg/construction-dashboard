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

`run-detached.sh` statically scans the target script for `read` invocations
in COMMAND POSITION before launching. Lines are split into command segments
on `;`, `|`, `&`, `&&`, `||`, `(`, `)`, and backticks; leading `VAR=value`
assignments and wrapper words (`if`, `while`, `until`, `elif`, `then`, `do`,
`else`, `!`, `{`, `time`, `builtin`, `command`, `exec`, `sudo`) are skipped;
if the next word is exactly `read`, the line is flagged. This catches, at
minimum: bare `read`; `read foo`; `read -r foo`; `IFS= read -r foo`;
`builtin read foo`; `command read foo`; `do_thing; read foo`;
`do_thing && read foo`; `do_thing || read foo`; `if read foo; then`;
`while read foo; do`; `x | read foo`; `(read foo)`.

**Honest boundary — this is a guard, not a shell parser.** It does NOT see
`read` inside strings handed to `sh -c`/`bash -c`, inside `eval`, or inside
files the target `source`s at runtime; conversely, text like `"; read x"`
inside a quoted string can be flagged even though it never executes — the
scanner errs fail-closed. A flagged `read` not immediately preceded by the
comment `# detached-runner:interactive-ok` on its own line causes a refusal
— the script will not be launched detached. This is deliberate: a prompt
inside an unattended detached session helps no one, since nobody is there to
answer it. If a script genuinely needs interactive input, run it directly
(outside this tool) or launch it with `--interactive --attach`, which runs
it **attached** — you are dropped straight into the tmux session instead of
it running in the background — so you're present for any prompt (a marked
script launched this way runs attached, never detached). Historical scripts
with `read -r -p` confirmation gates (the smoke wrappers) are correctly
outside this tool's default path for exactly this reason; keep interactive
confirmations and cookie entry (`--cookie-prompt`) in their own,
separately-run smoke workflows, not inside a future detached deploy script.

Two validation flags run the pre-flight without tmux: `--scan-only` (scans,
exits 0/1, launches nothing) and `--dry-run` (scans, generates and prints
the launcher file, launches nothing).

The scanner also refuses to launch a target script containing an obvious
secret-DISCLOSURE command: bare `printenv`/`env` dumps, the explicit
`/usr/bin/env` dump form, `cat` of a dotfile env path (a basename that
STARTS with `.env` — `.env`, `.env.staging`, `/opt/…/.env.local`), or `cat`
of a variable the script statically assigned to such a path
(`ENV_FILE=/opt/…/.env.staging` … `cat "$ENV_FILE"`). It deliberately does
NOT flag mere filename references: shebangs and comment lines are never
scanned; plain assignments, `source "$ENV_FILE"`, `docker compose
--env-file …`, `test -r`, and `grep -q KEY "$ENV_FILE"` checks pass; and
generated artifact names merely ENDING in `.env` (e.g.
`/tmp/q03.2b-baseline-images.env`) are not secret files and pass. Honest
boundary: `grep`-based dumping, dynamically constructed paths, and
indirection the static pass cannot see are not detected — this is
defense in depth, mirroring `.claude/hooks/gwx-guard.mjs`'s philosophy,
not a guarantee that a launched script is silent about secrets. That
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
`remain-on-exit` is set on the window **before the target command starts**:
the session is created running an idle shell, the option is applied, and the
pane is then `respawn-pane -k`'d onto the real command — so even a target
that exits almost instantly cannot close the pane before the option is in
force. The pane's final output is always there to scroll back through, not
auto-closed.

### Argv safety (paths/args with spaces, quotes, metacharacters)

Operator-supplied paths and arguments are never spliced into a shell string.
`run-detached.sh` writes a `mktemp` launcher file (mode 700, fixed-charset
path, self-deleting on start) whose single `exec bash …` line is generated
with `printf %q` for the runner library, status file, log file, target path,
and every target argument. The only string tmux's `sh -c` ever parses is
`bash <mktemp-path>`. Hostile-looking names (spaces, single/double quotes,
`;`, `$(…)`, backticks) are passed through as literal argv words; there is
no `eval` anywhere. Inspect exactly what would run with `--dry-run`.

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

# R2 Candidate Validation Orchestrator

A disposable-worktree local release gate: certifies an arbitrary GroundWorX R2
candidate commit against two independent validation inputs, without ever
modifying the candidate's own branch/worktree or permanently merging either
validation input.

## Exact command

```
node scripts/certification/certify-r2-candidate.mjs <candidate-sha> [flags]
# or
npm run certify:r2-candidate -- <candidate-sha> [flags]
```

Flags:

| Flag | Effect |
| --- | --- |
| `--keep-worktree` | Do not remove the disposable worktree after the run (for investigation). Its path is in the summary/artifact. |
| `--output <dir>` | Base directory for the disposable worktree and result artifacts (default: `<os-tmp>/gwx-r2-certify`). |
| `--skip-install` | Skip `npm ci` — only safe when the candidate's dependencies are already known-valid in this environment. |
| `--help`, `-h` | Print usage and exit. |

## Prerequisites

- A local checkout of this repository with the candidate commit, and both
  validation-input commits, reachable in the object database (`git fetch`
  them first if they live only on a remote).
- Node.js (matching this repo's version), `npm`, and — only if the
  candidate's changed surface touches `sidecar/` — `python3` with `pytest`
  installed.
- No `DATABASE_URL`, staging/production credentials, or network access is
  required. Every DB the tool touches is an ephemeral local file it creates
  and deletes itself.

## Candidate selection

The `<candidate-sha>` argument is any git commit-ish resolvable from the
repository the tool is invoked in (a full SHA, short SHA, tag, or branch
name). It is validated (`git cat-file -e <sha>^{commit}`) before anything
else runs; an unresolvable candidate fails immediately with no worktree ever
created.

## Overlay mechanism

The candidate is checked out into a **new, detached, disposable git worktree**
under the output directory (`git worktree add --detach <tmp> <candidate-sha>`)
— this never touches the candidate's own branch or any other registered
worktree (worktrees share the object database, not working-tree state).

Two independent validation inputs are then brought in **by explicit path**,
never by merge and never by whole-tree checkout:

- **Auth/tenant-isolation/audit regression pack** (`29f141bf...`) —
  `__tests__/r2-regression/` and its coverage-matrix doc.
- **Local Meeting-to-Response lifecycle certification harness**
  (`c25ea1e6...`) — `docs/r2/`, `scripts/certification/run-r2-certification.mjs`,
  and `tests/fixtures/r2-lifecycle/`.

Both are overlaid via `git checkout <input-sha> -- <path>...`, scoped to
those specific paths only — nothing else from either input commit is
touched. `package.json` is never overlaid as a raw file (that would clobber
the candidate's own dependencies/scripts); instead the one required script
key (`"certify:r2-lifecycle"`) is added via a JSON-aware read-modify-write.

After every gate runs, the tool re-derives the candidate's HEAD and
`package.json` state and proves it matches what was snapshotted before the
overlay (outside the overlay paths and the one added script key) —
`SOURCE_CANDIDATE_MODIFIED` in the result reflects this proof, and a
mismatch fails the whole run regardless of gate outcomes.

## Gates run

| Gate | What it does | Notes |
| --- | --- | --- |
| `GIT_DIFF_CHECK` | `git diff --check` on the candidate's own commit | Skipped for a root commit |
| `TYPECHECK` | `npx tsc --noEmit` | |
| `ESLINT` | Scoped to the candidate's changed files vs. a determinable base (merge-base with `origin/main`, else the parent commit); falls back to full-repo lint if no base is resolvable | |
| `FULL_VITEST` | `npx vitest run` | Also covers the overlaid regression pack in the same invocation |
| `REGRESSION_PACK` | Reports the `FULL_VITEST` outcome specifically for `__tests__/r2-regression/` | Fails if the overlay never landed |
| `LIFECYCLE_CERTIFICATION` | `npm run certify:r2-lifecycle` (the overlaid harness script) | |
| `PRISMA_VALIDATE` | `npx prisma validate` against a throwaway local `file:` placeholder | Schema syntax only, no connection |
| `MIGRATION_LINT` | `node scripts/migration-lint.mjs --since=all` (already-existing static analysis, no DB) | Exit 3 (warnings-only) counts as passing |
| `MIGRATION_REPLAY` | `node scripts/replay-validation.mjs` pointed at a scratch `file:` DB under the disposable worktree | Reuses this repo's existing, already-CI-required, local-only replay gate as-is |
| `MIGRATION_UPGRADE_VALIDATION` | New incremental gate: stages the candidate's last 1–3 migrations cumulatively and runs a real `prisma migrate deploy` against a fresh scratch DB per stage | Generic over however many migrations exist — never hardcoded to specific migration names |
| `PYTHON_TESTS` | `python3 -m pytest sidecar` | Only runs if the candidate's changed surface touches `sidecar/`; otherwise reported as not applicable |

Every gate subprocess is built with an explicit environment allowlist — never
ambient `DATABASE_URL` or provider credentials — and any `DATABASE_URL`
override is required to be a local `file:` path. The tool asserts this at the
end of the run (`EXTERNAL_NETWORK_REQUIRED`); a violation would fail the run.

## Result interpretation

The tool prints a summary block and writes a JSON artifact
(`<output>/result-<sha12>.json`):

```
CANDIDATE: <resolved full sha>
RESULT: PASS | FAIL
FULL_VITEST / REGRESSION_PACK / LIFECYCLE_CERTIFICATION / TYPECHECK / ESLINT /
PRISMA_VALIDATE / MIGRATION_LINT / MIGRATION_REPLAY /
MIGRATION_UPGRADE_VALIDATION / PYTHON_TESTS: PASS | FAIL | SKIP
SOURCE_CANDIDATE_MODIFIED: true | false
EXTERNAL_NETWORK_REQUIRED: true | false
ARTIFACT_DIRECTORY: <output dir>
```

`RESULT` is `PASS` only if every gate that ran is `PASS` or `SKIP` (a single
`FAIL` fails the whole run) **and** the candidate was proven unchanged.
`SKIP` means "not applicable to this candidate" (e.g. `PYTHON_TESTS` when
`sidecar/` wasn't touched, or `MIGRATION_UPGRADE_VALIDATION` when fewer than 2
migrations exist) — it never counts against `RESULT`.

## Retained evidence

The JSON result artifact is written on every run outcome that reaches a
worktree — including overlay failures and gate failures — not just on
success, so a failed run's evidence is never silently discarded.

## Cleanup behavior

The disposable worktree is removed (`git worktree remove --force`) at the end
of a normal run, unless `--keep-worktree` was passed. Removal is
**marker-checked**: the tool writes a random-token ownership marker
(`.certify-owner`) into the worktree the moment it creates it, and refuses to
remove any directory whose marker is missing or doesn't match — this applies
identically whether the run finishes normally, fails a gate, or is
interrupted (`SIGINT`/`SIGTERM`). An interrupted run still attempts the same
marker-checked cleanup (unless `--keep-worktree`) before exiting.

## Safety boundaries

- Never modifies the candidate's own branch, ref, or registered worktree —
  only a brand-new disposable detached worktree is ever written to.
- Never merges either validation-input branch; only specific paths are
  checked out into the disposable worktree.
- Never touches staging, production, or any live Turso instance — every DB
  the tool creates is an ephemeral local `file:` path under the disposable
  worktree's own scratch directory, deleted with the worktree.
- Never requires or forwards real credentials/API keys; subprocess
  environments are built from an explicit allowlist.
- Removes only the disposable directory it created and marked itself — never
  force-deletes an unmarked or mismatched path.
- Does not modify `scripts/replay-validation.mjs` or `scripts/migration-lint.mjs`
  (both pre-existing, already-CI-required local gates) — it reuses them
  as-is rather than parameterizing or forking them.

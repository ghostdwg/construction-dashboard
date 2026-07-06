# Fable Exit Review — Independent Acceptance of the GroundWorX Durable Handoff

- Reviewed: 2026-07-06, fresh independent Fable session (no chat history from
  the build session; evidence gathered from git + direct invocation only).
- Acceptance base: `fable/groundworx-handoff-final @ 427b600a0362ab84d7e3095d2378cc726f3d10a8`
  (clean worktree), parent `4ec073fe458dcc52273bd1228f6230e75c22af78` (Sprint 1
  tip). Integration worktree untouched:
  `integration/foundation-ci-divergence @ 625301a77f73d3b56ccbee41a50c33ba34910150`, clean.
- Scope honored: no agents, no product-code changes, no live systems, no
  network, no credentials, no env-value inspection, no remote git. Corrections
  limited to handoff/config files (list in §3).

## 1. Ref and content verification `[V]`

- Handoff HEAD `427b600` == expected; branch `fable/groundworx-handoff-final`;
  `git status --porcelain` empty.
- Ancestry: `625301a → 854eacf → ae04d0c → 4ec073f → 427b600`, linear;
  `merge-base --is-ancestor` true for all four ancestors.
- Frozen refs at expected SHAs: `fable/groundworx-command-center @ 7b6ef13`,
  `main @ 160f6e8`, `fable/groundworx-delivery-sprint-1 @ 4ec073f`.
- Ledger/Queue byte-identity with the frozen archive: sha256 of working files
  == sha256 of `7b6ef13:<path>` (Ledger `55ae6da…`, Queue `333388c…`); git
  blobs `d203416` / `a43caa3` as the exit report claims.
- Every artifact referenced by CLAUDE.md / rules / skills / queue prompts
  exists at this tip (classifiers, adapter, fixture CLI, backfill tool, smoke
  helpers, migration runner, both pending migration dirs, dossier, backup
  runbook, `fileAvailability.ts`, `meetings/storagePath.ts`).
- No secrets, env values, raw document content, or absolute host paths in any
  new handoff asset (pattern scan clean; the only absolute path in the
  canonical Queue — the staging storage mount in Q08 — predates this handoff
  and lives in the protected file).
- `.claude/settings.local.json` not tracked; `.gitignore` narrowed correctly.

## 2. Acceptance tests — verdicts

| # | Test | Verdict |
|---|---|---|
| 1 | Fresh Opus can orient without chat history | **PASS** — CLAUDE.md + handoff "Current facts"/Delta give worktree, lineage, next local work, next human gate (Q02), the exact proof list, and escalation (Josh, per-invocation, Ledger §6/§7a) |
| 2 | Sonnet builder can run one bounded local card credential-free | **PASS** — gwx-builder agent + `local-only-implementation.md` + exit-report §6 verbatim GWX-Q13 prompt; both target modules exist; tests use in-repo fakes; no card path requires any credential |
| 3 | Q02 first live gate; Q07 = independent read-only decision, no bypass | **PASS** (strengthened) — consistent across CLAUDE.md, Queue execution order, Q07 card image-note; Delta section now states it explicitly |
| 4 | Config/hook syntax supported by installed Claude Code v2.1.201 | **PASS** — verified empirically in a live session: `.claude/rules/*.md` auto-loaded, all three skills and all three agents registered, PreToolUse hook **fired live** (see §hook-evidence). Direct-invocation matrix 38/38 after one fix |
| 5 | Mechanical controls described as defense-in-depth, never approval-proof | **PASS** — hook header + block message, settings description in handoff doc, exit-report §4 all state it; no file claims otherwise |
| 6 | No secrets / env values / raw content / unsafe paths | **PASS** — scan clean (§1) |
| 7 | Frozen archive and refs unmistakably protected | **PASS** — CLAUDE.md "Frozen — never modify", handoff doc, Edit/Write deny on Ledger/Queue; residual honesty kept: branch freezes are convention, not mechanism (exit-report risk 3) |
| 8 | Explicit "Current Execution Delta" table with override rule | **FAIL → FIXED** — facts existed but the named table + override rule did not; added to `GROUNDWORX-EXECUTION-HANDOFF.md` this review |
| 9 | Integration import manifest | **PASS** — §4 below |
| 10 | Only surgical corrections, allowed files only | **PASS** — §3 below |

### Hook evidence (test 4 detail)

- **Live-session proof (resolves exit-report risk 1):** during this review the
  guard blocked a read-only Bash call whose text contained
  `apply-turso-migrations.mjs` — exit 2, stderr guardrail message surfaced in
  the session. Project-settings hook registration therefore works end-to-end
  on v2.1.201 with no additional trust step in this workspace. (The block was
  a phrase-filter false positive on a `[ -e <path> ]` existence check —
  over-blocking in the fail-safe direction; accepted, not fixed.)
- **Direct-invocation matrix:** 38 cases (22 must-block / 16 must-allow)
  covering wrappers, quote-stripping, chained segments, env-assignments,
  phrase gates, and safe lookalikes (`grep -r docker docs/`, `echo docker`,
  report/dry-run tool modes). Initial run 37/38: `timeout 5 turso db show`
  slipped the wrapper-skip (numeric duration argument not skipped; same shape
  as `nice -n 10 docker ps`). Fixed by also skipping bare `\d+[smhd]?` tokens
  in the wrapper-skip loop; re-run **38/38**. Note `env | grep …` is blocked
  by design (bare `env` as a producer dumps values into the pipe).

### Corrections of my own expectations (recorded for honesty)

- `env | grep -c PATH`: I initially expected ALLOW; the block is correct and
  deliberate. The matrix, not the hook, was wrong.

## 3. Changes made by this acceptance review (complete list)

| File | Change |
|---|---|
| `docs/release/GROUNDWORX-EXECUTION-HANDOFF.md` | Added "Current Execution Delta" section: per-card full commit SHAs, COMPLETE status, next actionable item, and the status-override rule (Delta wins over stale Ledger/Queue status wording until GWX-Q11; decisions/gates/claims NOT overridden) |
| `.claude/hooks/gwx-guard.mjs` | Wrapper-skip now also skips numeric wrapper args (`timeout 5`, `nice -n 10`) so trailing banned binaries are caught; 38/38 matrix green |
| `docs/release/FABLE-EXIT-REPORT.md` | CLAUDE.md line count corrected 118→116; risk 1 annotated RESOLVED with pointer here |
| `docs/release/FABLE-EXIT-REVIEW.md` | This file (new) |

Nothing else touched. Canonical Ledger/Queue, product code, scripts, tests,
migrations: unmodified (verify: `git diff 427b600 HEAD --stat` shows only the
four files above).

## 4. Integration import manifest

Target: the `integration/foundation-ci-divergence` worktree (the operator
knows its host location; not recorded here). Because Sprint 1 and
the handoff commits are **linear descendants of the integration tip**, the
authoritative import is a **fast-forward** — it preserves the reviewed,
evidence-bound SHAs exactly. Cherry-picking would mint new SHAs and detach
every recorded proof (test baselines, review records) from the imported
commits; use it only if integration has moved, and per the conflict policy
that situation is itself an escalation.

**Pre-import checks (all must hold; any miss ⇒ stop, escalate to Josh):**
1. `git status --porcelain` in the integration worktree → empty.
2. `git rev-parse HEAD` → `625301a77f73d3b56ccbee41a50c33ba34910150`.
3. `git merge-base --is-ancestor HEAD 427b600a0362ab84d7e3095d2378cc726f3d10a8` → true (fast-forward possible).
4. No in-progress merge/rebase/cherry-pick state in `.git`.

**Import (verified order — Q01 → Q04a → Q06a → handoff docs):**
- Preferred, one step, byte-identical to review state:
  `git merge --ff-only 427b600a0362ab84d7e3095d2378cc726f3d10a8`
- Equivalent staged form (same end state, card-by-card visibility):
  `git merge --ff-only 854eacf35697cdd0f4bd460af15047f358b4537e`   (GWX-Q01)
  `git merge --ff-only ae04d0c8c2004cd7ca40a2f993af410841752e81`   (GWX-Q04a)
  `git merge --ff-only 4ec073fe458dcc52273bd1228f6230e75c22af78`   (GWX-Q06a)
  `git merge --ff-only 427b600a0362ab84d7e3095d2378cc726f3d10a8`   (handoff docs + acceptance)
- Handoff documentation commit(s) come **last**, after the three card commits,
  plus the acceptance commit produced by this review (descendant of `427b600`;
  include it by fast-forwarding to the acceptance SHA instead).

**Conflict policy:** any non-fast-forward condition, any conflict marker, any
unexpected `--stat` line ⇒ **stop and escalate to Josh. Never resolve
blindly**, never `-X` strategies, never rebase the sprint commits.

**Post-import validation (local, non-mutating):**
1. `git rev-parse HEAD` == the imported tip; `git status --porcelain` empty.
2. Ledger/Queue byte-identity:
   `git diff 7b6ef13 HEAD -- docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md runtime/runbooks/GROUNDWORX_AGENT_QUEUE.md` → empty.
3. `/gwx-verify` core suite at the imported tip — baselines: fixture tests 27
   passed; storageInventory+prismaAdapter 35 passed; backfill tool 11 passed;
   storage-smoke gate + helper tests 40 passed;
   `GUARDRAILS_MODE=enforce node governance/guardrails/detect-ai-providers.mjs`
   → `would_block=0 => OK` with exactly 4 allow-listed sites.
4. `git diff 4ec073f HEAD --stat` → only `docs/…`, `.claude/…`, `.gitignore`
   (no product code beyond Sprint 1).

**Hard stop for Josh's Q02 approval:** after post-import validation passes,
**everything stops**. The next action in the chain is GWX-Q02 (Human): same-day
staging-DB checkpoint (identifier recorded) → migration-runner dry-run listing
exactly `20260521020000_addendum_meeting_storage_keys` and
`20260521030000_background_job_dedupe_key` → apply, staging DB only, from a
host checkout at the pinned SHA. Models may draft the command block only. No
checkpoint ⇒ Q02 does not run and the chain halts (Ledger §7a). No image
build (Q03) before Q02, ever. Meanwhile the only model-runnable work is the
Q07 Opus decision (read-only) and Q11/Q13-class local cards.

## 5. Remaining handoff risks (post-acceptance)

1. **Frozen refs are convention, not mechanism** (unchanged) — nothing local
   prevents a commit to integration/main/sprint/archive; only instructions do.
2. **Canonical status drift persists until GWX-Q11** — mitigated by the Delta
   section; Q11 must also settle how deny-protected Ledger/Queue edits are
   made when sanctioned.
3. **`Edit`/`Write` deny rules on Ledger/Queue were not adversarially tested**
   — doing so risks actually modifying a canonical file, so their relative-path
   resolution on v2.1.201 remains `[UNK]`. The live-verified hook does not
   cover Edit/Write; treat the deny rules as best-effort until a safe test
   exists (e.g., a sacrificial file in a throwaway worktree).
4. **Guard-hook coverage is finite by design** — new wrapper shapes may evade
   it (as `timeout 5` did); it is defense-in-depth behind the permission
   system, never proof of anything.
5. **Sprint 1 remains unmerged until the §4 manifest executes** — agents
   verifying "current integration" must not expect Q01/Q04a/Q06a at `625301a`.

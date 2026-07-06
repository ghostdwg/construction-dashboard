@AGENTS.md

# GroundWorX Continuation Guide

You are working on the **GroundWorX execution line** of `construction-dashboard`
(github.com/ghostdwg/construction-dashboard). This file is the boot map. The two
canonical sources of truth are:

1. `docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md` — truth table, binding
   decisions (§4), allowed/prohibited claims (§5), do-not-re-research list (§9).
2. `runtime/runbooks/GROUNDWORX_AGENT_QUEUE.md` — the ordered, runnable work cards.

**Read the Ledger before doing anything.** It supersedes `REALITY.md`,
`CURRENT_STATE.md`, `ROADMAP.md`, and `staging-release-bridge.md` wherever they
disagree (those contain known-stale claims — Ledger §9.9). Never "correct" the
Ledger from those files. Do not duplicate or replace the Ledger/Queue with a
new roadmap.

---

## Repo / worktree identity

- **Active handoff branch:** `fable/groundworx-handoff-final` (built from Sprint 1
  tip `4ec073f`; carries the Ledger/Queue byte-identical to the frozen archive).
- **Integration baseline:** `integration/foundation-ci-divergence @ 625301a` —
  the Ledger's base commit. Sprint 1 work is NOT yet merged into it.
- **Sprint 1 (reviewed, local-only):** `fable/groundworx-delivery-sprint-1 @ 4ec073f`
  — `854eacf`=GWX-Q01, `ae04d0c`=GWX-Q04a, `4ec073f`=GWX-Q06a.
- **WORKTREE TRAP (Ledger §9.12):** fresh agent worktrees may check out `main`
  (`160f6e8`, ~100 commits behind, contains none of this work). ALWAYS run
  `git rev-parse HEAD` first; if stale, re-anchor or read via `git show <sha>:<path>`.

## Frozen — never modify

- **Production** (branch, DB, containers, storage): entirely frozen. First
  authorized production touch is GWX-Q09 (read-only inventory), human-executed.
- **`fable/groundworx-command-center @ 7b6ef13`:** the frozen command-center
  archive. Never commit to it. This branch carries identical copies of its docs.
- **`main @ 160f6e8`:** frozen until GWX-Q15 (post-cutover reconciliation).
- **`integration/foundation-ci-divergence` and `fable/groundworx-delivery-sprint-1`:**
  do not rewrite; merging Sprint 1 into integration is a reviewed, deliberate step.

## Current queue state (as of 2026-07-06)

- **Done (local, reviewed, unmerged to integration):** Q01, Q04a, Q06a.
- **Next contract:** **GWX-Q02** — staging checkpoint + migration preflight +
  apply. **Human-owned.** This is the first live gate; nothing after it runs
  without it. No checkpoint ⇒ Q02 does not run (Ledger §7a).
- **Then:** Q03 (first app-image build/pin/deploy gate, human) → Q04b → Q05 →
  Q06b → Q07 → Q08 → Q09 → Q10. Order is load-bearing (Queue header).
- **Parallel-safe local work anytime:** Q11 (doc truth pass), Q13 (classifier
  error honesty). Q12 needs Q02 applied. Q07's Opus *decision* may run anytime.
- **Proven so far:** Spec Book storage smoke 13/13 on staging (image
  `e41b027-storage-smoke-failclosed`, automation suppressed); ONE controlled
  Anthropic call → `LAST_REAL_SUCCESS`. Nothing else is live-proven.

## Human / live gates — nothing below happens on model authority

Every one of these requires explicit operator (Josh) approval **per invocation**
(Ledger §6): migrations; image build/pin/recreate; any fixture-CLI or
backfill/inventory run against a real DB; any real provider call; backup/restore
drills; ANYTHING touching production; credential handling; deleting rows/blobs
the tool didn't create. Models prepare commands and acceptance criteria; humans
execute. A local hook or passing test NEVER substitutes for, or proves, human
approval.

## Core safety constraints

- Never return `pricingData`/`rawPriceText` to the client or place it, sub
  names, companies, or `isPreferred` into any AI prompt or sub-facing export.
- No secret values, raw document content, or user project data in code, docs,
  commits, or chat. Never print env/credential values.
- **No manual DB edits, ever.** All writes go through the gated migration
  runner, gated fixture CLI, or gated backfill apply.
- `STORAGE_SMOKE_MODE_ENABLED` stays OFF outside an approved smoke run.
- **P2-A0 is shadow-only** — describe it only as detection/telemetry, never as
  redaction/blocking/enforcement (Ledger §5 prohibited claims).
- Provider construction only via the two sanctioned gateways; no new allowlist
  entries. Real provider calls require an approved queue card.
- Migrations are forward-only, applied only via `scripts/apply-turso-migrations.mjs`,
  never auto-run, never on model authority.
- Do not reopen Ledger §4 decisions or re-research Ledger §9 settled questions.
- Scoped rules live in `.claude/rules/` — read the ones matching your task:
  `environments-deployment.md`, `migrations-checkpoints.md`,
  `secrets-providers.md`, `verification-evidence.md`,
  `local-only-implementation.md`.

## Model routing

- **Opus → `gwx-coordinator` agent:** sequencing, cross-cutting decisions,
  adjudications (e.g. Q07, Q10 dossier, Q14). Read-only; never executes live
  actions or writes product code.
- **Sonnet → `gwx-builder` agent:** exactly ONE bounded local queue card per
  session, in an isolated worktree anchored to the correct tip. Local code +
  tests only.
- **Sonnet/Haiku → `gwx-verifier` agent:** runs the local evidence suite,
  reports PASS/FAIL with evidence. Never fixes, never speculates.
- One session per card; do not mix planning and build execution in one session.

## On-demand skills

- **`/gwx-next`** — identifies exactly ONE next queue contract (card, owner,
  prereqs, gates) from the Queue + current branch state. Never starts the work.
- **`/gwx-verify`** — runs the applicable local evidence suite and reports
  PASS/FAIL per check. Local, non-mutating; never "fixes" anything.
- **`/gwx-handoff`** — updates the current-facts block of
  `docs/release/GROUNDWORX-EXECUTION-HANDOFF.md` (SHAs, queue position, last
  proof) without restating the project.

## Commit authorship

All commits must end with:
```
Co-Authored-By: NeuroGlitch AI Engine <ai@neuroglitch.dev>
```
Never commit `.claude/settings.local.json`.

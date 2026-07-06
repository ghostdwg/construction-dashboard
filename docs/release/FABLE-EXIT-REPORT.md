# Fable Exit Report — GroundWorX Durable Handoff Build

- Built: 2026-07-06, final Fable session (post-Sprint 1).
- Base: `fable/groundworx-delivery-sprint-1 @ 4ec073fe458dcc52273bd1228f6230e75c22af78`.
- Branch: `fable/groundworx-handoff-final`. No live actions were taken; no
  product code was changed; integration, Sprint 1, `main`, production, and the
  frozen archive (`fable/groundworx-command-center @ 7b6ef13`) are untouched.

## 1. Exact files created/changed on this branch

| File | Change |
|---|---|
| `docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md` | Added — byte-identical to `7b6ef13` (blob `d203416`) |
| `runtime/runbooks/GROUNDWORX_AGENT_QUEUE.md` | Added — byte-identical to `7b6ef13` (blob `a43caa3`) |
| `CLAUDE.md` | Rewritten (108 → 116 lines): GroundWorX boot map replacing the stale session guide (kept `@AGENTS.md`, commit trailer, data-safety constraints) |
| `.claude/rules/environments-deployment.md` | New |
| `.claude/rules/migrations-checkpoints.md` | New |
| `.claude/rules/secrets-providers.md` | New |
| `.claude/rules/verification-evidence.md` | New |
| `.claude/rules/local-only-implementation.md` | New |
| `.claude/skills/gwx-next/SKILL.md` | New |
| `.claude/skills/gwx-verify/SKILL.md` | New |
| `.claude/skills/gwx-handoff/SKILL.md` | New |
| `.claude/agents/gwx-coordinator.md` | New (model: opus, read-only tools + Bash) |
| `.claude/agents/gwx-builder.md` | New (model: sonnet) |
| `.claude/agents/gwx-verifier.md` | New (model: haiku) |
| `.claude/settings.json` | New — permissions.deny/ask + PreToolUse hook registration |
| `.claude/hooks/gwx-guard.mjs` | New — Bash-command guard script |
| `docs/release/GROUNDWORX-EXECUTION-HANDOFF.md` | New — current-state snapshot |
| `docs/release/FABLE-EXIT-REPORT.md` | New — this file |
| `.gitignore` | Edited — previously ignored ALL of `.claude/`; narrowed to `settings.local.json` + `worktrees/` so the shared config above can be committed |

## 2. Commands run and results

Pre-build verification (all from the integration worktree):
- `git status --porcelain` on `integration/foundation-ci-divergence` → clean;
  `git rev-parse HEAD` → `625301a77f73d3b56ccbee41a50c33ba34910150` ✓
- `git rev-parse fable/groundworx-delivery-sprint-1` →
  `4ec073fe458dcc52273bd1228f6230e75c22af78` ✓
- `git merge-base --is-ancestor a83e248… fable/groundworx-command-center` →
  true; tip `7b6ef13` = "docs: sync Q06b card…" (the Q06b update) ✓
- `git worktree add …/groundworx-handoff-final -b fable/groundworx-handoff-final 4ec073f…` ✓
- `git checkout 7b6ef13 -- <Ledger> <Queue>`; `git hash-object` on both files
  matches `git rev-parse 7b6ef13:<path>` exactly (byte-identical) ✓

Enforcement testing (local, no harness side effects):
- `.claude/settings.json` parses as valid JSON ✓
- `gwx-guard.mjs` exercised via direct stdin against a 20-command matrix:
  blocked `docker ps`, `sh -c "turso db list"`, `bash -c "docker compose up"`,
  `apply-turso-migrations.mjs` (any args), `DATABASE_URL=…`, smoke `--execute`,
  backfill `--apply`, fixture `--seed/--cleanup`, `cat .env.*`, `env`,
  `printenv`, `systemctl` after `&&`, `git push --force`; allowed vitest runs,
  `git log`, `ls`, `grep -r docker docs/`, `echo docker`, smoke without
  `--execute`, backfill `--report` ✓ (exit 2 + stderr on block, 0 otherwise)

Read-only specialist 1 (Claude configuration verifier):
- Installed Claude Code v2.1.201. No hooks active in any settings layer;
  project `.claude/` previously empty. Verified against official docs:
  `.claude/rules/*.md` auto-load; deny syntax `Bash(cmd *)` (space-wildcard) /
  `Read(path)`; deny > ask > allow; PreToolUse shape + exit-2 deny semantics;
  agent frontmatter (name/description/tools/model: sonnet|opus|haiku); skill
  `SKILL.md` frontmatter and `/name` invocation.

Read-only specialist 2 (queue/state consistency, ran at `4ec073f` in the
`gwx-sprint1` worktree; no DB/network/env access):
- Commit↔card mapping: `854eacf`=Q01 PASS; `ae04d0c`=Q04a PASS (note: two
  comment-only touches outside the card's file list — `storageInventory/index.ts`,
  `types.ts`; zero code change); `4ec073f`=Q06a PASS. All trailers present.
- All Queue-referenced artifacts exist, incl. both pending migrations and
  `lib/services/storageInventory/prismaAdapter.ts`.
- Local evidence suite ALL GREEN at `4ec073f`:
  `npx vitest run scripts/__tests__/specbook-legacy-fixture.test.ts` → 27 passed;
  storageInventory + prismaAdapter tests → 35 passed;
  `scripts/__tests__/storage-inventory-backfill.test.ts` → 11 passed;
  drawings/addendums storageSmoke gate tests + artifacts-staging-smoke tests →
  40 passed;
  `GUARDRAILS_MODE=enforce node governance/guardrails/detect-ai-providers.mjs`
  → 537 TS/JS + 35 PY scanned, 4 allow-listed sites, `would_block=0 => OK`.
- Ledger spot-checks PASS: smoke gates fail-closed/default-OFF; promptScan
  shadow-only with no blocking path; Prisma adapter unreachable except via
  explicit script invocation (no CI reference); deployment scripts are stubs.

## 3. Verified vs unknown facts

**Verified `[V]`/`[OP]`-backed (evidence above or in the Ledger):** all SHAs
and lineage in the handoff doc; Ledger/Queue byte-identity with the frozen
archive; Sprint 1 = Q01+Q04a+Q06a, reviewed, local-only, unmerged; local
evidence suite green at `4ec073f`; guard-hook behavior (direct invocation);
storage smoke 13/13 + `LAST_REAL_SUCCESS` + `/login` redirect (operator facts
recorded in the Ledger, not re-verifiable from the repo).

**Known drift (expected, recorded — canonical files deliberately not edited):**
the Queue still lists Q01/Q04a/Q06a as pending (they are done on Sprint 1);
Ledger §5's "backfill tool … has no real DB adapter yet" and §1's "fixture CLI
NOT staging-ready" predate Sprint 1 and are stale at `4ec073f`; Ledger §9.5's
"27 existing tests" was actually 23 pre-Q01 (23+4=27 today; miscount cause
unknown); `detect-ai-providers.mjs` lives at `governance/guardrails/`, a path
the Ledger doesn't spell out. The handoff doc and CLAUDE.md carry the current
truth; the sanctioned wider doc correction is GWX-Q11.

**Unknown `[UNK]`:** whether project-scope hooks in committed
`.claude/settings.json` require a workspace-trust approval before executing
(not confirmed in docs; the guard was tested by direct invocation, not
through a live Claude Code session); everything in Ledger §2 unknowns
(production row counts, prod mount value, PITR mechanics, non-Anthropic
rotation status, etc.).

## 4. Enforcement actually installed vs documented-only

**Installed (mechanical, verified locally):**
- `.claude/settings.json` `permissions.deny` — docker/compose/turso/fly/ssh/
  scp/rsync/curl/wget/psql/sqlite3/systemctl/service/reboot/shutdown/env/
  printenv/migration-runner/`prisma migrate|db` Bash prefixes; `Read` deny on
  `.env*` everywhere; `Edit`/`Write` deny on the Ledger and Queue (they are
  canonical — corrections go through a human or a deliberate settings change);
  `ask` on `git push *`. Syntax doc-verified for v2.1.201.
- PreToolUse Bash hook `.claude/hooks/gwx-guard.mjs` — command-position
  binary check (wrapper/quote-evasion aware) + phrase checks (migrations,
  `DATABASE_URL=`, smoke `--execute`, backfill `--apply/--reverse`, fixture
  `--seed/--cleanup`, `.env` cat, force-push, `STORAGE_SMOKE_MODE_ENABLED=`).
  Exit-2 deny per docs; fails open on parse errors by design. 20-case matrix
  green. **Caveat:** not yet exercised through a real session (trust flow
  `[UNK]` above).
- **These are guardrails only. No local mechanism proves or records human
  approval, and none claims to** — the block messages say so explicitly.

**Documented-only (process, not mechanism):** everything in CLAUDE.md, the
five rules, the skills, and the agent definitions; branch freezes (git has no
local branch protection — nothing mechanically stops a commit to integration/
main/sprint/archive); the per-invocation human gates themselves (Ledger §6);
model routing (an operator must actually invoke the right agent).

## 5. First Opus coordinator prompt — paste verbatim

> You are `gwx-coordinator` (or load its definition from
> `.claude/agents/gwx-coordinator.md`). Anchor first: `git rev-parse HEAD`;
> if your worktree is at `main`/`160f6e8`, read everything via
> `git show fable/groundworx-handoff-final:<path>` (Ledger §9.12). Read, in
> order: `CLAUDE.md`, `docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md`
> (all of it), `runtime/runbooks/GROUNDWORX_AGENT_QUEUE.md`, and
> `docs/release/GROUNDWORX-EXECUTION-HANDOFF.md` "Current facts". Deliver,
> read-only, no code, no live actions: (1) confirm or correct, citing card
> prereqs, that the next contract is GWX-Q02 (Human) and that the only
> model-runnable work right now is the Q07 decision plus Q11/Q13-class local
> cards; (2) execute the GWX-Q07 decision exactly per the Queue's "First Opus
> prompt (GWX-Q07)" section — a one-page ADR-lite naming the chosen
> durability-read mechanism, what it proves vs doesn't, the Sonnet
> implementation scope, and the human staging-proof procedure; (3) restate
> GWX-Q02's operator steps and acceptance criteria verbatim from the card for
> Josh. Then stop. Do not reopen Ledger §4 decisions, do not merge or push
> anything, and do not treat any local artifact as human approval.

## 6. First Sonnet local-task prompt (GWX-Q13) — paste verbatim

> Read `docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md` §4.6, §9.11,
> `runtime/runbooks/GROUNDWORX_AGENT_QUEUE.md` card GWX-Q13, `CLAUDE.md`, and
> `.claude/rules/local-only-implementation.md` first; all binding. Verify
> `git rev-parse HEAD` is `4ec073fe458dcc52273bd1228f6230e75c22af78` (or a
> reviewed descendant); if your worktree is at `main`/`160f6e8`, re-anchor
> before reading anything. Task: the catch-paths in
> `lib/services/specbook/storagePath.ts` and
> `lib/services/storage/legacyPathCompat.ts` currently report transient
> FS/BlobStore errors as `invalid` — introduce a distinct `unavailable`-style
> result (or rethrow taxonomy) so operators are never told a
> present-but-unreadable file is malformed. Keep the two modules SEPARATE
> (Ledger §4.6 — do not unify them) but keep their error semantics in sync.
> Do not change the four-shape classification of readable paths, any gate, or
> any bid-scoping rule. Touch only those two modules and their test files;
> add tests for the error branch in both. All existing tests must pass:
> run the `/gwx-verify` core suite plus targeted `npx vitest run` on both
> modules' test files. No live execution, no DB, no network, no env values.
> Commit on a branch off the Sprint 1 tip as
> `fix(storage): distinguish unavailable from invalid in path classifiers`,
> trailer `Co-Authored-By: NeuroGlitch AI Engine <ai@neuroglitch.dev>`.
> Stop condition: if any caller requires behavior changes beyond consuming
> the new result kind, stop and report — that is an Opus adjudication.

## 7. Next human gate

**GWX-Q02** — same-day staging-DB checkpoint (identifier recorded), migration
preflight (dry-run lists exactly the two), then apply
`20260521020000_addendum_meeting_storage_keys` and
`20260521030000_background_job_dedupe_key` via
`node scripts/apply-turso-migrations.mjs` from a host checkout, staging DB
only. No checkpoint ⇒ Q02 does not run and the chain halts (Ledger §7a).
Before GWX-Q03's image build, Josh (or a reviewed session he approves) must
also merge Sprint 1 (`4ec073f`) into `integration/foundation-ci-divergence`
so the built tip contains Q01+Q04a+Q06a.

## 8. Unresolved handoff risks

1. **Hook trust flow unverified end-to-end:** project-settings hooks may
   require a one-time workspace-trust approval, and the guard has only been
   tested by direct invocation — first real session should confirm a blocked
   `docker ps` before relying on it.
   **RESOLVED 2026-07-06 (acceptance review):** the guard fired inside a live
   Claude Code v2.1.201 session (blocked a Bash call whose text matched the
   migration-runner phrase, exit 2 + stderr surfaced). See
   `docs/release/FABLE-EXIT-REVIEW.md` §hook-evidence; a wrapper-argument gap
   (`timeout 5 turso …`) was found and fixed in the same review.
2. **Canonical docs now trail Sprint 1** on three points (§3 "Known drift").
   Mitigated by CLAUDE.md + the handoff doc; permanently fixed only by the
   human-sanctioned GWX-Q11 pass (which must also decide how Ledger/Queue
   updates are made, since this branch deny-protects them from model edits).
3. **Frozen refs are convention, not mechanism** — nothing local prevents a
   commit to integration/main/sprint/archive branches; only instructions do.
4. **Sprint 1 is unmerged** — until the merge, `integration@625301a` and the
   evidence-suite baseline (`4ec073f`) point at different tips; any agent
   verifying "current integration" must not expect Q01/Q04a/Q06a there.
5. **The deny list blocks `curl`/`wget` globally** — if a future local card
   legitimately needs them (none currently does), the operator must consciously
   loosen `.claude/settings.json`; that friction is deliberate.

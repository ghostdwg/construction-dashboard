# GroundWorX Execution Handoff

Concise current-state snapshot for continuation agents. This file does NOT
restate the project. The canonical sources of truth are:

- `docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md` — truth table, binding
  decisions, claim rules, do-not-re-research list. **Read it first.**
- `runtime/runbooks/GROUNDWORX_AGENT_QUEUE.md` — the ordered work cards.

Boot map for any session: root `CLAUDE.md`. Update THIS file (Current facts
block only) via the `/gwx-handoff` skill.

---

## Current facts (as of 2026-07-06)

| Ref | SHA | State |
|---|---|---|
| `main` | `160f6e8` | FROZEN until GWX-Q15; ~100 commits behind — the worktree trap (Ledger §9.12) |
| `integration/foundation-ci-divergence` | `625301a` | Ledger base commit; clean; Sprint 1 NOT yet merged in |
| `fable/groundworx-command-center` | `7b6ef13` | FROZEN archive of the canonical Ledger + Queue (`625301a` → `fa5a3f8` → `a83e248` → `7b6ef13`, docs-only) |
| `fable/groundworx-delivery-sprint-1` | `4ec073f` | Reviewed local commits: `854eacf`=GWX-Q01, `ae04d0c`=GWX-Q04a, `4ec073f`=GWX-Q06a. Local-only; never built into an image |
| `fable/groundworx-handoff-final` | (this branch) | Sprint 1 tip + Ledger/Queue (byte-identical to `7b6ef13`) + continuation assets (CLAUDE.md, rules, skills, agents, guard hook, this file) |
| Production | — | ENTIRELY FROZEN. First authorized touch: GWX-Q09, read-only, human-executed, after GWX-Q08 restore proof |

- **Current task / next gate:** **GWX-Q02** (Human): same-day staging-DB
  checkpoint → migration preflight → apply the two pending migrations
  (`20260521020000_addendum_meeting_storage_keys`,
  `20260521030000_background_job_dedupe_key`). No checkpoint ⇒ Q02 does not
  run (Ledger §7a). Sonnet may draft the command block only.
- **Then GWX-Q03** (Human): first app-image build/pin/deploy gate — builds the
  tip containing Q01+Q04a+Q06a (requires merging Sprint 1 into integration
  first, a deliberate reviewed step). Q02 strictly before Q03, always.
- **Cleared so far:** Q01, Q04a, Q06a — local, reviewed, on Sprint 1.
- **Parallel-safe local work:** Q11 (doc truth pass), Q13 (classifier error
  honesty); Q07's Opus decision may run anytime. Q12 waits for Q02.

## Known-good proof (the complete list — nothing else is live-proven)

1. **Spec Book storage smoke, 13/13** on staging, provider automation
   suppressed (`automationStatus="suppressed_for_storage_smoke"`), against
   image `groundworx-app:e41b027-storage-smoke-failclosed` `[OP]`.
2. **One controlled real Anthropic call** — HTTP 200, durable evidence:
   AiUsageLog row + `GET /api/settings/ai-readiness` →
   `liveProviderVerification: LAST_REAL_SUCCESS` `[OP]`. Further provider
   calls require an approved queue card (GWX-Q16).
3. Unauthenticated section-PDF request redirects to `/login` `[OP]`.

`STORAGE_SMOKE_MODE_ENABLED` is OFF `[OP]`. P2-A0 is shadow-only telemetry
`[DEC]` — never describe it as blocking/redaction. Meetings durability-read
remains UNPROVEN and is currently unprovable safely (read progression
triggers transcription) — the harness decision is GWX-Q07.

## Live / human gates (Ledger §6 — per invocation, no model authority)

Migrations · image build/pin/recreate · fixture-CLI or backfill/inventory runs
against any real DB · real provider calls · backup/restore drills · anything
production (even read-only) · credential handling · deleting rows/blobs the
tool didn't create. **No manual DB edits, ever.** Local hooks/tests never
prove human approval.

## Rollback boundaries

- **Staging image:** repin `e41b027-storage-smoke-failclosed` — safe at any
  point before/after Q02 (both pending migrations are additive/nullable; old
  code ignores the columns). This is the Q03 stop/rollback path.
- **Staging data (Q05 onward):** backfill journal reversal first; checkpoint/
  PITR restore is the last resort. Migrations are forward-only — no
  down-migrations exist; recovery is forward-fix or restore (Ledger §4.7).
- **Production:** no rollback story is needed because nothing may touch it
  until Q09/Q10, which carry their own predeclared triggers (Ledger §7).

## Frozen / deferred work

Frozen: production (all of it); `main` until Q15; the command-center archive
branch; `fable/groundworx-delivery-sprint-1` history (merge it, don't rewrite
it). Deferred with reasons (Ledger §8): MI-10 activation, versioned artifact
keys, Postgres doc, Fly.io plane, Auth B/C, F5, 5F OCR, real tokenizer,
TheBeast hardening, P2-A0 enforcement phase, non-Anthropic secret rotations
(status `[UNK]` — never claim "all secrets rotated"), orange-UI branch.

## Continuation tooling on this branch

- `CLAUDE.md` — boot map (identity, queue state, gates, routing, skills).
- `.claude/rules/` — environments-deployment, migrations-checkpoints,
  secrets-providers, verification-evidence, local-only-implementation.
- `.claude/skills/` — `/gwx-next`, `/gwx-verify`, `/gwx-handoff`.
- `.claude/agents/` — gwx-coordinator (Opus), gwx-builder (Sonnet),
  gwx-verifier (Haiku).
- `.claude/settings.json` + `.claude/hooks/gwx-guard.mjs` — deny rules and a
  PreToolUse guard blocking docker/turso/ssh/migration/`--execute`/env-dump
  commands. Guardrails only — they do not implement or prove approval.
- `docs/release/FABLE-EXIT-REPORT.md` — exact build record of this handoff.

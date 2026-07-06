---
name: gwx-verify
description: Run the applicable GroundWorX local evidence suite (unit tests + provider guardrail) and report PASS/FAIL per check with exact commands, exit codes, and summary lines. Non-mutating — never fixes anything, never touches live systems, never runs anything needing a DB, network, or credentials.
---

# gwx-verify — local evidence suite

Produce an evidence report. Never edit files, never "fix and re-run" — a FAIL
is a valid deliverable. `.claude/rules/verification-evidence.md` is binding.

## Procedure

1. **Anchor:** `git rev-parse HEAD` — record it; every result is bound to that
   SHA. If the worktree is at `main`/`160f6e8`, STOP: report the anchor
   failure (Ledger §9.12), run nothing.
2. **Preflight:** `node_modules/` must exist (if not, report BLOCKED —
   `npm ci` is an installation step to surface, not silently perform).
3. **Run the core suite** (baseline verified green at Sprint 1 tip `4ec073f`):

   | # | Command | Baseline |
   |---|---|---|
   | 1 | `npx vitest run scripts/__tests__/specbook-legacy-fixture.test.ts` | 27 passed |
   | 2 | `npx vitest run lib/services/storageInventory/__tests__/storageInventory.test.ts lib/services/storageInventory/__tests__/prismaAdapter.test.ts` | 35 passed |
   | 3 | `npx vitest run scripts/__tests__/storage-inventory-backfill.test.ts` | 11 passed |
   | 4 | `npx vitest run "app/api/bids/[id]/drawings/upload/__tests__/storageSmoke.test.ts" "app/api/bids/[id]/addendums/[addendumId]/__tests__/storageSmoke.test.ts" scripts/__tests__/artifacts-staging-smoke.test.ts` | 40 passed |
   | 5 | `GUARDRAILS_MODE=enforce node governance/guardrails/detect-ai-providers.mjs` | `would_block=0 => OK` (4 allow-listed sites; the allowlist accepts NO new entries — any growth is a FAIL) |

   If the change under verification touched other tested modules, add their
   targeted `npx vitest run <file>` calls. For a full sweep (only when asked):
   `npx vitest run` (101+ test files — slow).
4. **Never run:** anything with `--execute`; `scripts/apply-turso-migrations.mjs`;
   `storage-inventory-backfill` in `--apply`/`--reverse`; the fixture CLI's
   `--seed`/`--cleanup`; anything needing `DATABASE_URL`, a URL, Docker, or
   credentials. Those are SKIPPED lines naming their human gate.
5. **Report**, per check: command · exit code · summary line (counts drift
   upward as cards add tests — a count above baseline with exit 0 is still
   PASS; below baseline or nonzero exit is FAIL, quote the first failure) ·
   PASS/FAIL/SKIPPED. Redact any absolute path in quoted output as
   `[REDACTED-PATH]`.
6. **Close with:** `EVIDENCE: <n> PASS / <n> FAIL / <n> SKIPPED @ <sha>` —
   and the reminder that a green suite proves local behavior at that SHA
   only; it is not staging proof, lifecycle proof, or human approval.

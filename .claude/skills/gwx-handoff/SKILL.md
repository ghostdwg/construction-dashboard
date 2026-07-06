---
name: gwx-handoff
description: Update the current-facts block of docs/release/GROUNDWORX-EXECUTION-HANDOFF.md (SHAs, queue position, latest proof, open gates) after a card completes or a gate clears. Surgical update only — never restates or restructures the project docs.
---

# gwx-handoff — refresh current handoff facts

Keep `docs/release/GROUNDWORX-EXECUTION-HANDOFF.md` truthful after state
changes. This skill edits ONLY the "Current facts" section of that file.

## Procedure

1. **Anchor:** `git rev-parse HEAD`; verify you are on a GroundWorX branch
   descended from `4ec073f` (or re-anchor per Ledger §9.12).
2. **Collect deltas** (only what actually changed since the block's "as of"
   line): completed card + its commit SHA(s) and review status; new branch
   tips (`git log --format='%h %s' -3` per touched branch); any new operator
   proof (checkpoint ID, smoke result, drill record — identifier only, never
   artifact contents); any gate cleared or newly blocking.
3. **Verify before writing:** every SHA via `git rev-parse`, every "tests
   green" claim via the recorded command output from the session that ran it.
   A fact you cannot verify right now is written as `[UNK]`, not dropped and
   not guessed.
4. **Edit** the "Current facts" block in place: update the "as of" date,
   the SHA table, "Current task", "Cleared gates", "Next gate". Do NOT touch
   the lineage, rollback, or frozen-work sections unless a SHA in them is now
   factually wrong — and then change only that SHA.
5. **Never:** restate the project, copy Ledger/Queue content in, add roadmap
   commentary, edit the Ledger or Queue themselves, or record secret values /
   raw paths / artifact contents.
6. **Commit** (when asked) as `docs: refresh GroundWorX handoff facts` with
   the standard `Co-Authored-By: NeuroGlitch AI Engine <ai@neuroglitch.dev>`
   trailer.

## Litmus

After your edit, a fresh reader of ONLY that file must know: which branch and
SHA to start from, what was last proven (and by what identifier), what the
single current task is, and which human gate is next. If your edit added
anything beyond that, revert the excess.

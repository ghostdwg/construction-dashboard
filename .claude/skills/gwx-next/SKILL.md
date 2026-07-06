---
name: gwx-next
description: Identify exactly ONE next GroundWorX queue contract (card, owner, prereqs, gates) from the canonical Queue and current branch state. Read-only — never starts the work. Use when a session asks "what's next" on the GroundWorX line.
---

# gwx-next — identify the single next contract

Output exactly one runnable contract. Never start executing it. Never propose
work that isn't a card in `runtime/runbooks/GROUNDWORX_AGENT_QUEUE.md`.

## Procedure

1. **Anchor.** `git rev-parse --abbrev-ref HEAD` and `git rev-parse HEAD`. If
   the worktree is at `main`/`160f6e8` (Ledger §9.12 trap), read all files
   below via `git show fable/groundworx-handoff-final:<path>` instead.
2. **Read state, newest first:**
   - `docs/release/GROUNDWORX-EXECUTION-HANDOFF.md` → "Current facts" block
     (queue position, last completed card, pending gates).
   - `runtime/runbooks/GROUNDWORX_AGENT_QUEUE.md` → the EXECUTION ORDER line
     in the header (it differs from card numbering — follow it), then the
     candidate card's full text.
   - `docs/architecture/GROUNDWORX_EXECUTION_LEDGER.md` §3 (ordered path),
     §6 (gates) for the candidate.
3. **Select ONE card:** the earliest card in the execution order whose
   prerequisites are all satisfied per the handoff facts. If that card is
   Human-owned, it is still the answer — do not skip ahead to the next
   model-ownable card unless the user explicitly asks for parallel-safe local
   work (then: Q11/Q13-class cards only, and say why they are parallel-safe).
4. **Report**, exactly this shape:
   - **Card:** ID + title
   - **Owner:** Human / Opus / Sonnet (per the card — never reassign owners)
   - **Prereqs:** each one, with its satisfied/unsatisfied evidence
   - **Gates:** the human/live gates the card crosses, per invocation
   - **Objective + acceptance:** quoted or tightly summarized from the card
   - **Stop condition:** quoted from the card
   - **If model-owned:** the verbatim or near-verbatim boot prompt (the Queue
     bottom section has canonical prompts for Q01/Q07-class cards)
5. **Stop.** Do not begin implementation, do not draft live commands beyond
   what the card itself instructs, do not renumber or reorder the queue.

## Hard rules

- Exactly one card. Ties are broken by the EXECUTION ORDER line, nothing else.
- If prerequisites of every remaining card are blocked on a Human gate, say
  so plainly: the next contract is that Human gate — a model cannot clear it.
- Never invent a card, split a card, or merge cards; that is coordinator
  (Opus) work with its own session.

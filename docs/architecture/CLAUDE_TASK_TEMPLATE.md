# Claude Task Template

Use this when handing a bounded implementation task to Claude Code.

---

## Task Id

`GWX-XXX`

## Goal

One sentence describing the exact migration step.

## Read First

- `docs/architecture/CURRENT_STATE.md`
- `docs/architecture/TARGET_STATE.md`
- `docs/architecture/GUARDRAILS.md`
- `docs/architecture/MIGRATION_QUEUE.md`
- any task-specific file list

## Scope

List exactly what Claude is allowed to change.

## Allowed Files

- `...`
- `...`

## Forbidden Files

- `...`
- `...`

## Definition Of Done

- concrete requirement 1
- concrete requirement 2
- concrete requirement 3

## Review Risks To Watch

- auth
- secrets
- ownership
- data boundary
- migration drift

## Stop And Report If

- the task requires schema changes outside scope
- the task requires auth changes not listed
- the task would force an internal rename
- the task touches shared files owned by another active task

## Output Format

At the end, report:
- what changed
- what did not change
- files touched
- anything that feels architecturally wrong or blocked

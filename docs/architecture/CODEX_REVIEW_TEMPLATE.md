# Codex Review Template

Use this after Claude finishes a bounded task.

---

## Review Scope

Task id:

Files touched:

## Findings First

List issues in severity order.

Format:
- severity
- file/path
- what is wrong
- why it matters for GroundworX migration

## What Landed Well

- note what aligns with target state
- note what remains reusable

## Drift Check

Answer:
- did the task widen scope?
- did it violate guardrails?
- did it make overnight execution safer or riskier?

## Follow-Up Recommendation

Choose one:
- merge as-is
- revise before merge
- split into follow-up tasks
- stop and re-plan

## CURRENT_STATE Update Needed?

- yes / no
- if yes, what behavior changed?

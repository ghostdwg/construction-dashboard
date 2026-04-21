# Guardrails
# GroundworX Migration + Overnight Work Rules

---

## Purpose

These rules exist to keep `construction-dashboard` moving toward GroundworX
without losing the working bid workflow, breaking data boundaries, or creating
unreviewable overnight changes.

These rules apply to:
- Codex
- Claude Code
- any overnight automation or background worker

When a rule conflicts with a convenience shortcut, the rule wins.

---

## Core Principles

1. Preserve working internals before renaming surfaces.
2. Prefer additive migration over destructive refactor.
3. Make background work durable before making it autonomous.
4. Keep product direction, implementation, and review as separate steps.
5. Never trade security or data boundaries for speed.

---

## Current Identity Rule

Until an explicit migration task says otherwise:

- Internal code may continue to use `Bid`, `bids`, and existing route names.
- User-facing copy may move toward `GroundworX`, `Projects`, and `Glint`.
- Do not mass-rename core models or folders during feature work.

This repo is a migration, not a rewrite.

---

## Non-Negotiable Data Boundaries

1. `EstimateUpload.pricingData` must never be returned to the client.
2. `EstimateUpload.pricingData` must never be included in any AI prompt.
3. Subcontractor identity fields that are internal-only must never be included in AI prompts or sub-facing exports.
4. `Subcontractor.isPreferred` is internal-only and must never leak to AI or outbound recipient artifacts.
5. Secret settings must not be exposed by API responses in plaintext after save.
6. Any future provider-key system must be admin-only and encrypted at rest.

---

## Auth And Access Rules

1. `AUTH_DISABLED=true` is development-only and must never be assumed by any automation.
2. Any settings mutation route must require authenticated admin access.
3. Any new admin page must be protected both in UI flow and in API enforcement.
4. GroundworX migration work must treat user isolation as a prerequisite for broad multi-user rollout.
5. Until Auth Wall B+C is complete, no feature may claim tenant-safe behavior unless it explicitly enforces ownership.

---

## Schema Rules

1. No destructive schema changes during unrelated feature work.
2. No rename of `Bid` or other core models without an explicit migration task.
3. Shared schema files may only have one active owner per task window.
4. All new background-job state must persist to the database, not process memory.
5. Any schema change must update `CURRENT_STATE.md` if it changes actual behavior.

---

## Background And Overnight Work Rules

1. No overnight job may rely on in-memory process state as its source of truth.
2. No overnight job may require browser polling to complete.
3. No overnight job may silently mutate user-visible records without audit metadata.
4. No overnight job may merge code, deploy, or run migrations automatically.
5. No overnight job may alter auth, secret storage, or data-boundary logic.
6. Overnight work must be resumable after process restart.
7. Every overnight run must produce a morning summary with:
   - jobs attempted
   - jobs completed
   - jobs failed
   - artifacts created
   - human review needed

---

## Collaboration Rules

1. Codex owns direction, task shaping, sequencing, and review.
2. Claude Code owns bounded implementation tasks.
3. One task, one owner, one primary file area.
4. Shared files like `prisma/schema.prisma`, `lib/auth.ts`, and access-control code require explicit ownership for the task window.
5. No overlapping edits in shared files by multiple agents at the same time.
6. If implementation discovers architectural conflict, stop and report instead of widening scope.

---

## Session Rules

Each implementation session must have:
- a task id
- a goal
- allowed files
- forbidden files
- a definition of done
- a note about what changed in `CURRENT_STATE.md` if behavior changed

Do not run open-ended “continue building” sessions.

---

## Review Rules

Every completed implementation task should be reviewed for:
- scope drift
- security regressions
- auth/access mistakes
- boundary violations
- migration consistency with GroundworX direction
- suitability for future overnight automation

---

## Safe First Overnight Jobs

Allowed first:
- refresh stale bid intelligence briefs
- complete queued spec-analysis jobs
- generate submittal seeds from completed analysis
- generate superintendent briefing packets
- summarize AI usage and failed jobs
- identify records stuck in generating/error states

Not allowed first:
- schema migrations
- auth changes
- provider secret rewrites
- route renames
- code merges
- production deploy steps

---

## Stop Conditions

Stop and ask for review when:
- a task needs changes in both auth and schema
- a task needs to rename working internals
- a task changes how secrets are stored or resolved
- a task affects both app and sidecar contracts
- a task can no longer stay inside its assigned file boundaries

---

## Definition Of Success

The migration is succeeding when:
- the repo remains stable for current workflows
- GroundworX direction becomes clearer with each task
- auth and settings become safer, not looser
- background work becomes durable before it becomes autonomous
- morning summaries become more important than manual prompting

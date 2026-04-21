# Target State
# GroundworX Migration Target

---

## Purpose

This document defines what the product is becoming.

It is not a wishlist and it is not a rewrite spec. It is the target state that
the current `construction-dashboard` repo should migrate toward in bounded,
reviewable steps.

---

## Product Position

GroundworX is the commercial construction intelligence and job setup platform
for GC project managers.

It serves the same user in two moments:

1. Pre-award:
   intelligence, pursuit, scope clarity, leveling, procurement risk
2. Post-award:
   handoff, submittals, schedule, meetings, field briefing, closeout setup

The existing repo already contains most of this capability. The migration goal
is to align naming, access control, settings, automation, and execution model
with that product direction.

---

## What Must Stay Stable

These are current strengths to preserve:

- the `Bid`-centric workflow and existing domain model
- the detailed tabbed/project lifecycle already implemented
- the AI-assisted analysis surfaces
- the sidecar-backed document intelligence pipeline
- the post-award handoff, submittals, schedule, meetings, and briefing stack
- Procore bridge work already completed

GroundworX should emerge from this system, not replace it abruptly.

---

## Product Surface Direction

User-facing direction:

- product name: `GroundworX`
- company name: `NeuroGlitch`
- AI assistant name: `Glint`
- user-facing “Bids” surface gradually becomes “Projects” where appropriate
- user-facing navigation should reflect the full lifecycle, not just pursuit

Internal direction:

- keep `Bid` and working internals until explicit migration tasks replace them
- do not force broad internal renames before auth, settings, and automation are stable

---

## Operational Target State

GroundworX should have:

1. Admin-controlled settings
2. Encrypted provider credentials
3. Durable background jobs
4. Structured AI usage and automation observability
5. User/role isolation suitable for more than one operator
6. Safe overnight execution for bounded tasks

---

## Auth Target State

Target roles:

- `admin`
  - full settings access
  - all projects
  - operational and automation controls
- `gc_user`
  - GroundworX project workflow only
  - scoped access to owned/allowed projects

Migration stance:

- current Auth Wall A is a foundation, not the end state
- role checks must move from implied UI behavior to enforced route/API behavior
- ownership must be enforced in query paths before multi-user rollout

---

## Settings Target State

The settings area should become the GroundworX operations console.

It must support:
- admin-only access
- encrypted provider credential storage
- provider routing controls
- usage/cost visibility
- integration status checks
- audit logging for credential changes

The current generic `AppSetting` system is acceptable for non-secret config and
single-operator development, but it is not the long-term secret-management
architecture.

---

## AI Target State

GroundworX should support a task-oriented AI layer, not only feature-specific
prompt calls.

That means:
- existing AI feature services remain usable as workers
- a higher-level task system decides when and why they run
- outputs are stored as durable artifacts
- AI activity is observable and reviewable

Examples of worker capabilities already present:
- bid intelligence generation
- spec intelligence
- schedule intelligence
- meeting analysis
- superintendent briefing generation
- submittal generation and cross-reference analysis

---

## Overnight Work Target State

Overnight work should be:
- bounded
- durable
- resumable
- auditable
- reviewable in the morning

It should not depend on:
- browser sessions
- in-memory sidecar job state
- manual polling
- implicit local dev assumptions

The overnight system should operate from a durable task ledger and produce a
morning summary.

---

## First-Class Automation Targets

These are the first jobs GroundworX should run overnight:

1. refresh stale intelligence briefs
2. complete queued document analysis jobs
3. generate or refresh submittal artifacts after new analysis
4. generate superintendent briefing packets for active project-mode records
5. summarize AI usage, failed jobs, and stale records

These jobs should run from durable task records, not direct UI triggers.

---

## Architecture Target State

The app should evolve toward three layers:

1. Product layer
   - app UI
   - user-facing workflows
   - admin settings

2. Worker layer
   - existing AI/domain services
   - sidecar analysis endpoints
   - artifact generation

3. Orchestration layer
   - durable task/job records
   - scheduling
   - retries
   - audit trail
   - morning summaries

The biggest missing layer today is orchestration.

---

## Migration Priorities

The next major moves should optimize for safety and leverage:

1. admin-only settings enforcement
2. encrypted provider credential architecture
3. durable background job model
4. ownership and role enforcement for multi-user access
5. GroundworX naming and navigation alignment
6. overnight automation for safe bounded jobs

---

## Out Of Scope For Early Migration

Do not treat these as phase-one requirements:

- mass internal renaming of `Bid` to `Project`
- full tenant/org model redesign before ownership basics exist
- autonomous overnight code editing in the repo
- broad visual redesign before operational foundations are stable
- production-grade agent teams before durable job execution exists

---

## Definition Of Target-State Progress

We are moving in the right direction when:
- the repo keeps shipping without losing existing value
- GroundworX naming becomes more coherent at the surface
- admin and secret handling become stricter
- background work becomes durable and resumable
- overnight jobs reduce manual prompting
- each migration task leaves the architecture cleaner than it found it

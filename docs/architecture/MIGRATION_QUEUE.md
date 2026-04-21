# Migration Queue
# Construction Dashboard -> GroundworX

---

## How To Use This File

Each task should be:
- bounded
- owned by one agent
- limited to clear file areas
- reviewable in one pass

Statuses:
- `ready`
- `in_progress`
- `blocked`
- `done`

Owners:
- `Codex`
- `Claude`
- `Shared` only when explicitly coordinated

---

## In Progress

None yet.

---

## Ready

### GWX-001
- Status: `ready`
- Owner: `Codex`
- Title: Rewrite architecture docs around migration, not greenfield planning
- Goal: align repo docs with what is actually built and where GroundworX is heading
- Allowed files:
  - `docs/architecture/CURRENT_STATE.md`
  - `docs/architecture/TARGET_STATE.md`
  - `docs/architecture/GUARDRAILS.md`
  - `docs/architecture/MIGRATION_QUEUE.md`
- Forbidden files:
  - `prisma/schema.prisma`
  - `app/**`
  - `sidecar/**`
- Definition of done:
  - docs distinguish current state from target state
  - migration priorities are explicit
  - overnight work assumptions are grounded in current architecture

### GWX-002
- Status: `done`
- Owner: `Claude`
- Title: Enforce admin-only access for settings routes and pages

### GWX-003
- Status: `done`
- Owner: `Claude`
- Title: Add durable background job model

### GWX-004
- Status: `done`
- Owner: `Claude`
- Title: Replace plaintext AI credential handling with encrypted provider records

### GWX-005
- Status: `done`
- Owner: `Claude`
- Title: First automation-triggered durable overnight job
- Completed: 2026-04-22
- What changed:
  - `lib/services/jobs/backgroundJobService.ts`: added `findActiveJobForBid` — returns most recent queued/running job for a bid+type; used for duplicate-run detection
  - `lib/services/jobs/specAnalysisAutomation.ts`: new shared service — `triggerSpecAnalysis(bidId, opts)` encapsulates the full spec analysis trigger path (prerequisite check → duplicate guard → `createJob` → sidecar POST → `startJob`). Returns a typed `TriggerOutcome` (`triggered | skipped`); throws `TriggerError` on hard failures. `TriggerError` carries an `httpStatus` so both caller routes format their own Response.
  - `app/api/bids/[id]/specbook/analyze/route.ts`: POST handler slimmed to call `triggerSpecAnalysis`; returns 409 if a job is already active
  - `app/api/automation/spec-analysis/route.ts`: new admin-only endpoint — `POST /api/automation/spec-analysis { bidId, tier? }`. Checks `isAdminAuthorized()`, calls `triggerSpecAnalysis` with `triggerSource: "automation"`. Returns `{ status: "triggered" | "skipped", ... }`. Completion still flows through existing sidecar webhook.
- Guardrails: skips if `SpecBook.status !== "ready"` or no split sections; skips if queued/running job already exists for same bid
- No schema migration required — `BackgroundJob.triggerSource` already exists

### GWX-005.1
- Status: `done`
- Owner: `Claude`
- Title: Atomic duplicate prevention for BackgroundJob
- Completed: 2026-04-22
- What changed:
  - `prisma/schema.prisma`: `BackgroundJob.activeSlot Int? @default(1)` + `@@unique([bidId, jobType, activeSlot])`
  - `lib/services/jobs/backgroundJobService.ts`: `completeJob` and `failJob` set `activeSlot: null` to release the unique slot
  - `lib/services/jobs/specAnalysisAutomation.ts`: catches `P2002` on `createJob` and returns `TriggerOutcome { status: "skipped" }` for the concurrent-trigger race path

### GWX-005.2
- Status: `superseded`
- Owner: `Claude`
- Title: Reconcile activeSlot migration history (patched, then replaced by GWX-005.4)
- Note: attempted fresh-replay fix by editing applied migration files — superseded by the cleaner GWX-005.4 baseline approach

### GWX-005.3
- Status: `superseded`
- Owner: `Claude`
- Title: Restore immutable migration history (analysis only)
- Note: concluded that the migration chain could not be made pristine AND replay-safe without editing at least one applied migration. Recommended the GWX-005.4 baseline strategy.

### GWX-005.5
- Status: `done`
- Owner: `Claude`
- Title: Existing-database repair runbook for activeSlot baseline replacement
- Completed: 2026-04-24
- What changed:
  - `docs/architecture/CURRENT_STATE.md`: added "Existing-Database Repair Runbook (GWX-005.5)" section under the Durable Background Job System block — step-by-step SQL commands, a DB-state decision table, and an explicit note that repair is manual and environment-by-environment
- Scope: documentation only — no schema changes, no runtime changes
- Runbook covers: how to detect whether a DB needs repair (query `_prisma_migrations` for `%active_slot%` rows), how to remove the two deleted migration records via `prisma db execute`, how to mark the replacement migration applied via `prisma migrate resolve --applied`, and what `prisma migrate status` should report afterward

### GWX-005.4
- Status: `done`
- Owner: `Claude`
- Title: Clean Prisma migration baseline for activeSlot
- Completed: 2026-04-24
- What changed:
  - Deleted `prisma/migrations/20260421031417_background_job_active_slot/` — Prisma-auto-generated RedefineTables that had a timestamp ordering bug causing fresh-replay failure; had been edited (GWX-005.2) creating checksum drift
  - Deleted `prisma/migrations/20260423000001_background_job_active_slot/` — hand-written ADD COLUMN that had also been edited (GWX-005.2) creating checksum drift
  - Deleted their `_prisma_migrations` rows via `prisma db execute`
  - Created `prisma/migrations/20260424000001_background_job_active_slot/migration.sql` — single canonical replacement: `ALTER TABLE "BackgroundJob" ADD COLUMN "activeSlot" INTEGER DEFAULT 1`, terminal-job backfill UPDATE, `CREATE UNIQUE INDEX`; SQL verified via `prisma migrate diff`
  - Marked new migration as applied on dev DB: `prisma migrate resolve --applied 20260424000001_background_job_active_slot`
- Migration state: 58 migrations, no checksum drift, no edited applied files, `prisma migrate status` → "Database schema is up to date!"
- Fresh-DB replay: runs all 58 migrations in order — `20260424000001` is the terminal one and runs cleanly
- Existing DBs: `activeSlot` already present; marked applied without re-running; no data loss

### GWX-006
- Status: `ready`
- Owner: `Claude`
- Title: Add audit metadata for automation-triggered writes
- Goal: make unattended changes reviewable and attributable
- Allowed files:
  - `prisma/schema.prisma`
  - relevant write services
  - relevant API routes
- Forbidden files:
  - major UI work
- Definition of done:
  - automation-triggered writes can be distinguished from manual writes
  - basic audit trail is queryable

### GWX-INTEGRATE-001
- Status: `done`
- Owner: `Claude`
- Title: Integrate existing capabilities into a coherent GroundworX operating surface
- Completed: 2026-04-24
- What changed:
  - `app/layout.tsx`: metadata title → "GroundworX", description → "Construction Intelligence Platform"; global nav brand → "GroundworX" with emerald X accent; "Bids" nav link → "Projects" (route unchanged, user-facing copy only)
  - `app/bids/[id]/TabBar.tsx`: brand mark → "GroundworX" (no icon); hub items organized under mono uppercase section dividers — PURSUE / DELIVER / CLOSEOUT; removed decorative icon coloring (emerald left-border accent is now the only active state indicator, per GroundworX signal-color rule)
  - `app/bids/[id]/tabConfig.ts`: all subtab display labels updated to uppercase mono — DOCS, TRADES, SUBS, SCOPE, INTELLIGENCE, QUESTIONS, LEVELING, ACTIVITY, HANDOFF, SUBMITTALS, SCHEDULE, MEETINGS, BRIEFING, PROCORE, WARRANTIES, TRAINING, INSPECTIONS, CLOSEOUT. Tab key values unchanged.
  - `app/bids/[id]/SubTabBar.tsx`: tab buttons now use `text-[11px] font-mono tracking-wide` for the mono label treatment; tighter resting contrast (zinc-400/zinc-500 rather than zinc-500/zinc-400)
  - `app/bids/[id]/page.tsx`: compact project state strip added at top of Overview section (bid status + projectType + workflowType chips, 9px mono uppercase); Intelligence Brief section header replaced with "Glint Intelligence" divider (surfaces the Glint AI assistant name per TARGET_STATE.md)
  - `app/bids/[id]/JobHistoryPanel.tsx`: full restyling to GroundworX overnight jobs surface rules — left-border accent per status (emerald=complete, red=failed, blue=running, zinc=queued/cancelled), all labels in 10–11px font-mono uppercase, panel header uses 9px mono section label style, status counts (active/failed) are mono color chips rather than colored pills
- No route changes, no schema changes, no internal model renames

### GWX-007
- Status: `done`
- Owner: `Claude`
- Title: Morning summary panel for durable overnight jobs
- Completed: 2026-04-24
- What changed:
  - `app/api/bids/[id]/jobs/route.ts`: new `GET /api/bids/[id]/jobs` endpoint — calls `listJobsForBid(bidId, 20)`, returns `{ jobs: [...] }`. Reads from durable DB state; no sidecar dependency.
  - `app/bids/[id]/JobHistoryPanel.tsx`: new client component. Fetches the jobs endpoint, renders a collapsible panel on the Overview tab. Each row shows: status badge (color-coded), job type (human-readable label), trigger source (User / Automation / Webhook), duration (if terminal), created timestamp, and result or error summary. Auto-opens if any job is failed or automation-triggered (morning review signal). Renders nothing if no jobs exist for the bid.
  - `app/bids/[id]/page.tsx`: added `JobHistoryPanel` import and mounted it at the bottom of the Overview tab section (after Intelligence Brief).
- Runtime: no schema changes, no sidecar changes, no new service methods — reuses `listJobsForBid` from `backgroundJobService.ts`

---

### GWX-004
- Status: `done`
- Owner: `Claude`
- Title: Encrypted provider credentials
- Completed: 2026-04-22
- What changed:
  - `lib/services/settings/crypto.ts`: new module — `encryptSetting` / `decryptSetting` / `isEncrypted` / `keyConfigured` using AES-256-GCM
  - `lib/services/settings/appSettingsService.ts`: `setSetting` encrypts secret values before DB write; `loadCache` decrypts secret values on read; legacy plaintext rows lazily re-encrypted on first cache load if key is present
  - `prisma/schema.prisma`: updated `AppSetting` comment to reflect encryption format and env var behavior
- Env var: `SETTINGS_ENCRYPTION_KEY` — any string (hashed to 32 bytes internally); if absent, secret writes are blocked in normal mode (see GWX-004.1)
- No schema migration required — existing `value` column stores the `enc:v1:...` sentinel as a plain string
- GWX-004.1 (2026-04-22): `setSetting()` now fails closed — secret writes throw when key is missing unless `AUTH_DISABLED=true`

---

## Blocked

### GWX-008
- Status: `blocked`
- Owner: `Shared`
- Title: Ownership enforcement for multi-user GroundworX access
- Blocker: depends on deciding the exact user/role model for `admin` vs `gc_user`
- Notes:
  - current repo has Auth Wall A
  - ownership exists only partially
  - do not claim tenant safety before this is complete

### GWX-009
- Status: `blocked`
- Owner: `Shared`
- Title: Rename user-facing bids workflow to projects workflow
- Blocker: should wait until auth, settings, and overnight architecture are stable
- Notes:
  - surface copy can evolve earlier
  - broad route/model renames should not happen yet

---

## Done

### GWX-003
- Status: `done`
- Owner: `Claude`
- Title: Add durable background job model
- Completed: 2026-04-21
- What changed:
  - `prisma/schema.prisma`: `BackgroundJob` model + `Bid.backgroundJobs` relation
  - `prisma/migrations/20260421022733_add_background_job/`: SQL migration applied
  - `lib/services/jobs/backgroundJobService.ts`: createJob / startJob / completeJob / failJob / getJob / findJobByExternalId / listJobsForBid
  - `app/api/jobs/[id]/route.ts`: GET — DB-only job status, survives sidecar restart
  - `app/api/bids/[id]/specbook/analyze/route.ts`: POST creates queued job, moves to running+externalJobId after sidecar accepts; marks failed on sidecar error
  - `app/api/bids/[id]/specbook/analyze/complete/route.ts`: webhook closes job as complete or failed; best-effort (webhook does not error over DB failures)
- Sidecar unchanged — in-memory dict still drives live polling; DB is the durability layer

---

### GWX-002
- Status: `done`
- Owner: `Claude`
- Title: Enforce admin-only access for settings routes and pages
- Completed: 2026-04-20
- What changed:
  - `lib/auth.ts`: added `isAdminAuthorized()` helper (AUTH_DISABLED bypass → admin, no session → 401, non-admin role → 403)
  - `proxy.ts`: redirects authenticated non-admin users away from `/settings` pages at middleware level
  - `app/settings/page.tsx`: server-side admin check, redirects to /login (401) or / (403)
  - All 5 `app/api/settings/**` routes: each handler returns 401/403 JSON before touching any data

---

- Added collaboration operating docs:
  - `GUARDRAILS.md`
  - `TARGET_STATE.md`
  - `MIGRATION_QUEUE.md`
  - `CLAUDE_TASK_TEMPLATE.md`
  - `CODEX_REVIEW_TEMPLATE.md`

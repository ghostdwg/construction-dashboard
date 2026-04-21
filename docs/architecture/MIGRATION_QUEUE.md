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

### GWX-007
- Status: `ready`
- Owner: `Claude`
- Title: Introduce a morning summary artifact for durable jobs
- Goal: shift overnight work from hidden background behavior to explicit review output
- Allowed files:
  - job/task services
  - reporting helpers
  - minimal UI or API surface for summary retrieval
- Forbidden files:
  - unrelated workflow logic
- Definition of done:
  - overnight job results can be summarized in one place
  - failures and review-needed items are visible

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

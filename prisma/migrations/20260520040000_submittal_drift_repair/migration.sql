-- Phase O1.1 — Submittal drift repair
--
-- Five columns existed in prisma/schema.prisma but no migration created
-- them. Cause: schema edits on feat/market-intelligence at the start of
-- the MI stack were never accompanied by a `prisma migrate dev` invocation,
-- so the migration history fell out of sync with the live schema.
--
-- Symptoms before this repair:
--   * `prisma migrate deploy` against a fresh DB succeeded
--   * but `prisma migrate diff --from-migrations ... --to-schema ...`
--     reported five missing columns
--   * `prisma migrate dev` (which auto-creates diff migrations) was
--     producing this exact ALTER TABLE block on every phase since MI-1,
--     and each phase's migration.sql had to be hand-stripped to remove
--     it (otherwise every MI migration would duplicate the same ALTER)
--
-- Columns are load-bearing (used by lib/services/submittal/organizeWithAi.ts
-- and app/api/bids/[id]/submittals/packages/route.ts), so removing them
-- from schema.prisma would break runtime. The correct fix is to commit
-- the migration that was always missing.
--
-- All five columns are nullable, so this migration is safe to apply
-- against any existing DB (staging / production where the columns may
-- already have been added out-of-band will get the same nullable
-- columns; pre-existing values are preserved).

-- AlterTable
ALTER TABLE "SubmittalItem" ADD COLUMN "priority" TEXT;
ALTER TABLE "SubmittalItem" ADD COLUMN "releasePhase" TEXT;

-- AlterTable
ALTER TABLE "SubmittalPackage" ADD COLUMN "releasePhase" TEXT;
ALTER TABLE "SubmittalPackage" ADD COLUMN "requiredReturnDate" DATETIME;
ALTER TABLE "SubmittalPackage" ADD COLUMN "targetIssueDate" DATETIME;

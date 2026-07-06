-- Add a source-level duplicate key for jobs that are not scoped by bidId.
-- Active rows hold activeSlot=1; terminal rows clear it to NULL, and SQLite
-- permits multiple NULL values in a unique index.

ALTER TABLE "BackgroundJob" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "BackgroundJob_dedupeKey_activeSlot_key"
ON "BackgroundJob"("dedupeKey", "activeSlot");

CREATE INDEX "BackgroundJob_dedupeKey_idx"
ON "BackgroundJob"("dedupeKey");

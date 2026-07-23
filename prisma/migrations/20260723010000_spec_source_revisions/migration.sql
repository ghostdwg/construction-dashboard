-- Closeout Card 1A: additive, nullable revision metadata for existing source
-- tables. Historic rows are intentionally not rewritten and unknown hashes
-- remain NULL; the application backfill performs explicit, replay-safe work.

ALTER TABLE "SpecBook" ADD COLUMN "revisionIndex" INTEGER;
ALTER TABLE "SpecBook" ADD COLUMN "issueLabel" TEXT;
ALTER TABLE "SpecBook" ADD COLUMN "issueDate" DATETIME;
ALTER TABLE "SpecBook" ADD COLUMN "effectiveState" TEXT;
ALTER TABLE "SpecBook" ADD COLUMN "effectiveAt" DATETIME;
ALTER TABLE "SpecBook" ADD COLUMN "effectiveBy" TEXT;
ALTER TABLE "SpecBook" ADD COLUMN "supersedesSpecBookId" INTEGER
  REFERENCES "SpecBook" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SpecBook" ADD COLUMN "sha256" TEXT;
ALTER TABLE "SpecBook" ADD COLUMN "byteSize" INTEGER;
ALTER TABLE "SpecBook" ADD COLUMN "mimeType" TEXT;
ALTER TABLE "SpecBook" ADD COLUMN "immutableId" TEXT;
ALTER TABLE "SpecBook" ADD COLUMN "activeSlot" INTEGER;

CREATE UNIQUE INDEX "SpecBook_bidId_revisionIndex_key"
ON "SpecBook"("bidId", "revisionIndex");
CREATE UNIQUE INDEX "SpecBook_bidId_activeSlot_key"
ON "SpecBook"("bidId", "activeSlot");
CREATE INDEX "SpecBook_bidId_effectiveState_idx"
ON "SpecBook"("bidId", "effectiveState");
CREATE INDEX "SpecBook_supersedesSpecBookId_idx"
ON "SpecBook"("supersedesSpecBookId");
CREATE INDEX "SpecSection_specBookId_csiNumber_idx"
ON "SpecSection"("specBookId", "csiNumber");

ALTER TABLE "AddendumUpload" ADD COLUMN "revisionIndex" INTEGER;
ALTER TABLE "AddendumUpload" ADD COLUMN "effectiveState" TEXT;
ALTER TABLE "AddendumUpload" ADD COLUMN "supersedesAddendumId" INTEGER
  REFERENCES "AddendumUpload" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AddendumUpload" ADD COLUMN "sha256" TEXT;
ALTER TABLE "AddendumUpload" ADD COLUMN "byteSize" INTEGER;
ALTER TABLE "AddendumUpload" ADD COLUMN "mimeType" TEXT;
ALTER TABLE "AddendumUpload" ADD COLUMN "immutableId" TEXT;
ALTER TABLE "AddendumUpload" ADD COLUMN "activeSlot" INTEGER;

CREATE UNIQUE INDEX "AddendumUpload_bidId_addendumNumber_revisionIndex_key"
ON "AddendumUpload"("bidId", "addendumNumber", "revisionIndex");
CREATE UNIQUE INDEX "AddendumUpload_bidId_addendumNumber_activeSlot_key"
ON "AddendumUpload"("bidId", "addendumNumber", "activeSlot");
CREATE INDEX "AddendumUpload_bidId_effectiveState_idx"
ON "AddendumUpload"("bidId", "effectiveState");
CREATE INDEX "AddendumUpload_supersedesAddendumId_idx"
ON "AddendumUpload"("supersedesAddendumId");

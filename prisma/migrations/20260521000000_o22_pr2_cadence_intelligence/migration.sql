-- Phase O2.2 PR2 — Cadence Intelligence schema additions.
--
-- Additive-only:
--   * MarketSource gains three cadence-governance columns. All existing
--     rows get default values (publishStatus='HEALTHY', consecutiveEmptyRuns=0,
--     lastEmptyRunAt=NULL).
--   * MarketSourceCadenceSample is a new table — rolling sample of doc dates
--     per source for cadence learning. Cascade-deletes with the parent source.
--
-- Backward-compatible: pre-existing readers/writers of MarketSource and
-- MarketSourceDoc are unaffected. The new columns are read by
-- lib/services/marketIntelligence/sourceCadence.ts (PR2) and consumed by
-- the future municipal-agenda-ingestion runner (PR5).

-- AlterTable
ALTER TABLE "MarketSource" ADD COLUMN "publishStatus" TEXT NOT NULL DEFAULT 'HEALTHY';
ALTER TABLE "MarketSource" ADD COLUMN "consecutiveEmptyRuns" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketSource" ADD COLUMN "lastEmptyRunAt" DATETIME;

-- CreateTable
CREATE TABLE "MarketSourceCadenceSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "docDate" DATETIME NOT NULL,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketSourceCadenceSample_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MarketSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MarketSourceCadenceSample_sourceId_docDate_idx" ON "MarketSourceCadenceSample"("sourceId", "docDate");

-- CreateIndex
CREATE INDEX "MarketSource_publishStatus_idx" ON "MarketSource"("publishStatus");

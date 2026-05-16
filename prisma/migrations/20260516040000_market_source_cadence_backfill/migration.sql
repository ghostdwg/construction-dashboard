-- Add publish-cadence learning + smart-polling + backfill tracking columns to MarketSource.
ALTER TABLE "MarketSource" ADD COLUMN "publishCadenceDays" INTEGER;
ALTER TABLE "MarketSource" ADD COLUMN "cadenceConfidence" TEXT;
ALTER TABLE "MarketSource" ADD COLUMN "cadenceSampleSize" INTEGER;
ALTER TABLE "MarketSource" ADD COLUMN "lastDocSeenAt" DATETIME;
ALTER TABLE "MarketSource" ADD COLUMN "nextExpectedAt" DATETIME;
ALTER TABLE "MarketSource" ADD COLUMN "backfillYears" INTEGER;
ALTER TABLE "MarketSource" ADD COLUMN "backfillCompletedAt" DATETIME;

CREATE INDEX "MarketSource_nextExpectedAt_idx" ON "MarketSource"("nextExpectedAt");

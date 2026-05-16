-- Phase 5K: explicit signal subtype + watch-next-meeting date
ALTER TABLE "MarketSignal" ADD COLUMN "signalSubtype" TEXT;
ALTER TABLE "MarketSignal" ADD COLUMN "nextMeetingDate" DATETIME;
CREATE INDEX "MarketSignal_signalSubtype_idx" ON "MarketSignal"("signalSubtype");
CREATE INDEX "MarketSignal_nextMeetingDate_idx" ON "MarketSignal"("nextMeetingDate");

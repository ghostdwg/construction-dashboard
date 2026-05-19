-- MarketSource: per-source tuning knobs
ALTER TABLE "MarketSource" ADD COLUMN "dateFrom" DATETIME;
ALTER TABLE "MarketSource" ADD COLUMN "dateTo" DATETIME;
ALTER TABLE "MarketSource" ADD COLUMN "minRelevanceScore" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "MarketSource" ADD COLUMN "minEstimatedValue" REAL;
ALTER TABLE "MarketSource" ADD COLUMN "projectTypeAllowlist" TEXT;

-- MarketSourceDoc: raw text persistence + cache-buster handling
ALTER TABLE "MarketSourceDoc" ADD COLUMN "docUrlFull" TEXT;
ALTER TABLE "MarketSourceDoc" ADD COLUMN "title" TEXT;
ALTER TABLE "MarketSourceDoc" ADD COLUMN "rawText" TEXT;
ALTER TABLE "MarketSourceDoc" ADD COLUMN "charCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "MarketSourceDoc_documentDate_idx" ON "MarketSourceDoc"("documentDate");

-- MarketLead: backlink to source doc
ALTER TABLE "MarketLead" ADD COLUMN "sourceDocId" TEXT REFERENCES "MarketSourceDoc"("id") ON DELETE SET NULL;
CREATE INDEX "MarketLead_sourceDocId_idx" ON "MarketLead"("sourceDocId");

-- MarketSignal: backlink to source doc
ALTER TABLE "MarketSignal" ADD COLUMN "sourceDocId" TEXT REFERENCES "MarketSourceDoc"("id") ON DELETE SET NULL;
CREATE INDEX "MarketSignal_sourceDocId_idx" ON "MarketSignal"("sourceDocId");

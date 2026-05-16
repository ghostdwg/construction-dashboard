-- MarketDocAnalysis: one row per on-demand engine analysis of a scraped doc.
CREATE TABLE "MarketDocAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "docId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "durationMs" INTEGER,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "signalsCount" INTEGER NOT NULL DEFAULT 0,
    "leadsCount" INTEGER NOT NULL DEFAULT 0,
    "rawResponseJson" TEXT,
    "errorMessage" TEXT,
    "triggerSource" TEXT NOT NULL DEFAULT 'user',
    CONSTRAINT "MarketDocAnalysis_docId_fkey" FOREIGN KEY ("docId") REFERENCES "MarketSourceDoc" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MarketDocAnalysis_docId_idx" ON "MarketDocAnalysis"("docId");
CREATE INDEX "MarketDocAnalysis_engine_idx" ON "MarketDocAnalysis"("engine");
CREATE INDEX "MarketDocAnalysis_requestedAt_idx" ON "MarketDocAnalysis"("requestedAt");

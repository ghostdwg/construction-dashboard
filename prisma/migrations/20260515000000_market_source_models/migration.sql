-- CreateTable
CREATE TABLE "MarketSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'city_council',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastScannedAt" DATETIME,
    "docsProcessed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketSourceDoc" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "docUrl" TEXT NOT NULL,
    "scannedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signalsFound" INTEGER NOT NULL DEFAULT 0,
    "jurisdiction" TEXT,
    "documentDate" DATETIME,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "error" TEXT,
    CONSTRAINT "MarketSourceDoc_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MarketSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MarketSource_sourceType_idx" ON "MarketSource"("sourceType");

-- CreateIndex
CREATE INDEX "MarketSource_isActive_idx" ON "MarketSource"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSourceDoc_sourceId_docUrl_key" ON "MarketSourceDoc"("sourceId", "docUrl");

-- CreateIndex
CREATE INDEX "MarketSourceDoc_sourceId_idx" ON "MarketSourceDoc"("sourceId");

-- CreateIndex
CREATE INDEX "MarketSourceDoc_scannedAt_idx" ON "MarketSourceDoc"("scannedAt");

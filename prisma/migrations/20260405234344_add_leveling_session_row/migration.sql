-- CreateTable
CREATE TABLE "LevelingSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LevelingSession_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LevelingRow" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "estimateUploadId" INTEGER NOT NULL,
    "tradeId" INTEGER,
    "division" TEXT NOT NULL DEFAULT '',
    "scopeText" TEXT NOT NULL,
    "scopeHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unreviewed',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LevelingRow_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LevelingSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LevelingRow_estimateUploadId_fkey" FOREIGN KEY ("estimateUploadId") REFERENCES "EstimateUpload" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LevelingRow_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LevelingSession_bidId_key" ON "LevelingSession"("bidId");

-- CreateIndex
CREATE UNIQUE INDEX "LevelingRow_estimateUploadId_scopeHash_key" ON "LevelingRow"("estimateUploadId", "scopeHash");

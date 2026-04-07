-- CreateTable
CREATE TABLE "AddendumUpload" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "addendumNumber" INTEGER NOT NULL,
    "addendumDate" DATETIME,
    "fileName" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "extractedText" TEXT,
    CONSTRAINT "AddendumUpload_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BidIntelligenceBrief" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "whatIsThisJob" TEXT,
    "howItGetsBuilt" TEXT,
    "riskFlags" TEXT,
    "assumptionsToResolve" TEXT,
    "addendumSummary" TEXT,
    "addendumCount" INTEGER NOT NULL DEFAULT 0,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "sourceContext" TEXT,
    "triggeredBy" TEXT,
    CONSTRAINT "BidIntelligenceBrief_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BidIntelligenceBrief_bidId_key" ON "BidIntelligenceBrief"("bidId");

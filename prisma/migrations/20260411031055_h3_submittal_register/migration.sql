-- CreateTable
CREATE TABLE "SubmittalItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "bidTradeId" INTEGER,
    "specSectionId" INTEGER,
    "submittalNumber" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requiredBy" DATETIME,
    "requestedAt" DATETIME,
    "receivedAt" DATETIME,
    "reviewedAt" DATETIME,
    "approvedAt" DATETIME,
    "responsibleSubId" INTEGER,
    "reviewer" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubmittalItem_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubmittalItem_bidTradeId_fkey" FOREIGN KEY ("bidTradeId") REFERENCES "BidTrade" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SubmittalItem_specSectionId_fkey" FOREIGN KEY ("specSectionId") REFERENCES "SpecSection" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SubmittalItem_responsibleSubId_fkey" FOREIGN KEY ("responsibleSubId") REFERENCES "Subcontractor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SubmittalItem_bidId_idx" ON "SubmittalItem"("bidId");

-- CreateIndex
CREATE INDEX "SubmittalItem_specSectionId_idx" ON "SubmittalItem"("specSectionId");

-- CreateIndex
CREATE INDEX "SubmittalItem_status_idx" ON "SubmittalItem"("status");

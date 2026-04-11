-- CreateTable
CREATE TABLE "BuyoutItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "bidTradeId" INTEGER NOT NULL,
    "subcontractorId" INTEGER,
    "committedAmount" REAL,
    "originalBidAmount" REAL,
    "contractStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "loiSentAt" DATETIME,
    "contractSentAt" DATETIME,
    "contractSignedAt" DATETIME,
    "poNumber" TEXT,
    "poIssuedAt" DATETIME,
    "changeOrderAmount" REAL DEFAULT 0,
    "paidToDate" REAL DEFAULT 0,
    "retainagePercent" REAL DEFAULT 5,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BuyoutItem_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BuyoutItem_bidTradeId_fkey" FOREIGN KEY ("bidTradeId") REFERENCES "BidTrade" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BuyoutItem_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BuyoutItem_bidTradeId_key" ON "BuyoutItem"("bidTradeId");

-- CreateIndex
CREATE INDEX "BuyoutItem_bidId_idx" ON "BuyoutItem"("bidId");

-- CreateIndex
CREATE INDEX "BuyoutItem_subcontractorId_idx" ON "BuyoutItem"("subcontractorId");

-- CreateTable
CREATE TABLE "SubmittalDistributionTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "bidTradeId" INTEGER,
    "responsibleContractor" TEXT,
    "submittalManager" TEXT,
    "reviewers" TEXT NOT NULL DEFAULT '[]',
    "distribution" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubmittalDistributionTemplate_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubmittalDistributionTemplate_bidTradeId_fkey" FOREIGN KEY ("bidTradeId") REFERENCES "BidTrade" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SubmittalDistributionTemplate_bidId_idx" ON "SubmittalDistributionTemplate"("bidId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmittalDistributionTemplate_bidId_bidTradeId_key" ON "SubmittalDistributionTemplate"("bidId", "bidTradeId");

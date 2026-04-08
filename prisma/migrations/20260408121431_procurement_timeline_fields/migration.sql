-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BidTrade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "tradeId" INTEGER NOT NULL,
    "scopeNotes" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'TIER2',
    "leadTimeDays" INTEGER,
    "rfqSentAt" DATETIME,
    "quotesReceivedAt" DATETIME,
    "rfqNotes" TEXT,
    CONSTRAINT "BidTrade_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BidTrade_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BidTrade" ("bidId", "id", "scopeNotes", "tradeId") SELECT "bidId", "id", "scopeNotes", "tradeId" FROM "BidTrade";
DROP TABLE "BidTrade";
ALTER TABLE "new_BidTrade" RENAME TO "BidTrade";
CREATE UNIQUE INDEX "BidTrade_bidId_tradeId_key" ON "BidTrade"("bidId", "tradeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

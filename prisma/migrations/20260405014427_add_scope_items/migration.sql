-- CreateTable
CREATE TABLE "ScopeItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "isRestricted" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScopeItem_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScopeTradeAssignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scopeItemId" INTEGER NOT NULL,
    "tradeId" INTEGER NOT NULL,
    CONSTRAINT "ScopeTradeAssignment_scopeItemId_fkey" FOREIGN KEY ("scopeItemId") REFERENCES "ScopeItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScopeTradeAssignment_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ScopeTradeAssignment_scopeItemId_tradeId_key" ON "ScopeTradeAssignment"("scopeItemId", "tradeId");

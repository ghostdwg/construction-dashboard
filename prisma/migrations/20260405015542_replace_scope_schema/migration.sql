/*
  Warnings:

  - You are about to drop the column `isRestricted` on the `ScopeItem` table. All the data in the column will be lost.
  - You are about to drop the column `sortOrder` on the `ScopeItem` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `ScopeItem` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ScopeItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "tradeId" INTEGER,
    "description" TEXT NOT NULL,
    "inclusion" BOOLEAN NOT NULL DEFAULT true,
    "specSection" TEXT,
    "drawingRef" TEXT,
    "notes" TEXT,
    "riskFlag" BOOLEAN NOT NULL DEFAULT false,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScopeItem_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScopeItem_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ScopeItem" ("bidId", "createdAt", "description", "id", "notes") SELECT "bidId", "createdAt", "description", "id", "notes" FROM "ScopeItem";
DROP TABLE "ScopeItem";
ALTER TABLE "new_ScopeItem" RENAME TO "ScopeItem";
CREATE TABLE "new_ScopeTradeAssignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scopeItemId" INTEGER NOT NULL,
    "tradeId" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScopeTradeAssignment_scopeItemId_fkey" FOREIGN KEY ("scopeItemId") REFERENCES "ScopeItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScopeTradeAssignment_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ScopeTradeAssignment" ("id", "scopeItemId", "tradeId") SELECT "id", "scopeItemId", "tradeId" FROM "ScopeTradeAssignment";
DROP TABLE "ScopeTradeAssignment";
ALTER TABLE "new_ScopeTradeAssignment" RENAME TO "ScopeTradeAssignment";
CREATE UNIQUE INDEX "ScopeTradeAssignment_scopeItemId_tradeId_key" ON "ScopeTradeAssignment"("scopeItemId", "tradeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateTable
CREATE TABLE "PreferredSub" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tradeId" INTEGER NOT NULL,
    "subcontractorId" INTEGER NOT NULL,
    "projectType" TEXT,
    "addedBy" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PreferredSub_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PreferredSub_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BidInviteSelection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "subcontractorId" INTEGER NOT NULL,
    "tradeId" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rfqStatus" TEXT NOT NULL DEFAULT 'invited',
    "invitedAt" DATETIME,
    "estimateReceivedAt" DATETIME,
    "estimateFileName" TEXT,
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "selectionNotes" TEXT,
    CONSTRAINT "BidInviteSelection_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BidInviteSelection_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BidInviteSelection" ("bidId", "createdAt", "id", "notes", "subcontractorId", "tradeId") SELECT "bidId", "createdAt", "id", "notes", "subcontractorId", "tradeId" FROM "BidInviteSelection";
DROP TABLE "BidInviteSelection";
ALTER TABLE "new_BidInviteSelection" RENAME TO "BidInviteSelection";
CREATE TABLE "new_Subcontractor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "company" TEXT NOT NULL,
    "office" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "isUnion" BOOLEAN NOT NULL DEFAULT false,
    "isMWBE" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "tier" TEXT,
    "projectTypes" TEXT,
    "region" TEXT,
    "lastBidDate" DATETIME,
    "internalNotes" TEXT,
    "doNotUse" BOOLEAN NOT NULL DEFAULT false,
    "doNotUseReason" TEXT
);
INSERT INTO "new_Subcontractor" ("company", "createdAt", "id", "isMWBE", "isUnion", "notes", "office", "status", "updatedAt") SELECT "company", "createdAt", "id", "isMWBE", "isUnion", "notes", "office", "status", "updatedAt" FROM "Subcontractor";
DROP TABLE "Subcontractor";
ALTER TABLE "new_Subcontractor" RENAME TO "Subcontractor";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PreferredSub_tradeId_subcontractorId_projectType_key" ON "PreferredSub"("tradeId", "subcontractorId", "projectType");

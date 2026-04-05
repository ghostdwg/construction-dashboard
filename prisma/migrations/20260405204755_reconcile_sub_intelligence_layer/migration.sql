/*
  Warnings:

  - You are about to drop the column `addedBy` on the `PreferredSub` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `PreferredSub` table. All the data in the column will be lost.
  - You are about to drop the column `projectType` on the `PreferredSub` table. All the data in the column will be lost.

*/
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
    "rfqStatus" TEXT NOT NULL DEFAULT 'no_response',
    "invitedAt" DATETIME,
    "estimateReceivedAt" DATETIME,
    "estimateFileName" TEXT,
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "selectionNotes" TEXT,
    CONSTRAINT "BidInviteSelection_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BidInviteSelection_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BidInviteSelection" ("bidId", "createdAt", "estimateFileName", "estimateReceivedAt", "followUpCount", "id", "invitedAt", "notes", "rfqStatus", "selectionNotes", "subcontractorId", "tradeId") SELECT "bidId", "createdAt", "estimateFileName", "estimateReceivedAt", "followUpCount", "id", "invitedAt", "notes", "rfqStatus", "selectionNotes", "subcontractorId", "tradeId" FROM "BidInviteSelection";
DROP TABLE "BidInviteSelection";
ALTER TABLE "new_BidInviteSelection" RENAME TO "BidInviteSelection";
CREATE TABLE "new_PreferredSub" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tradeId" INTEGER NOT NULL,
    "subcontractorId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PreferredSub_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PreferredSub_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PreferredSub" ("createdAt", "id", "subcontractorId", "tradeId") SELECT "createdAt", "id", "subcontractorId", "tradeId" FROM "PreferredSub";
DROP TABLE "PreferredSub";
ALTER TABLE "new_PreferredSub" RENAME TO "PreferredSub";
CREATE UNIQUE INDEX "PreferredSub_tradeId_subcontractorId_key" ON "PreferredSub"("tradeId", "subcontractorId");
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
    "tier" TEXT NOT NULL DEFAULT 'new',
    "projectTypes" TEXT NOT NULL DEFAULT '',
    "region" TEXT,
    "lastBidDate" DATETIME,
    "internalNotes" TEXT,
    "doNotUse" BOOLEAN NOT NULL DEFAULT false,
    "doNotUseReason" TEXT
);
INSERT INTO "new_Subcontractor" ("company", "createdAt", "doNotUse", "doNotUseReason", "id", "internalNotes", "isMWBE", "isUnion", "lastBidDate", "notes", "office", "projectTypes", "region", "status", "tier", "updatedAt") SELECT "company", "createdAt", "doNotUse", "doNotUseReason", "id", "internalNotes", "isMWBE", "isUnion", "lastBidDate", "notes", "office", coalesce("projectTypes", '') AS "projectTypes", "region", "status", coalesce("tier", 'new') AS "tier", "updatedAt" FROM "Subcontractor";
DROP TABLE "Subcontractor";
ALTER TABLE "new_Subcontractor" RENAME TO "Subcontractor";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

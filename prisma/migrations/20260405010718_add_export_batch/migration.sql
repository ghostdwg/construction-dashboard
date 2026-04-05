/*
  Warnings:

  - You are about to drop the column `bidAmount` on the `Subcontractor` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `Subcontractor` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Subcontractor` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `Subcontractor` table. All the data in the column will be lost.
  - You are about to drop the column `tradeId` on the `Subcontractor` table. All the data in the column will be lost.
  - You are about to drop the column `bidId` on the `Trade` table. All the data in the column will be lost.
  - You are about to drop the column `scopeNotes` on the `Trade` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `Subcontractor` table without a default value. This is not possible if the table is not empty.
  - Made the column `company` on table `Subcontractor` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateTable
CREATE TABLE "BidTrade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "tradeId" INTEGER NOT NULL,
    "scopeNotes" TEXT,
    CONSTRAINT "BidTrade_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BidTrade_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubcontractorTrade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "subcontractorId" INTEGER NOT NULL,
    "tradeId" INTEGER NOT NULL,
    CONSTRAINT "SubcontractorTrade_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SubcontractorTrade_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BidInviteSelection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "subcontractorId" INTEGER NOT NULL,
    "tradeId" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BidInviteSelection_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BidInviteSelection_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExportBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "exportedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowCount" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    CONSTRAINT "ExportBatch_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bid" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "projectName" TEXT NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "scope" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "dueDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Bid" ("createdAt", "description", "dueDate", "id", "location", "projectName", "scope", "status", "updatedAt") SELECT "createdAt", "description", "dueDate", "id", "location", "projectName", coalesce("scope", '') AS "scope", "status", "updatedAt" FROM "Bid";
DROP TABLE "Bid";
ALTER TABLE "new_Bid" RENAME TO "Bid";
CREATE TABLE "new_Contact" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "subcontractorId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contact_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "Subcontractor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Contact" ("email", "id", "name", "phone", "subcontractorId") SELECT "email", "id", "name", "phone", "subcontractorId" FROM "Contact";
DROP TABLE "Contact";
ALTER TABLE "new_Contact" RENAME TO "Contact";
CREATE TABLE "new_Subcontractor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "company" TEXT NOT NULL,
    "office" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "isUnion" BOOLEAN NOT NULL DEFAULT false,
    "isMWBE" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Subcontractor" ("company", "id") SELECT "company", "id" FROM "Subcontractor";
DROP TABLE "Subcontractor";
ALTER TABLE "new_Subcontractor" RENAME TO "Subcontractor";
CREATE TABLE "new_Trade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "costCode" TEXT,
    "csiCode" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Trade" ("costCode", "id", "name") SELECT "costCode", "id", "name" FROM "Trade";
DROP TABLE "Trade";
ALTER TABLE "new_Trade" RENAME TO "Trade";
CREATE UNIQUE INDEX "Trade_name_key" ON "Trade"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "BidTrade_bidId_tradeId_key" ON "BidTrade"("bidId", "tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "SubcontractorTrade_subcontractorId_tradeId_key" ON "SubcontractorTrade"("subcontractorId", "tradeId");

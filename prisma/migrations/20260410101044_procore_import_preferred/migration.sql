-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "doNotUseReason" TEXT,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "procoreVendorId" TEXT
);
INSERT INTO "new_Subcontractor" ("company", "createdAt", "doNotUse", "doNotUseReason", "id", "internalNotes", "isMWBE", "isUnion", "lastBidDate", "notes", "office", "projectTypes", "region", "status", "tier", "updatedAt") SELECT "company", "createdAt", "doNotUse", "doNotUseReason", "id", "internalNotes", "isMWBE", "isUnion", "lastBidDate", "notes", "office", "projectTypes", "region", "status", "tier", "updatedAt" FROM "Subcontractor";
DROP TABLE "Subcontractor";
ALTER TABLE "new_Subcontractor" RENAME TO "Subcontractor";
CREATE UNIQUE INDEX "Subcontractor_procoreVendorId_key" ON "Subcontractor"("procoreVendorId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

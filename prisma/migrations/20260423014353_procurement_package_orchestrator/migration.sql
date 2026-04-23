-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SubmittalPackage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "packageNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "bidTradeId" INTEGER,
    "responsibleContractor" TEXT,
    "submittalManager" TEXT,
    "defaultReviewers" TEXT,
    "defaultDistribution" TEXT,
    "defaultLeadTimeDays" INTEGER,
    "defaultReviewBufferDays" INTEGER,
    "defaultResubmitBufferDays" INTEGER,
    "linkedActivityId" TEXT,
    "riskStatus" TEXT NOT NULL DEFAULT 'NONE',
    "readyForExport" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubmittalPackage_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubmittalPackage_bidTradeId_fkey" FOREIGN KEY ("bidTradeId") REFERENCES "BidTrade" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SubmittalPackage_linkedActivityId_fkey" FOREIGN KEY ("linkedActivityId") REFERENCES "ScheduleActivityV2" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SubmittalPackage" ("bidId", "bidTradeId", "createdAt", "defaultDistribution", "defaultReviewers", "id", "name", "packageNumber", "responsibleContractor", "status", "submittalManager", "updatedAt") SELECT "bidId", "bidTradeId", "createdAt", "defaultDistribution", "defaultReviewers", "id", "name", "packageNumber", "responsibleContractor", "status", "submittalManager", "updatedAt" FROM "SubmittalPackage";
DROP TABLE "SubmittalPackage";
ALTER TABLE "new_SubmittalPackage" RENAME TO "SubmittalPackage";
CREATE INDEX "SubmittalPackage_bidId_idx" ON "SubmittalPackage"("bidId");
CREATE INDEX "SubmittalPackage_linkedActivityId_idx" ON "SubmittalPackage"("linkedActivityId");
CREATE UNIQUE INDEX "SubmittalPackage_bidId_packageNumber_key" ON "SubmittalPackage"("bidId", "packageNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

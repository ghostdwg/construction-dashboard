-- Add reviewRound to SubmittalItem.
--
-- Uses RedefineTables so this stays compatible with the existing
-- SubmittalItem migration history already present in this repo.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_SubmittalItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "bidTradeId" INTEGER,
    "specSectionId" INTEGER,
    "packageId" INTEGER,
    "submittalNumber" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requiredBy" DATETIME,
    "requestedAt" DATETIME,
    "receivedAt" DATETIME,
    "reviewedAt" DATETIME,
    "approvedAt" DATETIME,
    "reviewRound" INTEGER NOT NULL DEFAULT 1,
    "responsibleSubId" INTEGER,
    "reviewer" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sourceJobId" TEXT,
    "linkedActivityId" TEXT,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "reviewBufferDays" INTEGER NOT NULL DEFAULT 21,
    "resubmitBufferDays" INTEGER NOT NULL DEFAULT 7,
    "requiredOnSiteDate" DATETIME,
    "submitByDate" DATETIME,
    CONSTRAINT "SubmittalItem_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubmittalItem_bidTradeId_fkey" FOREIGN KEY ("bidTradeId") REFERENCES "BidTrade" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SubmittalItem_specSectionId_fkey" FOREIGN KEY ("specSectionId") REFERENCES "SpecSection" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SubmittalItem_responsibleSubId_fkey" FOREIGN KEY ("responsibleSubId") REFERENCES "Subcontractor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SubmittalItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "SubmittalPackage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SubmittalItem_linkedActivityId_fkey" FOREIGN KEY ("linkedActivityId") REFERENCES "ScheduleActivityV2" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SubmittalItem_sourceJobId_fkey" FOREIGN KEY ("sourceJobId") REFERENCES "BackgroundJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_SubmittalItem" (
    "approvedAt",
    "bidId",
    "bidTradeId",
    "createdAt",
    "description",
    "id",
    "leadTimeDays",
    "linkedActivityId",
    "notes",
    "packageId",
    "receivedAt",
    "requestedAt",
    "requiredBy",
    "requiredOnSiteDate",
    "responsibleSubId",
    "resubmitBufferDays",
    "reviewBufferDays",
    "reviewedAt",
    "reviewer",
    "source",
    "sourceJobId",
    "specSectionId",
    "status",
    "submitByDate",
    "submittalNumber",
    "title",
    "type",
    "updatedAt"
)
SELECT
    "approvedAt",
    "bidId",
    "bidTradeId",
    "createdAt",
    "description",
    "id",
    "leadTimeDays",
    "linkedActivityId",
    "notes",
    "packageId",
    "receivedAt",
    "requestedAt",
    "requiredBy",
    "requiredOnSiteDate",
    "responsibleSubId",
    "resubmitBufferDays",
    "reviewBufferDays",
    "reviewedAt",
    "reviewer",
    "source",
    "sourceJobId",
    "specSectionId",
    "status",
    "submitByDate",
    "submittalNumber",
    "title",
    "type",
    "updatedAt"
FROM "SubmittalItem";

DROP TABLE "SubmittalItem";
ALTER TABLE "new_SubmittalItem" RENAME TO "SubmittalItem";

CREATE INDEX "SubmittalItem_bidId_idx" ON "SubmittalItem"("bidId");
CREATE INDEX "SubmittalItem_specSectionId_idx" ON "SubmittalItem"("specSectionId");
CREATE INDEX "SubmittalItem_status_idx" ON "SubmittalItem"("status");
CREATE INDEX "SubmittalItem_packageId_idx" ON "SubmittalItem"("packageId");
CREATE INDEX "SubmittalItem_linkedActivityId_idx" ON "SubmittalItem"("linkedActivityId");
CREATE INDEX "SubmittalItem_sourceJobId_idx" ON "SubmittalItem"("sourceJobId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- AlterTable
ALTER TABLE "Bid" ADD COLUMN "constructionStartDate" DATETIME;
ALTER TABLE "Bid" ADD COLUMN "projectDurationDays" INTEGER;

-- CreateTable
CREATE TABLE "ScheduleActivity" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "bidTradeId" INTEGER,
    "activityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CONSTRUCTION',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "durationDays" INTEGER NOT NULL DEFAULT 5,
    "startDate" DATETIME,
    "finishDate" DATETIME,
    "predecessorIds" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScheduleActivity_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScheduleActivity_bidTradeId_fkey" FOREIGN KEY ("bidTradeId") REFERENCES "BidTrade" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ScheduleActivity_bidId_idx" ON "ScheduleActivity"("bidId");

-- CreateIndex
CREATE INDEX "ScheduleActivity_bidId_sequence_idx" ON "ScheduleActivity"("bidId", "sequence");

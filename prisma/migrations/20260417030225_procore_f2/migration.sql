-- AlterTable
ALTER TABLE "Bid" ADD COLUMN "procoreProjectId" TEXT;

-- CreateTable
CREATE TABLE "ProcorePush" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "pushType" TEXT NOT NULL,
    "pushedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    CONSTRAINT "ProcorePush_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProcorePush_bidId_idx" ON "ProcorePush"("bidId");

-- CreateIndex
CREATE INDEX "ProcorePush_bidId_pushType_idx" ON "ProcorePush"("bidId", "pushType");

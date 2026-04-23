-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MeetingActionItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "meetingId" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'meeting',
    "description" TEXT NOT NULL,
    "assignedToId" INTEGER,
    "assignedToName" TEXT,
    "dueDate" DATETIME,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "sourceText" TEXT,
    "isGcTask" BOOLEAN NOT NULL DEFAULT false,
    "carriedFromDate" TEXT,
    "closedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeetingActionItem_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingActionItem_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "MeetingParticipant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MeetingActionItem" ("assignedToId", "assignedToName", "bidId", "carriedFromDate", "closedAt", "createdAt", "description", "dueDate", "id", "isGcTask", "meetingId", "notes", "priority", "sourceText", "status", "updatedAt") SELECT "assignedToId", "assignedToName", "bidId", "carriedFromDate", "closedAt", "createdAt", "description", "dueDate", "id", "isGcTask", "meetingId", "notes", "priority", "sourceText", "status", "updatedAt" FROM "MeetingActionItem";
DROP TABLE "MeetingActionItem";
ALTER TABLE "new_MeetingActionItem" RENAME TO "MeetingActionItem";
CREATE INDEX "MeetingActionItem_bidId_idx" ON "MeetingActionItem"("bidId");
CREATE INDEX "MeetingActionItem_meetingId_idx" ON "MeetingActionItem"("meetingId");
CREATE INDEX "MeetingActionItem_status_idx" ON "MeetingActionItem"("status");
CREATE INDEX "MeetingActionItem_source_idx" ON "MeetingActionItem"("source");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

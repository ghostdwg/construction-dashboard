-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Meeting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "meetingDate" DATETIME NOT NULL,
    "meetingType" TEXT NOT NULL DEFAULT 'GENERAL',
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "audioFileName" TEXT,
    "durationSeconds" INTEGER,
    "transcriptionSource" TEXT,
    "transcriptionJobId" TEXT,
    "rawTranscript" TEXT,
    "transcript" TEXT,
    "summary" TEXT,
    "keyDecisions" TEXT NOT NULL DEFAULT '[]',
    "risks" TEXT NOT NULL DEFAULT '[]',
    "followUpItems" TEXT NOT NULL DEFAULT '[]',
    "openIssues" TEXT NOT NULL DEFAULT '[]',
    "redFlags" TEXT NOT NULL DEFAULT '[]',
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" DATETIME,
    "analysisVersion" INTEGER NOT NULL DEFAULT 0,
    "uploadedAt" DATETIME,
    "analyzedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Meeting_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Meeting" ("analyzedAt", "audioFileName", "bidId", "createdAt", "durationSeconds", "followUpItems", "id", "keyDecisions", "location", "meetingDate", "meetingType", "rawTranscript", "risks", "status", "summary", "title", "transcript", "transcriptionJobId", "transcriptionSource", "updatedAt", "uploadedAt") SELECT "analyzedAt", "audioFileName", "bidId", "createdAt", "durationSeconds", "followUpItems", "id", "keyDecisions", "location", "meetingDate", "meetingType", "rawTranscript", "risks", "status", "summary", "title", "transcript", "transcriptionJobId", "transcriptionSource", "updatedAt", "uploadedAt" FROM "Meeting";
DROP TABLE "Meeting";
ALTER TABLE "new_Meeting" RENAME TO "Meeting";
CREATE INDEX "Meeting_bidId_idx" ON "Meeting"("bidId");
CREATE INDEX "Meeting_bidId_meetingDate_idx" ON "Meeting"("bidId", "meetingDate");
CREATE TABLE "new_MeetingActionItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "meetingId" INTEGER NOT NULL,
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
INSERT INTO "new_MeetingActionItem" ("assignedToId", "assignedToName", "bidId", "closedAt", "createdAt", "description", "dueDate", "id", "meetingId", "notes", "priority", "sourceText", "status", "updatedAt") SELECT "assignedToId", "assignedToName", "bidId", "closedAt", "createdAt", "description", "dueDate", "id", "meetingId", "notes", "priority", "sourceText", "status", "updatedAt" FROM "MeetingActionItem";
DROP TABLE "MeetingActionItem";
ALTER TABLE "new_MeetingActionItem" RENAME TO "MeetingActionItem";
CREATE INDEX "MeetingActionItem_bidId_idx" ON "MeetingActionItem"("bidId");
CREATE INDEX "MeetingActionItem_meetingId_idx" ON "MeetingActionItem"("meetingId");
CREATE INDEX "MeetingActionItem_status_idx" ON "MeetingActionItem"("status");
CREATE TABLE "new_MeetingParticipant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "meetingId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "company" TEXT,
    "speakerLabel" TEXT,
    "speakerType" TEXT,
    "confidence" REAL,
    "isGcTeam" BOOLEAN NOT NULL DEFAULT false,
    "projectContactId" INTEGER,
    CONSTRAINT "MeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingParticipant_projectContactId_fkey" FOREIGN KEY ("projectContactId") REFERENCES "ProjectContact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MeetingParticipant" ("company", "id", "meetingId", "name", "projectContactId", "role", "speakerLabel") SELECT "company", "id", "meetingId", "name", "projectContactId", "role", "speakerLabel" FROM "MeetingParticipant";
DROP TABLE "MeetingParticipant";
ALTER TABLE "new_MeetingParticipant" RENAME TO "MeetingParticipant";
CREATE INDEX "MeetingParticipant_meetingId_idx" ON "MeetingParticipant"("meetingId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Module OPS7 — Commitment Register: verbal commitments from meetings.
-- Additive only: one new table. Forward-only; applied ONLY via
-- scripts/apply-turso-migrations.mjs by the operator (never auto-run,
-- never by a model). OVERDUE is derived at read — deliberately no column.

CREATE TABLE "MeetingCommitment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "meetingId" INTEGER NOT NULL,
    "bidId" INTEGER NOT NULL,
    "committedBy" TEXT NOT NULL,
    "speakerLabel" TEXT,
    "commitmentText" TEXT NOT NULL,
    "duePhrase" TEXT,
    "dueDate" DATETIME,
    "sourceQuote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "confirmedBy" TEXT,
    "fulfilledBy" TEXT,
    "dismissedReason" TEXT,
    "linkedActionItemId" INTEGER,
    "extractedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeetingCommitment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingCommitment_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingCommitment_linkedActionItemId_fkey" FOREIGN KEY ("linkedActionItemId") REFERENCES "MeetingActionItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "MeetingCommitment_bidId_status_dueDate_idx" ON "MeetingCommitment"("bidId", "status", "dueDate");
CREATE INDEX "MeetingCommitment_meetingId_idx" ON "MeetingCommitment"("meetingId");

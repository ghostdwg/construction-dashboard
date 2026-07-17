-- Module R2-B1 — Meeting Register Foundation.
-- Additive only: six new tables + one nullable column on TrackedItem.
-- Forward-only; applied ONLY via scripts/apply-turso-migrations.mjs by the
-- operator (never auto-run, never by a model). No destructive rollback
-- exists by design — recovery is forward-fix or checkpoint restore.
--
-- Immutability discipline (matches OPS3/OPS4): original transcript
-- material and register source wording are frozen columns; corrections,
-- dispositions and minutes are append-only rows. Every FK onto TrackedItem
-- and onto register entries is SET NULL, never CASCADE — removing a source
-- never destroys the operations record, and removing an operations record
-- never destroys the meeting record.

-- ── MeetingTranscriptSegment — materialized projection of rawTranscript ──
CREATE TABLE "MeetingTranscriptSegment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "meetingId" INTEGER NOT NULL,
    "bidId" INTEGER NOT NULL,
    "segmentIndex" INTEGER NOT NULL,
    "sortKey" REAL NOT NULL,
    "startSec" REAL,
    "endSec" REAL,
    "originalSpeakerLabel" TEXT,
    "originalText" TEXT NOT NULL,
    "currentSpeakerLabel" TEXT,
    "currentText" TEXT NOT NULL,
    "isUnknownSpeaker" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "splitFromSegmentId" INTEGER,
    "participantId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeetingTranscriptSegment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingTranscriptSegment_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingTranscriptSegment_splitFromSegmentId_fkey" FOREIGN KEY ("splitFromSegmentId") REFERENCES "MeetingTranscriptSegment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingTranscriptSegment_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MeetingParticipant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "MeetingTranscriptSegment_meetingId_sortKey_idx" ON "MeetingTranscriptSegment"("meetingId", "sortKey");
CREATE INDEX "MeetingTranscriptSegment_meetingId_currentSpeakerLabel_idx" ON "MeetingTranscriptSegment"("meetingId", "currentSpeakerLabel");
CREATE INDEX "MeetingTranscriptSegment_bidId_idx" ON "MeetingTranscriptSegment"("bidId");

-- ── MeetingTranscriptCorrection — APPEND-ONLY correction audit log ──
CREATE TABLE "MeetingTranscriptCorrection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "meetingId" INTEGER NOT NULL,
    "bidId" INTEGER NOT NULL,
    "correctionType" TEXT NOT NULL,
    "segmentId" INTEGER,
    "fromValue" TEXT,
    "toValue" TEXT,
    "affectedSegmentCount" INTEGER NOT NULL DEFAULT 0,
    "affectedDerivedJson" TEXT NOT NULL DEFAULT '{}',
    "reason" TEXT,
    "correctedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeetingTranscriptCorrection_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingTranscriptCorrection_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MeetingTranscriptCorrection_meetingId_createdAt_idx" ON "MeetingTranscriptCorrection"("meetingId", "createdAt");
CREATE INDEX "MeetingTranscriptCorrection_bidId_idx" ON "MeetingTranscriptCorrection"("bidId");

-- ── MeetingExtractionRun — preview/apply lifecycle for extraction reruns ──
CREATE TABLE "MeetingExtractionRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "meetingId" INTEGER NOT NULL,
    "bidId" INTEGER NOT NULL,
    "analysisVersion" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEWED',
    "analysisJson" TEXT NOT NULL DEFAULT '{}',
    "previewJson" TEXT NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedBy" TEXT,
    "appliedAt" DATETIME,
    CONSTRAINT "MeetingExtractionRun_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingExtractionRun_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MeetingExtractionRun_meetingId_createdAt_idx" ON "MeetingExtractionRun"("meetingId", "createdAt");
CREATE INDEX "MeetingExtractionRun_bidId_idx" ON "MeetingExtractionRun"("bidId");

-- ── MeetingRegisterEntry — the durable Meeting Register ──
CREATE TABLE "MeetingRegisterEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "meetingId" INTEGER NOT NULL,
    "bidId" INTEGER NOT NULL,
    "entryType" TEXT NOT NULL,
    "agendaTopic" TEXT,
    "rawSourceText" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "speakerLabel" TEXT,
    "speakerName" TEXT,
    "startSec" REAL,
    "endSec" REAL,
    "sourceCitation" TEXT,
    "segmentId" INTEGER,
    "participantsJson" TEXT NOT NULL DEFAULT '[]',
    "responsibleParty" TEXT,
    "dueDate" DATETIME,
    "confidence" TEXT,
    "origin" TEXT NOT NULL,
    "extractionRunId" INTEGER,
    "reviewState" TEXT NOT NULL DEFAULT 'PENDING',
    "dispositionReason" TEXT,
    "dispositionBy" TEXT,
    "dispositionAt" DATETIME,
    "mergedIntoEntryId" INTEGER,
    "relatedPriorEntryId" INTEGER,
    "linkedActionItemId" INTEGER,
    "linkedCommitmentId" INTEGER,
    "linkedDesignChangeId" INTEGER,
    "linkedTrackedItemId" INTEGER,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeetingRegisterEntry_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "MeetingTranscriptSegment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_extractionRunId_fkey" FOREIGN KEY ("extractionRunId") REFERENCES "MeetingExtractionRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_mergedIntoEntryId_fkey" FOREIGN KEY ("mergedIntoEntryId") REFERENCES "MeetingRegisterEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_relatedPriorEntryId_fkey" FOREIGN KEY ("relatedPriorEntryId") REFERENCES "MeetingRegisterEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_linkedActionItemId_fkey" FOREIGN KEY ("linkedActionItemId") REFERENCES "MeetingActionItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_linkedCommitmentId_fkey" FOREIGN KEY ("linkedCommitmentId") REFERENCES "MeetingCommitment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_linkedDesignChangeId_fkey" FOREIGN KEY ("linkedDesignChangeId") REFERENCES "DesignIntentChange" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_linkedTrackedItemId_fkey" FOREIGN KEY ("linkedTrackedItemId") REFERENCES "TrackedItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "MeetingRegisterEntry_meetingId_entryType_idx" ON "MeetingRegisterEntry"("meetingId", "entryType");
CREATE INDEX "MeetingRegisterEntry_meetingId_reviewState_idx" ON "MeetingRegisterEntry"("meetingId", "reviewState");
CREATE INDEX "MeetingRegisterEntry_bidId_reviewState_idx" ON "MeetingRegisterEntry"("bidId", "reviewState");
CREATE INDEX "MeetingRegisterEntry_linkedTrackedItemId_idx" ON "MeetingRegisterEntry"("linkedTrackedItemId");

-- ── MeetingRegisterEntryRevision — APPEND-ONLY entry history ──
CREATE TABLE "MeetingRegisterEntryRevision" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entryId" INTEGER NOT NULL,
    "bidId" INTEGER NOT NULL,
    "changeType" TEXT NOT NULL,
    "fromReviewState" TEXT,
    "toReviewState" TEXT,
    "detailJson" TEXT NOT NULL DEFAULT '{}',
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeetingRegisterEntryRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "MeetingRegisterEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntryRevision_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MeetingRegisterEntryRevision_entryId_createdAt_idx" ON "MeetingRegisterEntryRevision"("entryId", "createdAt");
CREATE INDEX "MeetingRegisterEntryRevision_bidId_idx" ON "MeetingRegisterEntryRevision"("bidId");

-- ── MeetingMinutesRevision — immutable published-minutes snapshots ──
CREATE TABLE "MeetingMinutesRevision" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "meetingId" INTEGER NOT NULL,
    "bidId" INTEGER NOT NULL,
    "revisionIndex" INTEGER NOT NULL DEFAULT 0,
    "contentJson" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amendmentReason" TEXT,
    "supersedesRevisionId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeetingMinutesRevision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingMinutesRevision_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingMinutesRevision_supersedesRevisionId_fkey" FOREIGN KEY ("supersedesRevisionId") REFERENCES "MeetingMinutesRevision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MeetingMinutesRevision_supersedesRevisionId_key" ON "MeetingMinutesRevision"("supersedesRevisionId");
CREATE UNIQUE INDEX "MeetingMinutesRevision_meetingId_revisionIndex_key" ON "MeetingMinutesRevision"("meetingId", "revisionIndex");
CREATE INDEX "MeetingMinutesRevision_bidId_idx" ON "MeetingMinutesRevision"("bidId");

-- ── TrackedItem — originating register-entry citation (R2-B1) ──
ALTER TABLE "TrackedItem" ADD COLUMN "sourceMeetingRegisterEntryId" INTEGER
    REFERENCES "MeetingRegisterEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TrackedItem_sourceMeetingRegisterEntryId_key" ON "TrackedItem"("sourceMeetingRegisterEntryId");

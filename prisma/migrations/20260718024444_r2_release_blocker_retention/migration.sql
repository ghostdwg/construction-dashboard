-- R2 integrated release-blocker remediation.
--
-- Forward-only, retention-safe SQLite table rebuilds. The durable Meeting
-- Register source/history tables now RESTRICT deletion through both Meeting
-- and Bid parents. Register-entry revisions also RESTRICT deletion through
-- their owning entry. MeetingParticipant gains non-destructive merge
-- disposition/provenance fields. Every existing column, index, uniqueness
-- constraint, self relation, and row is copied below; no domain table or row
-- is intentionally dropped.
--
-- Authored for operator-reviewed application only. This migration must be
-- replayed against a checkpoint/throwaway database before any shared tier.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MeetingExtractionRun" (
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
    CONSTRAINT "MeetingExtractionRun_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeetingExtractionRun_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MeetingExtractionRun" ("analysisJson", "analysisVersion", "appliedAt", "appliedBy", "bidId", "createdAt", "createdBy", "id", "meetingId", "previewJson", "status", "trigger") SELECT "analysisJson", "analysisVersion", "appliedAt", "appliedBy", "bidId", "createdAt", "createdBy", "id", "meetingId", "previewJson", "status", "trigger" FROM "MeetingExtractionRun";
DROP TABLE "MeetingExtractionRun";
ALTER TABLE "new_MeetingExtractionRun" RENAME TO "MeetingExtractionRun";
CREATE INDEX "MeetingExtractionRun_meetingId_createdAt_idx" ON "MeetingExtractionRun"("meetingId", "createdAt");
CREATE INDEX "MeetingExtractionRun_bidId_idx" ON "MeetingExtractionRun"("bidId");
CREATE TABLE "new_MeetingMinutesRevision" (
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
    CONSTRAINT "MeetingMinutesRevision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeetingMinutesRevision_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeetingMinutesRevision_supersedesRevisionId_fkey" FOREIGN KEY ("supersedesRevisionId") REFERENCES "MeetingMinutesRevision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MeetingMinutesRevision" ("amendmentReason", "bidId", "contentJson", "createdAt", "id", "meetingId", "publishedAt", "publishedBy", "revisionIndex", "supersedesRevisionId") SELECT "amendmentReason", "bidId", "contentJson", "createdAt", "id", "meetingId", "publishedAt", "publishedBy", "revisionIndex", "supersedesRevisionId" FROM "MeetingMinutesRevision";
DROP TABLE "MeetingMinutesRevision";
ALTER TABLE "new_MeetingMinutesRevision" RENAME TO "MeetingMinutesRevision";
CREATE UNIQUE INDEX "MeetingMinutesRevision_supersedesRevisionId_key" ON "MeetingMinutesRevision"("supersedesRevisionId");
CREATE INDEX "MeetingMinutesRevision_bidId_idx" ON "MeetingMinutesRevision"("bidId");
CREATE UNIQUE INDEX "MeetingMinutesRevision_meetingId_revisionIndex_key" ON "MeetingMinutesRevision"("meetingId", "revisionIndex");
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
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mergedIntoParticipantId" INTEGER,
    "mergedAt" DATETIME,
    "mergedBy" TEXT,
    CONSTRAINT "MeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingParticipant_projectContactId_fkey" FOREIGN KEY ("projectContactId") REFERENCES "ProjectContact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingParticipant_mergedIntoParticipantId_fkey" FOREIGN KEY ("mergedIntoParticipantId") REFERENCES "MeetingParticipant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MeetingParticipant" ("company", "confidence", "id", "isGcTeam", "meetingId", "name", "projectContactId", "role", "speakerLabel", "speakerType") SELECT "company", "confidence", "id", "isGcTeam", "meetingId", "name", "projectContactId", "role", "speakerLabel", "speakerType" FROM "MeetingParticipant";
DROP TABLE "MeetingParticipant";
ALTER TABLE "new_MeetingParticipant" RENAME TO "MeetingParticipant";
CREATE INDEX "MeetingParticipant_meetingId_idx" ON "MeetingParticipant"("meetingId");
CREATE INDEX "MeetingParticipant_meetingId_isActive_idx" ON "MeetingParticipant"("meetingId", "isActive");
CREATE TABLE "new_MeetingRegisterEntry" (
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
    "supersededByRunId" INTEGER,
    "supersededByEntryId" INTEGER,
    "supersededAt" DATETIME,
    "mergedIntoEntryId" INTEGER,
    "relatedPriorEntryId" INTEGER,
    "linkedActionItemId" INTEGER,
    "linkedCommitmentId" INTEGER,
    "linkedDesignChangeId" INTEGER,
    "linkedTrackedItemId" INTEGER,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeetingRegisterEntry_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "MeetingTranscriptSegment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_extractionRunId_fkey" FOREIGN KEY ("extractionRunId") REFERENCES "MeetingExtractionRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_supersededByRunId_fkey" FOREIGN KEY ("supersededByRunId") REFERENCES "MeetingExtractionRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_supersededByEntryId_fkey" FOREIGN KEY ("supersededByEntryId") REFERENCES "MeetingRegisterEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_mergedIntoEntryId_fkey" FOREIGN KEY ("mergedIntoEntryId") REFERENCES "MeetingRegisterEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_relatedPriorEntryId_fkey" FOREIGN KEY ("relatedPriorEntryId") REFERENCES "MeetingRegisterEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_linkedActionItemId_fkey" FOREIGN KEY ("linkedActionItemId") REFERENCES "MeetingActionItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_linkedCommitmentId_fkey" FOREIGN KEY ("linkedCommitmentId") REFERENCES "MeetingCommitment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_linkedDesignChangeId_fkey" FOREIGN KEY ("linkedDesignChangeId") REFERENCES "DesignIntentChange" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntry_linkedTrackedItemId_fkey" FOREIGN KEY ("linkedTrackedItemId") REFERENCES "TrackedItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MeetingRegisterEntry" ("agendaTopic", "bidId", "confidence", "createdAt", "createdBy", "dispositionAt", "dispositionBy", "dispositionReason", "dueDate", "endSec", "entryType", "extractionRunId", "id", "linkedActionItemId", "linkedCommitmentId", "linkedDesignChangeId", "linkedTrackedItemId", "meetingId", "mergedIntoEntryId", "normalizedText", "origin", "participantsJson", "rawSourceText", "relatedPriorEntryId", "responsibleParty", "reviewState", "segmentId", "sourceCitation", "speakerLabel", "speakerName", "startSec", "supersededAt", "supersededByEntryId", "supersededByRunId", "updatedAt") SELECT "agendaTopic", "bidId", "confidence", "createdAt", "createdBy", "dispositionAt", "dispositionBy", "dispositionReason", "dueDate", "endSec", "entryType", "extractionRunId", "id", "linkedActionItemId", "linkedCommitmentId", "linkedDesignChangeId", "linkedTrackedItemId", "meetingId", "mergedIntoEntryId", "normalizedText", "origin", "participantsJson", "rawSourceText", "relatedPriorEntryId", "responsibleParty", "reviewState", "segmentId", "sourceCitation", "speakerLabel", "speakerName", "startSec", "supersededAt", "supersededByEntryId", "supersededByRunId", "updatedAt" FROM "MeetingRegisterEntry";
DROP TABLE "MeetingRegisterEntry";
ALTER TABLE "new_MeetingRegisterEntry" RENAME TO "MeetingRegisterEntry";
CREATE INDEX "MeetingRegisterEntry_meetingId_entryType_idx" ON "MeetingRegisterEntry"("meetingId", "entryType");
CREATE INDEX "MeetingRegisterEntry_meetingId_reviewState_idx" ON "MeetingRegisterEntry"("meetingId", "reviewState");
CREATE INDEX "MeetingRegisterEntry_bidId_reviewState_idx" ON "MeetingRegisterEntry"("bidId", "reviewState");
CREATE INDEX "MeetingRegisterEntry_linkedTrackedItemId_idx" ON "MeetingRegisterEntry"("linkedTrackedItemId");
CREATE TABLE "new_MeetingRegisterEntryRevision" (
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
    CONSTRAINT "MeetingRegisterEntryRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "MeetingRegisterEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeetingRegisterEntryRevision_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MeetingRegisterEntryRevision" ("actor", "bidId", "changeType", "createdAt", "detailJson", "entryId", "fromReviewState", "id", "reason", "toReviewState") SELECT "actor", "bidId", "changeType", "createdAt", "detailJson", "entryId", "fromReviewState", "id", "reason", "toReviewState" FROM "MeetingRegisterEntryRevision";
DROP TABLE "MeetingRegisterEntryRevision";
ALTER TABLE "new_MeetingRegisterEntryRevision" RENAME TO "MeetingRegisterEntryRevision";
CREATE INDEX "MeetingRegisterEntryRevision_entryId_createdAt_idx" ON "MeetingRegisterEntryRevision"("entryId", "createdAt");
CREATE INDEX "MeetingRegisterEntryRevision_bidId_idx" ON "MeetingRegisterEntryRevision"("bidId");
CREATE TABLE "new_MeetingTranscriptCorrection" (
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
    CONSTRAINT "MeetingTranscriptCorrection_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeetingTranscriptCorrection_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MeetingTranscriptCorrection" ("affectedDerivedJson", "affectedSegmentCount", "bidId", "correctedBy", "correctionType", "createdAt", "fromValue", "id", "meetingId", "reason", "segmentId", "toValue") SELECT "affectedDerivedJson", "affectedSegmentCount", "bidId", "correctedBy", "correctionType", "createdAt", "fromValue", "id", "meetingId", "reason", "segmentId", "toValue" FROM "MeetingTranscriptCorrection";
DROP TABLE "MeetingTranscriptCorrection";
ALTER TABLE "new_MeetingTranscriptCorrection" RENAME TO "MeetingTranscriptCorrection";
CREATE INDEX "MeetingTranscriptCorrection_meetingId_createdAt_idx" ON "MeetingTranscriptCorrection"("meetingId", "createdAt");
CREATE INDEX "MeetingTranscriptCorrection_bidId_idx" ON "MeetingTranscriptCorrection"("bidId");
CREATE TABLE "new_MeetingTranscriptSegment" (
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
    CONSTRAINT "MeetingTranscriptSegment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeetingTranscriptSegment_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeetingTranscriptSegment_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "MeetingParticipant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MeetingTranscriptSegment_splitFromSegmentId_fkey" FOREIGN KEY ("splitFromSegmentId") REFERENCES "MeetingTranscriptSegment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MeetingTranscriptSegment" ("bidId", "createdAt", "currentSpeakerLabel", "currentText", "endSec", "id", "isActive", "isUnknownSpeaker", "meetingId", "originalSpeakerLabel", "originalText", "participantId", "segmentIndex", "sortKey", "splitFromSegmentId", "startSec", "updatedAt") SELECT "bidId", "createdAt", "currentSpeakerLabel", "currentText", "endSec", "id", "isActive", "isUnknownSpeaker", "meetingId", "originalSpeakerLabel", "originalText", "participantId", "segmentIndex", "sortKey", "splitFromSegmentId", "startSec", "updatedAt" FROM "MeetingTranscriptSegment";
DROP TABLE "MeetingTranscriptSegment";
ALTER TABLE "new_MeetingTranscriptSegment" RENAME TO "MeetingTranscriptSegment";
CREATE INDEX "MeetingTranscriptSegment_meetingId_sortKey_idx" ON "MeetingTranscriptSegment"("meetingId", "sortKey");
CREATE INDEX "MeetingTranscriptSegment_meetingId_currentSpeakerLabel_idx" ON "MeetingTranscriptSegment"("meetingId", "currentSpeakerLabel");
CREATE INDEX "MeetingTranscriptSegment_bidId_idx" ON "MeetingTranscriptSegment"("bidId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

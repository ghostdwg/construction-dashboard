-- Meeting Intelligence v1 — deterministic, local-only review ledger.
-- Additive and forward-only. Media/transcript/project data never leaves the
-- application through this foundation; no external provider is invoked.

CREATE TABLE "MeetingIntelligenceArtifact" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "meetingId" INTEGER NOT NULL,
    "bidId" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "mediaReference" TEXT NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL DEFAULT 'DETERMINISTIC_LOCAL_DEV',
    "sourceMetadataJson" TEXT NOT NULL DEFAULT '{}',
    "transcriptText" TEXT,
    "transcriptConfidence" REAL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "queuedBy" TEXT NOT NULL,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "publishedAt" DATETIME,
    "canceledAt" DATETIME,
    "activeSlot" INTEGER DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeetingIntelligenceArtifact_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeetingIntelligenceArtifact_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "MeetingIntelligenceSegment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artifactId" INTEGER NOT NULL,
    "meetingId" INTEGER NOT NULL,
    "bidId" INTEGER NOT NULL,
    "segmentIndex" INTEGER NOT NULL,
    "startSec" REAL,
    "endSec" REAL,
    "originalSpeakerLabel" TEXT NOT NULL DEFAULT 'UNKNOWN_SPEAKER',
    "currentSpeakerLabel" TEXT NOT NULL DEFAULT 'UNKNOWN_SPEAKER',
    "originalText" TEXT NOT NULL,
    "currentText" TEXT NOT NULL,
    "confidence" REAL,
    "correctedBy" TEXT,
    "correctedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeetingIntelligenceSegment_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "MeetingIntelligenceArtifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingIntelligenceSegment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeetingIntelligenceSegment_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "MeetingIntelligenceCandidate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artifactId" INTEGER NOT NULL,
    "meetingId" INTEGER NOT NULL,
    "bidId" INTEGER NOT NULL,
    "segmentId" INTEGER,
    "candidateType" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "draftText" TEXT NOT NULL,
    "evidenceExcerpt" TEXT NOT NULL,
    "speakerLabel" TEXT NOT NULL,
    "startSec" REAL,
    "endSec" REAL,
    "confidence" REAL,
    "sourceMetadataJson" TEXT NOT NULL DEFAULT '{}',
    "dueDate" DATETIME,
    "reviewState" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "publishedBy" TEXT,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeetingIntelligenceCandidate_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "MeetingIntelligenceArtifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingIntelligenceCandidate_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeetingIntelligenceCandidate_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeetingIntelligenceCandidate_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "MeetingIntelligenceSegment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "MeetingActionItem" ADD COLUMN "sourceMeetingIntelligenceCandidateId" INTEGER
    REFERENCES "MeetingIntelligenceCandidate" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "MeetingIntelligenceArtifact_sourceReference_key" ON "MeetingIntelligenceArtifact"("sourceReference");
CREATE UNIQUE INDEX "MeetingIntelligenceArtifact_meetingId_activeSlot_key" ON "MeetingIntelligenceArtifact"("meetingId", "activeSlot");
CREATE INDEX "MeetingIntelligenceArtifact_bidId_createdAt_idx" ON "MeetingIntelligenceArtifact"("bidId", "createdAt");
CREATE INDEX "MeetingIntelligenceArtifact_meetingId_createdAt_idx" ON "MeetingIntelligenceArtifact"("meetingId", "createdAt");
CREATE INDEX "MeetingIntelligenceArtifact_state_idx" ON "MeetingIntelligenceArtifact"("state");

CREATE UNIQUE INDEX "MeetingIntelligenceSegment_artifactId_segmentIndex_key" ON "MeetingIntelligenceSegment"("artifactId", "segmentIndex");
CREATE INDEX "MeetingIntelligenceSegment_meetingId_segmentIndex_idx" ON "MeetingIntelligenceSegment"("meetingId", "segmentIndex");
CREATE INDEX "MeetingIntelligenceSegment_bidId_idx" ON "MeetingIntelligenceSegment"("bidId");

CREATE INDEX "MeetingIntelligenceCandidate_artifactId_reviewState_idx" ON "MeetingIntelligenceCandidate"("artifactId", "reviewState");
CREATE INDEX "MeetingIntelligenceCandidate_meetingId_reviewState_idx" ON "MeetingIntelligenceCandidate"("meetingId", "reviewState");
CREATE INDEX "MeetingIntelligenceCandidate_bidId_idx" ON "MeetingIntelligenceCandidate"("bidId");
CREATE INDEX "MeetingIntelligenceCandidate_candidateType_idx" ON "MeetingIntelligenceCandidate"("candidateType");

CREATE UNIQUE INDEX "MeetingActionItem_sourceMeetingIntelligenceCandidateId_key" ON "MeetingActionItem"("sourceMeetingIntelligenceCandidateId");

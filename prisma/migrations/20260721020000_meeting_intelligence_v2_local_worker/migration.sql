-- Meeting Intelligence v2 — durable local-worker queue.
-- Additive and replay-safe: the legacy Meeting.status / transcription tables
-- are intentionally untouched.

CREATE TABLE "MeetingIntelligenceWorkerJob" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "artifactId" INTEGER NOT NULL,
    "meetingId" INTEGER NOT NULL,
    "bidId" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "activeSlot" INTEGER DEFAULT 1,
    "workerId" TEXT,
    "leaseTokenHash" TEXT,
    "leasedAt" DATETIME,
    "leaseExpiresAt" DATETIME,
    "lastHeartbeatAt" DATETIME,
    "progressStage" TEXT,
    "progressPercent" INTEGER,
    "sourceMediaReference" TEXT NOT NULL,
    "sourceMediaChecksum" TEXT NOT NULL,
    "cancellationRequestedAt" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "resultChecksum" TEXT,
    "transcriptionTool" TEXT,
    "transcriptionModel" TEXT,
    "transcriptionVersion" TEXT,
    "diarizationTool" TEXT,
    "diarizationModel" TEXT,
    "diarizationVersion" TEXT,
    "toolVersionsJson" TEXT NOT NULL DEFAULT '{}',
    "rawArtifactStorageKey" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "failedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeetingIntelligenceWorkerJob_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "MeetingIntelligenceArtifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeetingIntelligenceWorkerJob_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeetingIntelligenceWorkerJob_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MeetingIntelligenceWorkerJob_idempotencyKey_key" ON "MeetingIntelligenceWorkerJob"("idempotencyKey");
CREATE UNIQUE INDEX "MeetingIntelligenceWorkerJob_resultChecksum_key" ON "MeetingIntelligenceWorkerJob"("resultChecksum");
CREATE UNIQUE INDEX "MeetingIntelligenceWorkerJob_artifactId_activeSlot_key" ON "MeetingIntelligenceWorkerJob"("artifactId", "activeSlot");
CREATE INDEX "MeetingIntelligenceWorkerJob_status_leaseExpiresAt_idx" ON "MeetingIntelligenceWorkerJob"("status", "leaseExpiresAt");
CREATE INDEX "MeetingIntelligenceWorkerJob_artifactId_createdAt_idx" ON "MeetingIntelligenceWorkerJob"("artifactId", "createdAt");
CREATE INDEX "MeetingIntelligenceWorkerJob_meetingId_createdAt_idx" ON "MeetingIntelligenceWorkerJob"("meetingId", "createdAt");
CREATE INDEX "MeetingIntelligenceWorkerJob_bidId_createdAt_idx" ON "MeetingIntelligenceWorkerJob"("bidId", "createdAt");

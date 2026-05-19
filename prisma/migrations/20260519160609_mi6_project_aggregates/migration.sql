-- ──────────────────────────────────────────────────────────────────────────────
-- Phase MI-6 / PR 1 — Project Aggregate Engine v1 schema foundation
--
-- Additive only. Seven new tables form the temporal-intelligence layer:
--   Project                       canonical aggregate
--   ProjectSignal                 polymorphic signal attachment with heuristic
--                                 attachReason + attachScore + factorJson
--   ProjectEntity                 typed role attachments to canonical Entity
--   ProjectTimelineEvent          append-only chronological event log
--   ProjectStateTransition        lifecycle transition history with actor +
--                                 reason
--   ProjectParcel                 geographic continuity (parcel ID + optional
--                                 lat/lng/areaSqft; geospatial deferred)
--   ProjectProbabilitySnapshot    append-only emergence-probability history
--
-- No existing column or table is altered. Pre-existing feat/market-
-- intelligence schema drift (SubmittalPackage release-phase fields,
-- SubmittalItem priority/releasePhase) is intentionally NOT included
-- here; same hand-strip as MI-1 / MI-3 migrations.
-- ──────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workingTitle" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "lifecycleState" TEXT NOT NULL DEFAULT 'EMERGING',
    "confidence" TEXT NOT NULL DEFAULT 'LOW',
    "reviewStatus" TEXT NOT NULL DEFAULT 'AUTO_AGGREGATED',
    "emergenceProbability" REAL,
    "firstSignalAt" DATETIME,
    "lastSignalAt" DATETIME,
    "estimatedStart" DATETIME,
    "estimatedCompletion" DATETIME,
    "estimatedValue" REAL,
    "estimatedSqft" INTEGER,
    "projectType" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "mergedIntoProjectId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_mergedIntoProjectId_fkey" FOREIGN KEY ("mergedIntoProjectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "signalKind" TEXT NOT NULL,
    "sourceMarketSignalId" TEXT,
    "sourceRelationshipEdgeId" TEXT,
    "sourceMarketLeadId" TEXT,
    "sourceMarketSourceDocId" TEXT,
    "sourceExternalRef" TEXT,
    "attachReason" TEXT NOT NULL,
    "attachScore" REAL NOT NULL,
    "attachConfidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "factorJson" TEXT,
    "attachedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detachedAt" DATETIME,
    "detachedReason" TEXT,
    "detachedBy" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectSignal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectEntity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "attachReason" TEXT NOT NULL,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "removedReason" TEXT,
    "removedBy" TEXT,
    "attachedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectEntity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectTimelineEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL,
    "payloadJson" TEXT,
    "sourceRefKind" TEXT,
    "sourceRefId" TEXT,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    CONSTRAINT "ProjectTimelineEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectStateTransition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "triggerSignalRefKind" TEXT,
    "triggerSignalRefId" TEXT,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectStateTransition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectParcel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "parcelSource" TEXT NOT NULL,
    "address" TEXT,
    "jurisdiction" TEXT,
    "lat" REAL,
    "lng" REAL,
    "areaSqft" REAL,
    "attachReason" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "attachedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectParcel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectProbabilitySnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "probability" REAL NOT NULL,
    "lifecycleState" TEXT NOT NULL,
    "factorsJson" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "reason" TEXT,
    CONSTRAINT "ProjectProbabilitySnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MarketLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "leadType" TEXT NOT NULL DEFAULT 'MANUAL',
    "source" TEXT,
    "sourceUrl" TEXT,
    "sourceDocId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "aiScore" INTEGER,
    "location" TEXT,
    "jurisdiction" TEXT,
    "projectType" TEXT,
    "estimatedValue" REAL,
    "rawText" TEXT,
    "aiSummary" TEXT,
    "aiInsights" TEXT,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promotedToBidId" INTEGER,
    "promotedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketLead_promotedToBidId_fkey" FOREIGN KEY ("promotedToBidId") REFERENCES "Bid" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MarketLead_sourceDocId_fkey" FOREIGN KEY ("sourceDocId") REFERENCES "MarketSourceDoc" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MarketLead" ("aiInsights", "aiScore", "aiSummary", "confidence", "createdAt", "detectedAt", "estimatedValue", "id", "jurisdiction", "leadType", "location", "notes", "projectType", "promotedAt", "promotedToBidId", "rawText", "source", "sourceDocId", "sourceUrl", "status", "title", "updatedAt") SELECT "aiInsights", "aiScore", "aiSummary", "confidence", "createdAt", "detectedAt", "estimatedValue", "id", "jurisdiction", "leadType", "location", "notes", "projectType", "promotedAt", "promotedToBidId", "rawText", "source", "sourceDocId", "sourceUrl", "status", "title", "updatedAt" FROM "MarketLead";
DROP TABLE "MarketLead";
ALTER TABLE "new_MarketLead" RENAME TO "MarketLead";
CREATE INDEX "MarketLead_status_idx" ON "MarketLead"("status");
CREATE INDEX "MarketLead_leadType_idx" ON "MarketLead"("leadType");
CREATE INDEX "MarketLead_detectedAt_idx" ON "MarketLead"("detectedAt");
CREATE INDEX "MarketLead_promotedToBidId_idx" ON "MarketLead"("promotedToBidId");
CREATE INDEX "MarketLead_sourceDocId_idx" ON "MarketLead"("sourceDocId");
CREATE TABLE "new_MarketSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT,
    "sourceDocId" TEXT,
    "signalType" TEXT NOT NULL,
    "signalSubtype" TEXT,
    "source" TEXT,
    "sourceUrl" TEXT,
    "sourceDate" DATETIME,
    "headline" TEXT NOT NULL,
    "rawText" TEXT,
    "metadata" TEXT,
    "aiRelevanceScore" INTEGER,
    "nextMeetingDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketSignal_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MarketLead" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MarketSignal_sourceDocId_fkey" FOREIGN KEY ("sourceDocId") REFERENCES "MarketSourceDoc" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MarketSignal" ("aiRelevanceScore", "createdAt", "headline", "id", "leadId", "metadata", "nextMeetingDate", "rawText", "signalSubtype", "signalType", "source", "sourceDate", "sourceDocId", "sourceUrl") SELECT "aiRelevanceScore", "createdAt", "headline", "id", "leadId", "metadata", "nextMeetingDate", "rawText", "signalSubtype", "signalType", "source", "sourceDate", "sourceDocId", "sourceUrl" FROM "MarketSignal";
DROP TABLE "MarketSignal";
ALTER TABLE "new_MarketSignal" RENAME TO "MarketSignal";
CREATE INDEX "MarketSignal_leadId_idx" ON "MarketSignal"("leadId");
CREATE INDEX "MarketSignal_signalType_idx" ON "MarketSignal"("signalType");
CREATE INDEX "MarketSignal_signalSubtype_idx" ON "MarketSignal"("signalSubtype");
CREATE INDEX "MarketSignal_createdAt_idx" ON "MarketSignal"("createdAt");
CREATE INDEX "MarketSignal_sourceDocId_idx" ON "MarketSignal"("sourceDocId");
CREATE INDEX "MarketSignal_nextMeetingDate_idx" ON "MarketSignal"("nextMeetingDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Project_lifecycleState_idx" ON "Project"("lifecycleState");

-- CreateIndex
CREATE INDEX "Project_reviewStatus_idx" ON "Project"("reviewStatus");

-- CreateIndex
CREATE INDEX "Project_jurisdiction_idx" ON "Project"("jurisdiction");

-- CreateIndex
CREATE INDEX "Project_lastSignalAt_idx" ON "Project"("lastSignalAt");

-- CreateIndex
CREATE INDEX "Project_emergenceProbability_idx" ON "Project"("emergenceProbability");

-- CreateIndex
CREATE INDEX "Project_mergedIntoProjectId_idx" ON "Project"("mergedIntoProjectId");

-- CreateIndex
CREATE INDEX "ProjectSignal_projectId_idx" ON "ProjectSignal"("projectId");

-- CreateIndex
CREATE INDEX "ProjectSignal_sourceMarketSignalId_idx" ON "ProjectSignal"("sourceMarketSignalId");

-- CreateIndex
CREATE INDEX "ProjectSignal_sourceRelationshipEdgeId_idx" ON "ProjectSignal"("sourceRelationshipEdgeId");

-- CreateIndex
CREATE INDEX "ProjectSignal_sourceMarketLeadId_idx" ON "ProjectSignal"("sourceMarketLeadId");

-- CreateIndex
CREATE INDEX "ProjectSignal_sourceMarketSourceDocId_idx" ON "ProjectSignal"("sourceMarketSourceDocId");

-- CreateIndex
CREATE INDEX "ProjectSignal_signalKind_idx" ON "ProjectSignal"("signalKind");

-- CreateIndex
CREATE INDEX "ProjectSignal_attachedAt_idx" ON "ProjectSignal"("attachedAt");

-- CreateIndex
CREATE INDEX "ProjectEntity_projectId_idx" ON "ProjectEntity"("projectId");

-- CreateIndex
CREATE INDEX "ProjectEntity_entityId_idx" ON "ProjectEntity"("entityId");

-- CreateIndex
CREATE INDEX "ProjectEntity_role_idx" ON "ProjectEntity"("role");

-- CreateIndex
CREATE INDEX "ProjectEntity_removed_idx" ON "ProjectEntity"("removed");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEntity_projectId_entityId_role_key" ON "ProjectEntity"("projectId", "entityId", "role");

-- CreateIndex
CREATE INDEX "ProjectTimelineEvent_projectId_occurredAt_idx" ON "ProjectTimelineEvent"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProjectTimelineEvent_eventType_idx" ON "ProjectTimelineEvent"("eventType");

-- CreateIndex
CREATE INDEX "ProjectTimelineEvent_sourceRefId_idx" ON "ProjectTimelineEvent"("sourceRefId");

-- CreateIndex
CREATE INDEX "ProjectStateTransition_projectId_occurredAt_idx" ON "ProjectStateTransition"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProjectStateTransition_toState_idx" ON "ProjectStateTransition"("toState");

-- CreateIndex
CREATE INDEX "ProjectParcel_projectId_idx" ON "ProjectParcel"("projectId");

-- CreateIndex
CREATE INDEX "ProjectParcel_parcelId_idx" ON "ProjectParcel"("parcelId");

-- CreateIndex
CREATE INDEX "ProjectParcel_jurisdiction_idx" ON "ProjectParcel"("jurisdiction");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectParcel_projectId_parcelId_parcelSource_key" ON "ProjectParcel"("projectId", "parcelId", "parcelSource");

-- CreateIndex
CREATE INDEX "ProjectProbabilitySnapshot_projectId_computedAt_idx" ON "ProjectProbabilitySnapshot"("projectId", "computedAt");

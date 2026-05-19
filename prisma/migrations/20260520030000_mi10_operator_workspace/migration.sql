-- Phase MI-10 — Operator Intelligence Workspace + Strategic Action Layer
--
-- Additive schema: 10 new models. No existing table is altered.
--
-- Models:
--   Watchlist            — operator-curated list of subjects to watch
--   WatchlistItem        — list members (cascade from Watchlist)
--   AlertRule            — operator-defined alert criteria
--   AlertEvent           — fired alert (append-only)
--   AlertSubscription    — per-rule delivery subscription (cascade from Rule)
--   AlertExplanation     — structured explanation rows (cascade from Event)
--   BriefingDocument     — generated operator briefing
--   BriefingSection      — briefing content rows (cascade from Document)
--   TargetingPattern     — operator-curated detection pattern
--   WorkspacePreference  — per-user workspace state (unique on userId)
--
-- Reversibility: every new table is empty at migration time; rollback is
-- DROP TABLE IF EXISTS for the 10 tables in reverse-dependency order.

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT,
    "ownerEmail" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "subjectKind" TEXT NOT NULL DEFAULT 'MIXED',
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "ruleJson" TEXT,
    "tagsCsv" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "projectId" TEXT,
    "parcelId" TEXT,
    "entityId" TEXT,
    "displayLabel" TEXT,
    "displayContext" TEXT,
    "attachReason" TEXT NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "detachedAt" DATETIME,
    "detachedReason" TEXT,
    "detachedBy" TEXT,
    CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WatchlistItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WatchlistItem_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WatchlistItem_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT,
    "ownerEmail" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "triggerKind" TEXT NOT NULL,
    "severityFloor" TEXT NOT NULL DEFAULT 'WATCH',
    "criteriaJson" TEXT NOT NULL,
    "jurisdictionCsv" TEXT,
    "subjectKindCsv" TEXT,
    "lastEvaluatedAt" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 1440,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "projectId" TEXT,
    "parcelId" TEXT,
    "forecastSnapshotId" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'WATCH',
    "headline" TEXT NOT NULL,
    "detail" TEXT,
    "capturedScore" REAL,
    "capturedTrajectory" TEXT,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewStatus" TEXT NOT NULL DEFAULT 'UNREAD',
    "reviewedByUserId" TEXT,
    "reviewedByEmail" TEXT,
    "reviewedAt" DATETIME,
    "payloadJson" TEXT,
    CONSTRAINT "AlertEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AlertEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AlertEvent_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AlertEvent_forecastSnapshotId_fkey" FOREIGN KEY ("forecastSnapshotId") REFERENCES "ForecastSnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "subscriberUserId" TEXT,
    "subscriberEmail" TEXT,
    "deliveryChannel" TEXT NOT NULL DEFAULT 'IN_APP',
    "configJson" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AlertSubscription_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertExplanation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertId" TEXT NOT NULL,
    "factorKind" TEXT NOT NULL,
    "factorName" TEXT NOT NULL,
    "factorScore" REAL,
    "rationale" TEXT NOT NULL,
    "sourceRefKind" TEXT,
    "sourceRefId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlertExplanation_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "AlertEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BriefingDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "briefingKind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "windowEnd" DATETIME NOT NULL,
    "jurisdictionKey" TEXT,
    "corridorKey" TEXT,
    "watchlistId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT,
    "payloadJson" TEXT,
    "authoredByUserId" TEXT,
    "authoredByEmail" TEXT,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BriefingSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "briefingId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "sectionKind" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "payloadJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BriefingSection_briefingId_fkey" FOREIGN KEY ("briefingId") REFERENCES "BriefingDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TargetingPattern" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT,
    "ownerEmail" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "patternKind" TEXT NOT NULL,
    "criteriaJson" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "lastEvaluatedAt" DATETIME,
    "lastMatchedAt" DATETIME,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WorkspacePreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT,
    "layoutKind" TEXT NOT NULL DEFAULT 'DASHBOARD',
    "pinnedWatchlistsCsv" TEXT,
    "pinnedCorridorsCsv" TEXT,
    "defaultJurisdiction" TEXT,
    "preferencesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Watchlist_ownerUserId_idx" ON "Watchlist"("ownerUserId");

-- CreateIndex
CREATE INDEX "Watchlist_subjectKind_idx" ON "Watchlist"("subjectKind");

-- CreateIndex
CREATE INDEX "Watchlist_visibility_idx" ON "Watchlist"("visibility");

-- CreateIndex
CREATE INDEX "Watchlist_archivedAt_idx" ON "Watchlist"("archivedAt");

-- CreateIndex
CREATE INDEX "WatchlistItem_watchlistId_idx" ON "WatchlistItem"("watchlistId");

-- CreateIndex
CREATE INDEX "WatchlistItem_subjectKind_subjectId_idx" ON "WatchlistItem"("subjectKind", "subjectId");

-- CreateIndex
CREATE INDEX "WatchlistItem_projectId_idx" ON "WatchlistItem"("projectId");

-- CreateIndex
CREATE INDEX "WatchlistItem_parcelId_idx" ON "WatchlistItem"("parcelId");

-- CreateIndex
CREATE INDEX "WatchlistItem_entityId_idx" ON "WatchlistItem"("entityId");

-- CreateIndex
CREATE INDEX "WatchlistItem_detachedAt_idx" ON "WatchlistItem"("detachedAt");

-- CreateIndex
CREATE INDEX "WatchlistItem_priority_idx" ON "WatchlistItem"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_subjectKind_subjectId_key" ON "WatchlistItem"("watchlistId", "subjectKind", "subjectId");

-- CreateIndex
CREATE INDEX "AlertRule_ownerUserId_idx" ON "AlertRule"("ownerUserId");

-- CreateIndex
CREATE INDEX "AlertRule_triggerKind_idx" ON "AlertRule"("triggerKind");

-- CreateIndex
CREATE INDEX "AlertRule_active_idx" ON "AlertRule"("active");

-- CreateIndex
CREATE INDEX "AlertRule_lastEvaluatedAt_idx" ON "AlertRule"("lastEvaluatedAt");

-- CreateIndex
CREATE INDEX "AlertEvent_ruleId_capturedAt_idx" ON "AlertEvent"("ruleId", "capturedAt");

-- CreateIndex
CREATE INDEX "AlertEvent_subjectKind_subjectId_capturedAt_idx" ON "AlertEvent"("subjectKind", "subjectId", "capturedAt");

-- CreateIndex
CREATE INDEX "AlertEvent_projectId_capturedAt_idx" ON "AlertEvent"("projectId", "capturedAt");

-- CreateIndex
CREATE INDEX "AlertEvent_parcelId_capturedAt_idx" ON "AlertEvent"("parcelId", "capturedAt");

-- CreateIndex
CREATE INDEX "AlertEvent_reviewStatus_idx" ON "AlertEvent"("reviewStatus");

-- CreateIndex
CREATE INDEX "AlertEvent_severity_idx" ON "AlertEvent"("severity");

-- CreateIndex
CREATE INDEX "AlertEvent_capturedAt_idx" ON "AlertEvent"("capturedAt");

-- CreateIndex
CREATE INDEX "AlertSubscription_ruleId_idx" ON "AlertSubscription"("ruleId");

-- CreateIndex
CREATE INDEX "AlertSubscription_subscriberUserId_idx" ON "AlertSubscription"("subscriberUserId");

-- CreateIndex
CREATE INDEX "AlertSubscription_deliveryChannel_idx" ON "AlertSubscription"("deliveryChannel");

-- CreateIndex
CREATE INDEX "AlertSubscription_active_idx" ON "AlertSubscription"("active");

-- CreateIndex
CREATE UNIQUE INDEX "AlertSubscription_ruleId_subscriberEmail_deliveryChannel_key" ON "AlertSubscription"("ruleId", "subscriberEmail", "deliveryChannel");

-- CreateIndex
CREATE INDEX "AlertExplanation_alertId_idx" ON "AlertExplanation"("alertId");

-- CreateIndex
CREATE INDEX "AlertExplanation_factorKind_idx" ON "AlertExplanation"("factorKind");

-- CreateIndex
CREATE INDEX "BriefingDocument_briefingKind_idx" ON "BriefingDocument"("briefingKind");

-- CreateIndex
CREATE INDEX "BriefingDocument_status_idx" ON "BriefingDocument"("status");

-- CreateIndex
CREATE INDEX "BriefingDocument_windowStart_idx" ON "BriefingDocument"("windowStart");

-- CreateIndex
CREATE INDEX "BriefingDocument_jurisdictionKey_idx" ON "BriefingDocument"("jurisdictionKey");

-- CreateIndex
CREATE INDEX "BriefingDocument_corridorKey_idx" ON "BriefingDocument"("corridorKey");

-- CreateIndex
CREATE INDEX "BriefingDocument_watchlistId_idx" ON "BriefingDocument"("watchlistId");

-- CreateIndex
CREATE INDEX "BriefingSection_briefingId_position_idx" ON "BriefingSection"("briefingId", "position");

-- CreateIndex
CREATE INDEX "BriefingSection_sectionKind_idx" ON "BriefingSection"("sectionKind");

-- CreateIndex
CREATE INDEX "TargetingPattern_patternKind_idx" ON "TargetingPattern"("patternKind");

-- CreateIndex
CREATE INDEX "TargetingPattern_active_idx" ON "TargetingPattern"("active");

-- CreateIndex
CREATE INDEX "TargetingPattern_priority_idx" ON "TargetingPattern"("priority");

-- CreateIndex
CREATE INDEX "TargetingPattern_lastMatchedAt_idx" ON "TargetingPattern"("lastMatchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspacePreference_userId_key" ON "WorkspacePreference"("userId");

-- CreateIndex
CREATE INDEX "WorkspacePreference_userEmail_idx" ON "WorkspacePreference"("userEmail");

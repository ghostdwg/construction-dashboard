-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bidId" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Baseline Schedule',
    "startDate" DATETIME NOT NULL,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "baselinedAt" DATETIME,
    "weatherMode" TEXT NOT NULL DEFAULT 'BUFFER',
    "weatherStation" TEXT,
    "weatherBaseline" TEXT,
    "activeLayers" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Schedule_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduleActivityV2" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "activityCode" TEXT NOT NULL,
    "wbsId" TEXT NOT NULL DEFAULT '',
    "outlineLevel" INTEGER NOT NULL DEFAULT 3,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 5,
    "isSummary" BOOLEAN NOT NULL DEFAULT false,
    "isMilestone" BOOLEAN NOT NULL DEFAULT false,
    "csiCode" TEXT,
    "trade" TEXT,
    "weatherCode" TEXT NOT NULL DEFAULT 'WS-0',
    "requiresInspection" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiConfidence" TEXT,
    "layerSource" TEXT,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "percentComplete" REAL NOT NULL DEFAULT 0,
    "actualStart" DATETIME,
    "actualFinish" DATETIME,
    "remainingDuration" INTEGER,
    "delayReason" TEXT,
    "startDate" DATETIME,
    "finishDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScheduleActivityV2_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduleDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FS',
    "lag" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ScheduleDependency_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "ScheduleActivityV2" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScheduleDependency_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "ScheduleActivityV2" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduleVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "versionName" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduleVersion_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Schedule_bidId_idx" ON "Schedule"("bidId");

-- CreateIndex
CREATE INDEX "ScheduleActivityV2_scheduleId_idx" ON "ScheduleActivityV2"("scheduleId");

-- CreateIndex
CREATE INDEX "ScheduleActivityV2_scheduleId_sortOrder_idx" ON "ScheduleActivityV2"("scheduleId", "sortOrder");

-- CreateIndex
CREATE INDEX "ScheduleDependency_successorId_idx" ON "ScheduleDependency"("successorId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleDependency_predecessorId_successorId_type_key" ON "ScheduleDependency"("predecessorId", "successorId", "type");

-- CreateIndex
CREATE INDEX "ScheduleVersion_scheduleId_idx" ON "ScheduleVersion"("scheduleId");

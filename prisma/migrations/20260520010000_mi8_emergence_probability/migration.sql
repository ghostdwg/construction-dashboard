-- Phase MI-8 — Emergence Probability Engine + Forecasting Layer
--
-- Additive schema: 10 new models for deterministic-first emergence
-- forecasting. No existing table is altered.
--
-- Models:
--   ForecastSnapshot       — append-only forecast history per subject
--   EmergenceScore         — current composite score per subject
--   EmergenceTrajectory    — current trajectory state + shift detection
--   ProbabilityTrend       — short-window delta records for UI
--   ExpectedTimeline       — forecasted milestone dates
--   JurisdictionVelocity   — jurisdiction-level cadence metric
--   CorridorHeat           — corridor-level heat metric
--   DevelopmentMomentum    — developer-level momentum metric
--   SignalDecayProfile     — per-signalType decay configuration
--   ForecastExplanation    — structured per-factor explanations (cascade)
--
-- Reversibility: every new table is empty at migration time; rollback is
-- DROP TABLE IF EXISTS for the 10 new tables.

-- CreateTable
CREATE TABLE "ForecastSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "projectId" TEXT,
    "parcelId" TEXT,
    "emergenceScore" REAL NOT NULL,
    "accelerationIndex" REAL NOT NULL,
    "momentumScore" REAL NOT NULL,
    "decayScore" REAL NOT NULL,
    "corridorHeatScore" REAL,
    "jurisdictionVelocity" REAL,
    "trajectoryState" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "forecastVersion" TEXT NOT NULL DEFAULT 'v1',
    "reviewStatus" TEXT NOT NULL DEFAULT 'AUTO',
    "overriddenByUserId" TEXT,
    "overriddenByEmail" TEXT,
    "overrideReason" TEXT,
    "triggerReason" TEXT NOT NULL DEFAULT 'scheduled',
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payloadJson" TEXT NOT NULL,
    CONSTRAINT "ForecastSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ForecastSnapshot_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmergenceScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "projectId" TEXT,
    "parcelId" TEXT,
    "score" REAL NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "latestSnapshotId" TEXT,
    "latestComputedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmergenceScore_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EmergenceScore_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmergenceTrajectory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "projectId" TEXT,
    "parcelId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'EMERGING',
    "previousState" TEXT,
    "streakLength" INTEGER NOT NULL DEFAULT 1,
    "stateEnteredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shortTermDelta" REAL NOT NULL DEFAULT 0,
    "longTermDelta" REAL NOT NULL DEFAULT 0,
    "acceleration" REAL NOT NULL DEFAULT 0,
    "shiftDetected" BOOLEAN NOT NULL DEFAULT false,
    "shiftReason" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmergenceTrajectory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EmergenceTrajectory_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProbabilityTrend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "projectId" TEXT,
    "parcelId" TEXT,
    "previousScore" REAL NOT NULL,
    "currentScore" REAL NOT NULL,
    "delta" REAL NOT NULL,
    "direction" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "snapshotId" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProbabilityTrend_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProbabilityTrend_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExpectedTimeline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "projectId" TEXT,
    "parcelId" TEXT,
    "milestoneKind" TEXT NOT NULL,
    "earliestEstimate" DATETIME,
    "expectedEstimate" DATETIME,
    "latestEstimate" DATETIME,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "rationale" TEXT,
    "latestSnapshotId" TEXT,
    "latestComputedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExpectedTimeline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ExpectedTimeline_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JurisdictionVelocity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jurisdictionKey" TEXT NOT NULL,
    "jurisdictionLabel" TEXT NOT NULL,
    "newProjectsLast30d" INTEGER NOT NULL DEFAULT 0,
    "newProjectsLast90d" INTEGER NOT NULL DEFAULT 0,
    "newProjectsLast365d" INTEGER NOT NULL DEFAULT 0,
    "newSignalsLast30d" INTEGER NOT NULL DEFAULT 0,
    "newSignalsLast90d" INTEGER NOT NULL DEFAULT 0,
    "velocityScore" REAL NOT NULL DEFAULT 0,
    "cadenceClass" TEXT NOT NULL DEFAULT 'STEADY',
    "acceleration" REAL NOT NULL DEFAULT 0,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CorridorHeat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "corridorKey" TEXT NOT NULL,
    "corridorLabel" TEXT NOT NULL,
    "memberParcelIds" TEXT NOT NULL,
    "memberSetTruncated" BOOLEAN NOT NULL DEFAULT false,
    "heatScore" REAL NOT NULL,
    "meanPressure" REAL NOT NULL DEFAULT 0,
    "acceleration" REAL NOT NULL DEFAULT 0,
    "activeMembers" INTEGER NOT NULL DEFAULT 0,
    "classification" TEXT NOT NULL DEFAULT 'STEADY',
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DevelopmentMomentum" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "developerEntityId" TEXT NOT NULL,
    "developerNameCache" TEXT,
    "newProjectsLast30d" INTEGER NOT NULL DEFAULT 0,
    "newProjectsLast90d" INTEGER NOT NULL DEFAULT 0,
    "newProjectsLast365d" INTEGER NOT NULL DEFAULT 0,
    "newParcelsLast90d" INTEGER NOT NULL DEFAULT 0,
    "momentumScore" REAL NOT NULL DEFAULT 0,
    "acceleration" REAL NOT NULL DEFAULT 0,
    "classification" TEXT NOT NULL DEFAULT 'DORMANT',
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SignalDecayProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signalType" TEXT NOT NULL,
    "curveShape" TEXT NOT NULL DEFAULT 'EXPONENTIAL',
    "halfLifeDays" INTEGER NOT NULL DEFAULT 60,
    "floorWeight" REAL NOT NULL DEFAULT 0,
    "baseWeight" REAL NOT NULL DEFAULT 1,
    "notes" TEXT,
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ForecastExplanation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "factorKind" TEXT NOT NULL,
    "factorName" TEXT NOT NULL,
    "factorScore" REAL NOT NULL,
    "factorWeight" REAL NOT NULL,
    "contribution" REAL NOT NULL,
    "sourceRefKind" TEXT,
    "sourceRefId" TEXT,
    "rationale" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ForecastExplanation_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ForecastSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ForecastSnapshot_subjectKind_subjectId_computedAt_idx" ON "ForecastSnapshot"("subjectKind", "subjectId", "computedAt");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_projectId_computedAt_idx" ON "ForecastSnapshot"("projectId", "computedAt");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_parcelId_computedAt_idx" ON "ForecastSnapshot"("parcelId", "computedAt");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_emergenceScore_idx" ON "ForecastSnapshot"("emergenceScore");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_trajectoryState_idx" ON "ForecastSnapshot"("trajectoryState");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_reviewStatus_idx" ON "ForecastSnapshot"("reviewStatus");

-- CreateIndex
CREATE INDEX "ForecastSnapshot_forecastVersion_idx" ON "ForecastSnapshot"("forecastVersion");

-- CreateIndex
CREATE INDEX "EmergenceScore_projectId_idx" ON "EmergenceScore"("projectId");

-- CreateIndex
CREATE INDEX "EmergenceScore_parcelId_idx" ON "EmergenceScore"("parcelId");

-- CreateIndex
CREATE INDEX "EmergenceScore_score_idx" ON "EmergenceScore"("score");

-- CreateIndex
CREATE INDEX "EmergenceScore_latestComputedAt_idx" ON "EmergenceScore"("latestComputedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmergenceScore_subjectKind_subjectId_key" ON "EmergenceScore"("subjectKind", "subjectId");

-- CreateIndex
CREATE INDEX "EmergenceTrajectory_state_idx" ON "EmergenceTrajectory"("state");

-- CreateIndex
CREATE INDEX "EmergenceTrajectory_projectId_idx" ON "EmergenceTrajectory"("projectId");

-- CreateIndex
CREATE INDEX "EmergenceTrajectory_parcelId_idx" ON "EmergenceTrajectory"("parcelId");

-- CreateIndex
CREATE INDEX "EmergenceTrajectory_shiftDetected_idx" ON "EmergenceTrajectory"("shiftDetected");

-- CreateIndex
CREATE UNIQUE INDEX "EmergenceTrajectory_subjectKind_subjectId_key" ON "EmergenceTrajectory"("subjectKind", "subjectId");

-- CreateIndex
CREATE INDEX "ProbabilityTrend_subjectKind_subjectId_recordedAt_idx" ON "ProbabilityTrend"("subjectKind", "subjectId", "recordedAt");

-- CreateIndex
CREATE INDEX "ProbabilityTrend_projectId_recordedAt_idx" ON "ProbabilityTrend"("projectId", "recordedAt");

-- CreateIndex
CREATE INDEX "ProbabilityTrend_parcelId_recordedAt_idx" ON "ProbabilityTrend"("parcelId", "recordedAt");

-- CreateIndex
CREATE INDEX "ProbabilityTrend_direction_idx" ON "ProbabilityTrend"("direction");

-- CreateIndex
CREATE INDEX "ProbabilityTrend_windowDays_idx" ON "ProbabilityTrend"("windowDays");

-- CreateIndex
CREATE INDEX "ExpectedTimeline_projectId_idx" ON "ExpectedTimeline"("projectId");

-- CreateIndex
CREATE INDEX "ExpectedTimeline_parcelId_idx" ON "ExpectedTimeline"("parcelId");

-- CreateIndex
CREATE INDEX "ExpectedTimeline_milestoneKind_idx" ON "ExpectedTimeline"("milestoneKind");

-- CreateIndex
CREATE INDEX "ExpectedTimeline_expectedEstimate_idx" ON "ExpectedTimeline"("expectedEstimate");

-- CreateIndex
CREATE UNIQUE INDEX "ExpectedTimeline_subjectKind_subjectId_milestoneKind_key" ON "ExpectedTimeline"("subjectKind", "subjectId", "milestoneKind");

-- CreateIndex
CREATE UNIQUE INDEX "JurisdictionVelocity_jurisdictionKey_key" ON "JurisdictionVelocity"("jurisdictionKey");

-- CreateIndex
CREATE INDEX "JurisdictionVelocity_cadenceClass_idx" ON "JurisdictionVelocity"("cadenceClass");

-- CreateIndex
CREATE INDEX "JurisdictionVelocity_velocityScore_idx" ON "JurisdictionVelocity"("velocityScore");

-- CreateIndex
CREATE INDEX "JurisdictionVelocity_acceleration_idx" ON "JurisdictionVelocity"("acceleration");

-- CreateIndex
CREATE UNIQUE INDEX "CorridorHeat_corridorKey_key" ON "CorridorHeat"("corridorKey");

-- CreateIndex
CREATE INDEX "CorridorHeat_classification_idx" ON "CorridorHeat"("classification");

-- CreateIndex
CREATE INDEX "CorridorHeat_heatScore_idx" ON "CorridorHeat"("heatScore");

-- CreateIndex
CREATE INDEX "CorridorHeat_acceleration_idx" ON "CorridorHeat"("acceleration");

-- CreateIndex
CREATE UNIQUE INDEX "DevelopmentMomentum_developerEntityId_key" ON "DevelopmentMomentum"("developerEntityId");

-- CreateIndex
CREATE INDEX "DevelopmentMomentum_classification_idx" ON "DevelopmentMomentum"("classification");

-- CreateIndex
CREATE INDEX "DevelopmentMomentum_momentumScore_idx" ON "DevelopmentMomentum"("momentumScore");

-- CreateIndex
CREATE INDEX "DevelopmentMomentum_acceleration_idx" ON "DevelopmentMomentum"("acceleration");

-- CreateIndex
CREATE UNIQUE INDEX "SignalDecayProfile_signalType_key" ON "SignalDecayProfile"("signalType");

-- CreateIndex
CREATE INDEX "SignalDecayProfile_signalType_idx" ON "SignalDecayProfile"("signalType");

-- CreateIndex
CREATE INDEX "SignalDecayProfile_curveShape_idx" ON "SignalDecayProfile"("curveShape");

-- CreateIndex
CREATE INDEX "ForecastExplanation_snapshotId_idx" ON "ForecastExplanation"("snapshotId");

-- CreateIndex
CREATE INDEX "ForecastExplanation_factorKind_idx" ON "ForecastExplanation"("factorKind");

-- CreateIndex
CREATE INDEX "ForecastExplanation_factorName_idx" ON "ForecastExplanation"("factorName");

-- CreateIndex
CREATE INDEX "ForecastExplanation_contribution_idx" ON "ForecastExplanation"("contribution");

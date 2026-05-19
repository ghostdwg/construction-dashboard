-- Phase MI-9 — Outcome Tracking + Forecast Calibration
--
-- Additive schema: 10 new models. No existing table is altered.
--
-- Models:
--   Outcome             — canonical record of an observed real-world event
--   OutcomeEvidence     — supporting evidence rows (cascade from Outcome)
--   OutcomeResolution   — (Outcome, ForecastSnapshot) pair scoring
--   ForecastAccuracy    — per-resolution per-kind accuracy row
--   ForecastCalibration — operator-tunable per-scope adjustments
--   TrajectoryOutcome   — predicted vs actual trajectory alignment
--   TimelineAccuracy    — milestone-date variance
--   FalsePositive       — high-conf prediction that did not materialize
--   FalseNegative       — outcome with no preceding prediction
--   CalibrationSnapshot — append-only overall-calibration time series
--   ResolutionState     — state-machine config for resolution transitions
--
-- Reversibility: every new table is empty at migration time; rollback is
-- DROP TABLE IF EXISTS for the 11 tables in reverse-dependency order.

-- CreateTable
CREATE TABLE "Outcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "projectId" TEXT,
    "parcelId" TEXT,
    "outcomeKind" TEXT NOT NULL,
    "outcomeLabel" TEXT,
    "detectionMethod" TEXT NOT NULL DEFAULT 'AUTOMATIC',
    "occurredAt" DATETIME NOT NULL,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcomeConfidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "notes" TEXT,
    "payloadJson" TEXT,
    "supersededByOutcomeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Outcome_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Outcome_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Outcome_supersededByOutcomeId_fkey" FOREIGN KEY ("supersededByOutcomeId") REFERENCES "Outcome" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutcomeEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outcomeId" TEXT NOT NULL,
    "evidenceKind" TEXT NOT NULL,
    "sourceRefKind" TEXT,
    "sourceRefId" TEXT,
    "sourceUrl" TEXT,
    "capturedAt" DATETIME NOT NULL,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rationale" TEXT NOT NULL,
    "payloadJson" TEXT,
    "vouchedByUserId" TEXT,
    "vouchedByEmail" TEXT,
    "vouchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OutcomeEvidence_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "Outcome" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutcomeResolution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outcomeId" TEXT NOT NULL,
    "forecastSnapshotId" TEXT,
    "resolutionState" TEXT NOT NULL DEFAULT 'PENDING',
    "predictionPosture" TEXT NOT NULL DEFAULT 'UNPREDICTED',
    "predictedScore" REAL,
    "predictedTrajectory" TEXT,
    "predictedAt" DATETIME,
    "leadTimeDays" REAL,
    "resolvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedByUserId" TEXT,
    "resolvedByEmail" TEXT,
    "resolutionNotes" TEXT,
    "calibrationVersion" TEXT NOT NULL DEFAULT 'v1',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OutcomeResolution_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "Outcome" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OutcomeResolution_forecastSnapshotId_fkey" FOREIGN KEY ("forecastSnapshotId") REFERENCES "ForecastSnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ForecastAccuracy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resolutionId" TEXT NOT NULL,
    "accuracyKind" TEXT NOT NULL,
    "accuracyScore" REAL NOT NULL,
    "brierScore" REAL,
    "timelineErrorDays" REAL,
    "withinExpectedBand" BOOLEAN,
    "rationale" TEXT NOT NULL,
    "payloadJson" TEXT,
    "evaluationVersion" TEXT NOT NULL DEFAULT 'v1',
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ForecastAccuracy_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "OutcomeResolution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ForecastCalibration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "scopeKey" TEXT,
    "factorName" TEXT,
    "adjustmentKind" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "source" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "calibrationVersion" TEXT NOT NULL DEFAULT 'v1',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TrajectoryOutcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resolutionId" TEXT NOT NULL,
    "predictedState" TEXT NOT NULL,
    "actualState" TEXT,
    "alignment" TEXT NOT NULL DEFAULT 'INCONCLUSIVE',
    "shiftCorrect" BOOLEAN,
    "shiftMissed" BOOLEAN,
    "rationale" TEXT,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrajectoryOutcome_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "OutcomeResolution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TimelineAccuracy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resolutionId" TEXT NOT NULL,
    "milestoneKind" TEXT NOT NULL,
    "expectedAt" DATETIME,
    "earliestAt" DATETIME,
    "latestAt" DATETIME,
    "actualAt" DATETIME NOT NULL,
    "errorDays" REAL NOT NULL,
    "absoluteErrorDays" REAL NOT NULL,
    "withinBand" BOOLEAN NOT NULL,
    "jurisdictionAdjustedErrorDays" REAL,
    "rationale" TEXT,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TimelineAccuracy_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "OutcomeResolution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FalsePositive" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "forecastSnapshotId" TEXT,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "predictedScore" REAL NOT NULL,
    "predictedTrajectory" TEXT,
    "predictedAt" DATETIME NOT NULL,
    "disconfirmingOutcomeId" TEXT,
    "expectedByLatest" DATETIME NOT NULL,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reasonClass" TEXT NOT NULL DEFAULT 'OTHER',
    "notes" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'AUTO',
    "reviewedByUserId" TEXT,
    "reviewedByEmail" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FalsePositive_disconfirmingOutcomeId_fkey" FOREIGN KEY ("disconfirmingOutcomeId") REFERENCES "Outcome" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FalseNegative" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outcomeId" TEXT NOT NULL,
    "subjectKind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "precedingSnapshotId" TEXT,
    "precedingScore" REAL,
    "precedingTrajectory" TEXT,
    "precedingAt" DATETIME,
    "missedByDays" REAL,
    "reasonClass" TEXT NOT NULL DEFAULT 'OTHER',
    "notes" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'AUTO',
    "reviewedByUserId" TEXT,
    "reviewedByEmail" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FalseNegative_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "Outcome" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CalibrationSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "scopeKey" TEXT,
    "resolutionCount" INTEGER NOT NULL,
    "confirmedCount" INTEGER NOT NULL,
    "partialCount" INTEGER NOT NULL,
    "disconfirmedCount" INTEGER NOT NULL,
    "meanProbabilityAccuracy" REAL,
    "meanBrierScore" REAL,
    "meanTimelineErrorDays" REAL,
    "trajectoryAlignmentRate" REAL,
    "falsePositiveCount" INTEGER NOT NULL DEFAULT 0,
    "falseNegativeCount" INTEGER NOT NULL DEFAULT 0,
    "activeAdjustmentsJson" TEXT,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calibrationVersion" TEXT NOT NULL DEFAULT 'v1',
    "triggerReason" TEXT NOT NULL DEFAULT 'scheduled'
);

-- CreateTable
CREATE TABLE "ResolutionState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "state" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "allowedTransitions" TEXT NOT NULL DEFAULT '',
    "contributesToAccuracy" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Outcome_subjectKind_subjectId_occurredAt_idx" ON "Outcome"("subjectKind", "subjectId", "occurredAt");

-- CreateIndex
CREATE INDEX "Outcome_outcomeKind_idx" ON "Outcome"("outcomeKind");

-- CreateIndex
CREATE INDEX "Outcome_projectId_idx" ON "Outcome"("projectId");

-- CreateIndex
CREATE INDEX "Outcome_parcelId_idx" ON "Outcome"("parcelId");

-- CreateIndex
CREATE INDEX "Outcome_occurredAt_idx" ON "Outcome"("occurredAt");

-- CreateIndex
CREATE INDEX "Outcome_observedAt_idx" ON "Outcome"("observedAt");

-- CreateIndex
CREATE INDEX "Outcome_supersededByOutcomeId_idx" ON "Outcome"("supersededByOutcomeId");

-- CreateIndex
CREATE INDEX "OutcomeEvidence_outcomeId_idx" ON "OutcomeEvidence"("outcomeId");

-- CreateIndex
CREATE INDEX "OutcomeEvidence_evidenceKind_idx" ON "OutcomeEvidence"("evidenceKind");

-- CreateIndex
CREATE INDEX "OutcomeEvidence_capturedAt_idx" ON "OutcomeEvidence"("capturedAt");

-- CreateIndex
CREATE INDEX "OutcomeEvidence_sourceRefKind_sourceRefId_idx" ON "OutcomeEvidence"("sourceRefKind", "sourceRefId");

-- CreateIndex
CREATE INDEX "OutcomeResolution_outcomeId_idx" ON "OutcomeResolution"("outcomeId");

-- CreateIndex
CREATE INDEX "OutcomeResolution_forecastSnapshotId_idx" ON "OutcomeResolution"("forecastSnapshotId");

-- CreateIndex
CREATE INDEX "OutcomeResolution_resolutionState_idx" ON "OutcomeResolution"("resolutionState");

-- CreateIndex
CREATE INDEX "OutcomeResolution_predictionPosture_idx" ON "OutcomeResolution"("predictionPosture");

-- CreateIndex
CREATE INDEX "OutcomeResolution_resolvedAt_idx" ON "OutcomeResolution"("resolvedAt");

-- CreateIndex
CREATE INDEX "ForecastAccuracy_resolutionId_idx" ON "ForecastAccuracy"("resolutionId");

-- CreateIndex
CREATE INDEX "ForecastAccuracy_accuracyKind_idx" ON "ForecastAccuracy"("accuracyKind");

-- CreateIndex
CREATE INDEX "ForecastAccuracy_accuracyScore_idx" ON "ForecastAccuracy"("accuracyScore");

-- CreateIndex
CREATE INDEX "ForecastAccuracy_computedAt_idx" ON "ForecastAccuracy"("computedAt");

-- CreateIndex
CREATE INDEX "ForecastCalibration_scope_scopeKey_idx" ON "ForecastCalibration"("scope", "scopeKey");

-- CreateIndex
CREATE INDEX "ForecastCalibration_factorName_idx" ON "ForecastCalibration"("factorName");

-- CreateIndex
CREATE INDEX "ForecastCalibration_adjustmentKind_idx" ON "ForecastCalibration"("adjustmentKind");

-- CreateIndex
CREATE INDEX "ForecastCalibration_active_idx" ON "ForecastCalibration"("active");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastCalibration_scope_scopeKey_factorName_adjustmentKind_key" ON "ForecastCalibration"("scope", "scopeKey", "factorName", "adjustmentKind");

-- CreateIndex
CREATE INDEX "TrajectoryOutcome_resolutionId_idx" ON "TrajectoryOutcome"("resolutionId");

-- CreateIndex
CREATE INDEX "TrajectoryOutcome_alignment_idx" ON "TrajectoryOutcome"("alignment");

-- CreateIndex
CREATE INDEX "TrajectoryOutcome_shiftMissed_idx" ON "TrajectoryOutcome"("shiftMissed");

-- CreateIndex
CREATE INDEX "TimelineAccuracy_resolutionId_idx" ON "TimelineAccuracy"("resolutionId");

-- CreateIndex
CREATE INDEX "TimelineAccuracy_milestoneKind_idx" ON "TimelineAccuracy"("milestoneKind");

-- CreateIndex
CREATE INDEX "TimelineAccuracy_errorDays_idx" ON "TimelineAccuracy"("errorDays");

-- CreateIndex
CREATE INDEX "TimelineAccuracy_withinBand_idx" ON "TimelineAccuracy"("withinBand");

-- CreateIndex
CREATE INDEX "FalsePositive_subjectKind_subjectId_idx" ON "FalsePositive"("subjectKind", "subjectId");

-- CreateIndex
CREATE INDEX "FalsePositive_forecastSnapshotId_idx" ON "FalsePositive"("forecastSnapshotId");

-- CreateIndex
CREATE INDEX "FalsePositive_reasonClass_idx" ON "FalsePositive"("reasonClass");

-- CreateIndex
CREATE INDEX "FalsePositive_reviewStatus_idx" ON "FalsePositive"("reviewStatus");

-- CreateIndex
CREATE INDEX "FalsePositive_expectedByLatest_idx" ON "FalsePositive"("expectedByLatest");

-- CreateIndex
CREATE INDEX "FalsePositive_detectedAt_idx" ON "FalsePositive"("detectedAt");

-- CreateIndex
CREATE INDEX "FalseNegative_outcomeId_idx" ON "FalseNegative"("outcomeId");

-- CreateIndex
CREATE INDEX "FalseNegative_subjectKind_subjectId_idx" ON "FalseNegative"("subjectKind", "subjectId");

-- CreateIndex
CREATE INDEX "FalseNegative_reasonClass_idx" ON "FalseNegative"("reasonClass");

-- CreateIndex
CREATE INDEX "FalseNegative_reviewStatus_idx" ON "FalseNegative"("reviewStatus");

-- CreateIndex
CREATE INDEX "FalseNegative_precedingAt_idx" ON "FalseNegative"("precedingAt");

-- CreateIndex
CREATE INDEX "CalibrationSnapshot_scope_scopeKey_computedAt_idx" ON "CalibrationSnapshot"("scope", "scopeKey", "computedAt");

-- CreateIndex
CREATE INDEX "CalibrationSnapshot_calibrationVersion_idx" ON "CalibrationSnapshot"("calibrationVersion");

-- CreateIndex
CREATE INDEX "CalibrationSnapshot_computedAt_idx" ON "CalibrationSnapshot"("computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResolutionState_state_key" ON "ResolutionState"("state");

-- CreateIndex
CREATE INDEX "ResolutionState_state_idx" ON "ResolutionState"("state");

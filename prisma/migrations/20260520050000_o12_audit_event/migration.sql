-- Phase O1.2 — AuditEvent (cross-cutting observability persistence).
--
-- Single canonical table for audit events that must outlive Loki retention.
-- The existing 7 service stdout audit emitters continue unchanged; this
-- table is for the subset routed by lib/observability/audit.ts based on
-- DB_PERSISTED_CATEGORIES in taxonomy.ts.
--
-- Categories routed here include: operator_override, merge_split,
-- replay_run, migration_governance, runner_cycle, review_action,
-- alert_review, calibration_adjustment, ingestion_pipeline_error,
-- system_health.
--
-- Append-only by code contract. No service writes UPDATE or DELETE.
-- Retention is operational (future O3 retention job), not architectural.

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "subjectKind" TEXT,
    "subjectId" TEXT,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "actorKind" TEXT NOT NULL DEFAULT 'system',
    "correlationId" TEXT,
    "replayId" TEXT,
    "ingestionId" TEXT,
    "runnerId" TEXT,
    "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
    "versionTagsJson" TEXT,
    "decision" TEXT,
    "reasonLog" TEXT,
    "payloadJson" TEXT,
    "emittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AuditEvent_category_emittedAt_idx" ON "AuditEvent"("category", "emittedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "AuditEvent_subjectKind_subjectId_idx" ON "AuditEvent"("subjectKind", "subjectId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");

-- CreateIndex
CREATE INDEX "AuditEvent_replayId_idx" ON "AuditEvent"("replayId");

-- CreateIndex
CREATE INDEX "AuditEvent_ingestionId_idx" ON "AuditEvent"("ingestionId");

-- CreateIndex
CREATE INDEX "AuditEvent_runnerId_idx" ON "AuditEvent"("runnerId");

-- CreateIndex
CREATE INDEX "AuditEvent_severity_idx" ON "AuditEvent"("severity");

-- CreateIndex
CREATE INDEX "AuditEvent_emittedAt_idx" ON "AuditEvent"("emittedAt");

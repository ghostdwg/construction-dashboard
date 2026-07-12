-- Module OPS3 (Phase 1A) — Consultant Reports.
-- Additive only: three new tables + five nullable columns on TrackedItem.
-- Forward-only; applied ONLY via scripts/apply-turso-migrations.mjs by the
-- operator (never auto-run, never by a model). Every nullable FK is
-- SET NULL, never CASCADE onto TrackedItem — voiding or removing a source
-- record must never destroy Register history. No backfill, no default that
-- touches existing rows: the schema is dark to the currently-running image.

CREATE TABLE "ConsultantReport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bidId" INTEGER NOT NULL,
    "vendorName" TEXT NOT NULL,
    "title" TEXT,
    "reportNumber" TEXT,
    "reportNumberNormalized" TEXT,
    "reportType" TEXT NOT NULL,
    "reportDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "voidedBy" TEXT,
    "voidedAt" DATETIME,
    "uploadedBy" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ConsultantReport_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ConsultantReport_bidId_idx" ON "ConsultantReport"("bidId");
CREATE INDEX "ConsultantReport_bidId_status_idx" ON "ConsultantReport"("bidId", "status");
CREATE INDEX "ConsultantReport_bidId_reportNumberNormalized_idx" ON "ConsultantReport"("bidId", "reportNumberNormalized");

CREATE TABLE "ConsultantReportRevision" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportId" INTEGER NOT NULL,
    "bidId" INTEGER NOT NULL,
    "revisionIndex" INTEGER NOT NULL DEFAULT 0,
    "storedKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacementReason" TEXT,
    "supersedesRevisionId" INTEGER,
    CONSTRAINT "ConsultantReportRevision_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ConsultantReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConsultantReportRevision_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConsultantReportRevision_supersedesRevisionId_fkey" FOREIGN KEY ("supersedesRevisionId") REFERENCES "ConsultantReportRevision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ConsultantReportRevision_supersedesRevisionId_key" ON "ConsultantReportRevision"("supersedesRevisionId");
CREATE UNIQUE INDEX "ConsultantReportRevision_bidId_checksum_key" ON "ConsultantReportRevision"("bidId", "checksum");
CREATE INDEX "ConsultantReportRevision_reportId_idx" ON "ConsultantReportRevision"("reportId");
CREATE INDEX "ConsultantReportRevision_bidId_idx" ON "ConsultantReportRevision"("bidId");

CREATE TABLE "ConsultantObservation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportId" INTEGER NOT NULL,
    "bidId" INTEGER NOT NULL,
    "observationText" TEXT NOT NULL,
    "sourcePage" TEXT,
    "consultantTargetDate" DATETIME,
    "state" TEXT NOT NULL DEFAULT 'ENTERED',
    "registerItemId" INTEGER,
    "dismissedReason" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ConsultantObservation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ConsultantReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConsultantObservation_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConsultantObservation_registerItemId_fkey" FOREIGN KEY ("registerItemId") REFERENCES "TrackedItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ConsultantObservation_reportId_state_idx" ON "ConsultantObservation"("reportId", "state");
CREATE INDEX "ConsultantObservation_bidId_idx" ON "ConsultantObservation"("bidId");
CREATE INDEX "ConsultantObservation_registerItemId_idx" ON "ConsultantObservation"("registerItemId");

ALTER TABLE "TrackedItem" ADD COLUMN "sourceConsultantObservationId" INTEGER
    REFERENCES "ConsultantObservation" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrackedItem" ADD COLUMN "formalResponse" TEXT;
ALTER TABLE "TrackedItem" ADD COLUMN "formalResponseBy" TEXT;
ALTER TABLE "TrackedItem" ADD COLUMN "formalResponseAt" DATETIME;
ALTER TABLE "TrackedItem" ADD COLUMN "formalResponsePrior" TEXT;

CREATE UNIQUE INDEX "TrackedItem_sourceConsultantObservationId_key" ON "TrackedItem"("sourceConsultantObservationId");

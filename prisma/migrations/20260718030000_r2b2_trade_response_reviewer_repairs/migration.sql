-- R2 Build 2 reviewer repairs: retention, provenance, immutable GC review,
-- and shared external rate-limit coordination.
-- Forward-only and data-preserving. This migration intentionally does not
-- touch the separate legacy FieldReport/TrackedItem audit-remediation lane.

PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ReportObservation" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "bidId" INTEGER NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "fieldReportId" INTEGER,
  "consultantReportId" INTEGER,
  "observationText" TEXT NOT NULL,
  "sourceLocator" TEXT,
  "observedAt" DATETIME,
  "disposition" TEXT NOT NULL DEFAULT 'OPEN',
  "dispositionBy" TEXT,
  "dispositionAt" DATETIME,
  "dispositionReason" TEXT,
  "registerItemId" INTEGER,
  "createdBy" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ReportObservation_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReportObservation_fieldReportId_fkey" FOREIGN KEY ("fieldReportId") REFERENCES "FieldReport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReportObservation_consultantReportId_fkey" FOREIGN KEY ("consultantReportId") REFERENCES "ConsultantReport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReportObservation_registerItemId_fkey" FOREIGN KEY ("registerItemId") REFERENCES "TrackedItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReportObservation_exactly_one_source_check" CHECK (
    ("sourceKind" = 'field_report' AND "fieldReportId" IS NOT NULL AND "consultantReportId" IS NULL) OR
    ("sourceKind" = 'consultant_report' AND "fieldReportId" IS NULL AND "consultantReportId" IS NOT NULL) OR
    ("sourceKind" = 'direct_entry' AND "fieldReportId" IS NULL AND "consultantReportId" IS NULL)
  )
);
INSERT INTO "new_ReportObservation" ("id", "bidId", "sourceKind", "fieldReportId", "consultantReportId", "observationText", "sourceLocator", "observedAt", "disposition", "dispositionBy", "dispositionAt", "dispositionReason", "registerItemId", "createdBy", "createdAt", "updatedAt")
SELECT "id", "bidId", "sourceKind", "fieldReportId", "consultantReportId", "observationText", "sourceLocator", "observedAt", "disposition", "dispositionBy", "dispositionAt", "dispositionReason", "registerItemId", "createdBy", "createdAt", "updatedAt" FROM "ReportObservation";
DROP TABLE "ReportObservation";
ALTER TABLE "new_ReportObservation" RENAME TO "ReportObservation";
CREATE INDEX "ReportObservation_bidId_disposition_idx" ON "ReportObservation"("bidId", "disposition");
CREATE INDEX "ReportObservation_fieldReportId_idx" ON "ReportObservation"("fieldReportId");
CREATE INDEX "ReportObservation_consultantReportId_idx" ON "ReportObservation"("consultantReportId");
CREATE INDEX "ReportObservation_registerItemId_idx" ON "ReportObservation"("registerItemId");

CREATE TABLE "new_ResponsePackage" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "bidId" INTEGER NOT NULL,
  "packageNumber" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "contractorId" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "issuedAt" DATETIME,
  "issuedBy" TEXT,
  "responseDueDate" DATETIME,
  "manualChannel" TEXT,
  "voidedBy" TEXT,
  "voidedAt" DATETIME,
  "createdBy" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ResponsePackage_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResponsePackage_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Subcontractor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResponsePackage_manualChannel_check" CHECK ("manualChannel" IS NULL OR "manualChannel" IN ('EMAIL', 'PROCORE', 'OTHER'))
);
INSERT INTO "new_ResponsePackage" ("id", "bidId", "packageNumber", "title", "contractorId", "status", "issuedAt", "issuedBy", "responseDueDate", "manualChannel", "voidedBy", "voidedAt", "createdBy", "createdAt", "updatedAt")
SELECT "id", "bidId", "packageNumber", "title", "contractorId", "status", "issuedAt", "issuedBy", "responseDueDate", "manualChannel", "voidedBy", "voidedAt", "createdBy", "createdAt", "updatedAt" FROM "ResponsePackage";
DROP TABLE "ResponsePackage";
ALTER TABLE "new_ResponsePackage" RENAME TO "ResponsePackage";
CREATE UNIQUE INDEX "ResponsePackage_bidId_packageNumber_key" ON "ResponsePackage"("bidId", "packageNumber");
CREATE INDEX "ResponsePackage_bidId_status_idx" ON "ResponsePackage"("bidId", "status");
CREATE INDEX "ResponsePackage_bidId_contractorId_idx" ON "ResponsePackage"("bidId", "contractorId");

CREATE TABLE "new_ResponsePackageItem" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "packageId" INTEGER NOT NULL,
  "bidId" INTEGER NOT NULL,
  "trackedItemId" INTEGER NOT NULL,
  "displayNumber" TEXT,
  CONSTRAINT "ResponsePackageItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ResponsePackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResponsePackageItem_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResponsePackageItem_trackedItemId_fkey" FOREIGN KEY ("trackedItemId") REFERENCES "TrackedItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ResponsePackageItem" ("id", "packageId", "bidId", "trackedItemId", "displayNumber")
SELECT "id", "packageId", "bidId", "trackedItemId", "displayNumber" FROM "ResponsePackageItem";
DROP TABLE "ResponsePackageItem";
ALTER TABLE "new_ResponsePackageItem" RENAME TO "ResponsePackageItem";
CREATE UNIQUE INDEX "ResponsePackageItem_packageId_trackedItemId_key" ON "ResponsePackageItem"("packageId", "trackedItemId");
CREATE INDEX "ResponsePackageItem_bidId_packageId_idx" ON "ResponsePackageItem"("bidId", "packageId");
CREATE INDEX "ResponsePackageItem_bidId_trackedItemId_idx" ON "ResponsePackageItem"("bidId", "trackedItemId");

CREATE TABLE "new_TradeResponseRevision" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "bidId" INTEGER NOT NULL,
  "packageItemId" INTEGER NOT NULL,
  "revisionIndex" INTEGER NOT NULL DEFAULT 0,
  "responderName" TEXT NOT NULL,
  "responderCompany" TEXT,
  "channel" TEXT NOT NULL DEFAULT 'PORTAL',
  "responseType" TEXT NOT NULL,
  "responseText" TEXT NOT NULL,
  "proposedCompletionDate" DATETIME,
  "actualCompletionDate" DATETIME,
  "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enteredBy" TEXT,
  "gcReview" TEXT NOT NULL DEFAULT 'PENDING',
  "gcReviewBy" TEXT,
  "gcReviewAt" DATETIME,
  "gcCommentary" TEXT,
  CONSTRAINT "TradeResponseRevision_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TradeResponseRevision_packageItemId_fkey" FOREIGN KEY ("packageItemId") REFERENCES "ResponsePackageItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TradeResponseRevision" ("id", "bidId", "packageItemId", "revisionIndex", "responderName", "responderCompany", "channel", "responseType", "responseText", "proposedCompletionDate", "actualCompletionDate", "submittedAt", "enteredBy", "gcReview", "gcReviewBy", "gcReviewAt", "gcCommentary")
SELECT "id", "bidId", "packageItemId", "revisionIndex", "responderName", "responderCompany", "channel", "responseType", "responseText", "proposedCompletionDate", "actualCompletionDate", "submittedAt", "enteredBy", "gcReview", "gcReviewBy", "gcReviewAt", "gcCommentary" FROM "TradeResponseRevision";
DROP TABLE "TradeResponseRevision";
ALTER TABLE "new_TradeResponseRevision" RENAME TO "TradeResponseRevision";
CREATE UNIQUE INDEX "TradeResponseRevision_packageItemId_revisionIndex_key" ON "TradeResponseRevision"("packageItemId", "revisionIndex");
CREATE INDEX "TradeResponseRevision_bidId_packageItemId_idx" ON "TradeResponseRevision"("bidId", "packageItemId");

CREATE TABLE "new_TradeResponseAttachment" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "responseRevisionId" INTEGER NOT NULL,
  "bidId" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeResponseAttachment_responseRevisionId_fkey" FOREIGN KEY ("responseRevisionId") REFERENCES "TradeResponseRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TradeResponseAttachment_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TradeResponseAttachment" ("id", "responseRevisionId", "bidId", "storageKey", "fileName", "mimeType", "byteSize", "createdAt")
SELECT "id", "responseRevisionId", "bidId", "storageKey", "fileName", "mimeType", "byteSize", "createdAt" FROM "TradeResponseAttachment";
DROP TABLE "TradeResponseAttachment";
ALTER TABLE "new_TradeResponseAttachment" RENAME TO "TradeResponseAttachment";
CREATE UNIQUE INDEX "TradeResponseAttachment_responseRevisionId_storageKey_key" ON "TradeResponseAttachment"("responseRevisionId", "storageKey");
CREATE INDEX "TradeResponseAttachment_bidId_responseRevisionId_idx" ON "TradeResponseAttachment"("bidId", "responseRevisionId");

CREATE TABLE "new_ResponseAccessToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bidId" INTEGER NOT NULL,
  "packageId" INTEGER NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "contractorEmail" TEXT,
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" DATETIME,
  CONSTRAINT "ResponseAccessToken_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResponseAccessToken_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ResponsePackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ResponseAccessToken" ("id", "bidId", "packageId", "tokenHash", "contractorEmail", "expiresAt", "revokedAt", "createdBy", "createdAt", "lastUsedAt")
SELECT "id", "bidId", "packageId", "tokenHash", "contractorEmail", "expiresAt", "revokedAt", "createdBy", "createdAt", "lastUsedAt" FROM "ResponseAccessToken";
DROP TABLE "ResponseAccessToken";
ALTER TABLE "new_ResponseAccessToken" RENAME TO "ResponseAccessToken";
CREATE UNIQUE INDEX "ResponseAccessToken_tokenHash_key" ON "ResponseAccessToken"("tokenHash");
CREATE INDEX "ResponseAccessToken_bidId_packageId_idx" ON "ResponseAccessToken"("bidId", "packageId");
CREATE INDEX "ResponseAccessToken_expiresAt_idx" ON "ResponseAccessToken"("expiresAt");

ALTER TABLE "TrackedItem" ADD COLUMN "sourceReportObservationId" INTEGER
  REFERENCES "ReportObservation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "TrackedItem_sourceReportObservationId_key" ON "TrackedItem"("sourceReportObservationId");

-- The original additive migration used SET NULL for responsible contractors.
-- A BEFORE DELETE guard supplies effective RESTRICT behavior without rebuilding
-- the large legacy TrackedItem table or overlapping the separate base lane.
CREATE TRIGGER "R2B2_responsible_contractor_retention_guard"
BEFORE DELETE ON "Subcontractor"
WHEN EXISTS (SELECT 1 FROM "TrackedItem" WHERE "responsibleContractorId" = OLD."id")
BEGIN
  SELECT RAISE(ABORT, 'R2 Build 2 responsible contractor history is retained');
END;

CREATE TABLE "TradeResponseReviewDecision" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "bidId" INTEGER NOT NULL,
  "responseRevisionId" INTEGER NOT NULL,
  "decision" TEXT NOT NULL,
  "commentary" TEXT,
  "reviewedBy" TEXT NOT NULL,
  "correctionOfId" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeResponseReviewDecision_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TradeResponseReviewDecision_responseRevisionId_fkey" FOREIGN KEY ("responseRevisionId") REFERENCES "TradeResponseRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TradeResponseReviewDecision_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "TradeResponseReviewDecision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "TradeResponseReviewDecision_bidId_responseRevisionId_createdAt_idx" ON "TradeResponseReviewDecision"("bidId", "responseRevisionId", "createdAt");
CREATE INDEX "TradeResponseReviewDecision_correctionOfId_idx" ON "TradeResponseReviewDecision"("correctionOfId");

CREATE TABLE "ExternalResponseRateLimitBucket" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" DATETIME NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "ExternalResponseRateLimitBucket_expiresAt_idx" ON "ExternalResponseRateLimitBucket"("expiresAt");

PRAGMA foreign_keys=ON;

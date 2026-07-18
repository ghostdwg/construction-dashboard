-- R2 Build 2 — Field Reports & Trade Response.
-- Additive, forward-only, and intentionally unapplied to any shared/live DB.
-- Status vocabularies remain app-validated strings (never database enums).

ALTER TABLE "TrackedItem" ADD COLUMN "leadTradeId" INTEGER
  REFERENCES "Trade" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrackedItem" ADD COLUMN "responsibleContractorId" INTEGER
  REFERENCES "Subcontractor" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrackedItem" ADD COLUMN "gcInternalResponsibility" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TrackedItem" ADD COLUMN "consultantDiscipline" TEXT;

CREATE INDEX "TrackedItem_bidId_leadTradeId_idx"
  ON "TrackedItem"("bidId", "leadTradeId");
CREATE INDEX "TrackedItem_bidId_responsibleContractorId_idx"
  ON "TrackedItem"("bidId", "responsibleContractorId");

CREATE TABLE "ReportObservation" (
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
  CONSTRAINT "ReportObservation_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReportObservation_fieldReportId_fkey" FOREIGN KEY ("fieldReportId") REFERENCES "FieldReport" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ReportObservation_consultantReportId_fkey" FOREIGN KEY ("consultantReportId") REFERENCES "ConsultantReport" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ReportObservation_registerItemId_fkey" FOREIGN KEY ("registerItemId") REFERENCES "TrackedItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ReportObservation_bidId_disposition_idx" ON "ReportObservation"("bidId", "disposition");
CREATE INDEX "ReportObservation_fieldReportId_idx" ON "ReportObservation"("fieldReportId");
CREATE INDEX "ReportObservation_consultantReportId_idx" ON "ReportObservation"("consultantReportId");
CREATE INDEX "ReportObservation_registerItemId_idx" ON "ReportObservation"("registerItemId");

CREATE TABLE "TrackedItemTradeAssignment" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "bidId" INTEGER NOT NULL,
  "trackedItemId" INTEGER NOT NULL,
  "tradeId" INTEGER NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'SUPPORTING',
  CONSTRAINT "TrackedItemTradeAssignment_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrackedItemTradeAssignment_trackedItemId_fkey" FOREIGN KEY ("trackedItemId") REFERENCES "TrackedItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrackedItemTradeAssignment_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TrackedItemTradeAssignment_trackedItemId_tradeId_key" ON "TrackedItemTradeAssignment"("trackedItemId", "tradeId");
CREATE INDEX "TrackedItemTradeAssignment_bidId_trackedItemId_idx" ON "TrackedItemTradeAssignment"("bidId", "trackedItemId");

CREATE TABLE "ResponsePackage" (
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
  CONSTRAINT "ResponsePackage_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ResponsePackage_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Subcontractor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ResponsePackage_bidId_packageNumber_key" ON "ResponsePackage"("bidId", "packageNumber");
CREATE INDEX "ResponsePackage_bidId_status_idx" ON "ResponsePackage"("bidId", "status");
CREATE INDEX "ResponsePackage_bidId_contractorId_idx" ON "ResponsePackage"("bidId", "contractorId");

CREATE TABLE "ResponsePackageItem" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "packageId" INTEGER NOT NULL,
  "bidId" INTEGER NOT NULL,
  "trackedItemId" INTEGER NOT NULL,
  "displayNumber" TEXT,
  CONSTRAINT "ResponsePackageItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ResponsePackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResponsePackageItem_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ResponsePackageItem_trackedItemId_fkey" FOREIGN KEY ("trackedItemId") REFERENCES "TrackedItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ResponsePackageItem_packageId_trackedItemId_key" ON "ResponsePackageItem"("packageId", "trackedItemId");
CREATE INDEX "ResponsePackageItem_bidId_packageId_idx" ON "ResponsePackageItem"("bidId", "packageId");
CREATE INDEX "ResponsePackageItem_bidId_trackedItemId_idx" ON "ResponsePackageItem"("bidId", "trackedItemId");

CREATE TABLE "TradeResponseRevision" (
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
  CONSTRAINT "TradeResponseRevision_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TradeResponseRevision_packageItemId_fkey" FOREIGN KEY ("packageItemId") REFERENCES "ResponsePackageItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TradeResponseRevision_packageItemId_revisionIndex_key" ON "TradeResponseRevision"("packageItemId", "revisionIndex");
CREATE INDEX "TradeResponseRevision_bidId_packageItemId_idx" ON "TradeResponseRevision"("bidId", "packageItemId");

CREATE TABLE "TradeResponseAttachment" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "responseRevisionId" INTEGER NOT NULL,
  "bidId" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeResponseAttachment_responseRevisionId_fkey" FOREIGN KEY ("responseRevisionId") REFERENCES "TradeResponseRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TradeResponseAttachment_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TradeResponseAttachment_responseRevisionId_storageKey_key" ON "TradeResponseAttachment"("responseRevisionId", "storageKey");
CREATE INDEX "TradeResponseAttachment_bidId_responseRevisionId_idx" ON "TradeResponseAttachment"("bidId", "responseRevisionId");

CREATE TABLE "ResponseAccessToken" (
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
  CONSTRAINT "ResponseAccessToken_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ResponseAccessToken_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ResponsePackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ResponseAccessToken_tokenHash_key" ON "ResponseAccessToken"("tokenHash");
CREATE INDEX "ResponseAccessToken_bidId_packageId_idx" ON "ResponseAccessToken"("bidId", "packageId");
CREATE INDEX "ResponseAccessToken_expiresAt_idx" ON "ResponseAccessToken"("expiresAt");

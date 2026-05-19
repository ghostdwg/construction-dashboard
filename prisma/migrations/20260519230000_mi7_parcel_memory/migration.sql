-- Phase MI-7 — Parcel Memory + Spatial Emergence Intelligence
--
-- Additive schema: 10 new models for persistent parcel memory plus a 3-column
-- augmentation of ProjectParcel that preserves all existing rows (dual-read
-- pattern, mirrors MI-1's RelationshipEdge augmentation).
--
-- Reversibility: every new table is empty at migration time; rollback is
-- DROP TABLE IF EXISTS for the 10 new tables and dropping the three columns
-- from ProjectParcel. See scripts/rollback-mi7-parcel-memory.ts (PR-2).

-- ── New canonical Parcel ─────────────────────────────────────────────────────
CREATE TABLE "Parcel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalRef" TEXT NOT NULL,
    "normalizedRef" TEXT NOT NULL,
    "parcelKind" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "assessorParcelId" TEXT,
    "legalDescription" TEXT,
    "primaryAddress" TEXT,
    "jurisdiction" TEXT,
    "state" TEXT,
    "centroidLat" REAL,
    "centroidLng" REAL,
    "areaSqft" REAL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'AUTO',
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "source" TEXT,
    "notes" TEXT,
    "mergedIntoParcelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Parcel_mergedIntoParcelId_fkey" FOREIGN KEY ("mergedIntoParcelId") REFERENCES "Parcel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Parcel_normalizedRef_key" ON "Parcel"("normalizedRef");
CREATE INDEX "Parcel_parcelKind_idx" ON "Parcel"("parcelKind");
CREATE INDEX "Parcel_reviewStatus_idx" ON "Parcel"("reviewStatus");
CREATE INDEX "Parcel_jurisdiction_idx" ON "Parcel"("jurisdiction");
CREATE INDEX "Parcel_state_idx" ON "Parcel"("state");
CREATE INDEX "Parcel_assessorParcelId_idx" ON "Parcel"("assessorParcelId");
CREATE INDEX "Parcel_primaryAddress_idx" ON "Parcel"("primaryAddress");
CREATE INDEX "Parcel_mergedIntoParcelId_idx" ON "Parcel"("mergedIntoParcelId");

-- ── ParcelAlias ──────────────────────────────────────────────────────────────
CREATE TABLE "ParcelAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parcelId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "aliasKind" TEXT NOT NULL DEFAULT 'INFORMAL',
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ParcelAlias_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ParcelAlias_normalizedAlias_idx" ON "ParcelAlias"("normalizedAlias");
CREATE INDEX "ParcelAlias_parcelId_idx" ON "ParcelAlias"("parcelId");
CREATE INDEX "ParcelAlias_aliasKind_idx" ON "ParcelAlias"("aliasKind");
CREATE UNIQUE INDEX "ParcelAlias_parcelId_normalizedAlias_key" ON "ParcelAlias"("parcelId", "normalizedAlias");

-- ── ParcelOwnershipPeriod ────────────────────────────────────────────────────
CREATE TABLE "ParcelOwnershipPeriod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parcelId" TEXT NOT NULL,
    "ownerEntityId" TEXT,
    "ownerNameRaw" TEXT NOT NULL,
    "ownedFrom" DATETIME NOT NULL,
    "ownedTo" DATETIME,
    "transferKind" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "transferValue" REAL,
    "source" TEXT,
    "sourceUrl" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ParcelOwnershipPeriod_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ParcelOwnershipPeriod_parcelId_ownedFrom_idx" ON "ParcelOwnershipPeriod"("parcelId", "ownedFrom");
CREATE INDEX "ParcelOwnershipPeriod_ownerEntityId_idx" ON "ParcelOwnershipPeriod"("ownerEntityId");
CREATE INDEX "ParcelOwnershipPeriod_ownedTo_idx" ON "ParcelOwnershipPeriod"("ownedTo");

-- ── ParcelSignal ─────────────────────────────────────────────────────────────
CREATE TABLE "ParcelSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parcelId" TEXT NOT NULL,
    "signalKind" TEXT NOT NULL,
    "sourceMarketSignalId" TEXT,
    "sourceRelationshipEdgeId" TEXT,
    "sourceMarketLeadId" TEXT,
    "sourceMarketSourceDocId" TEXT,
    "sourceExternalRef" TEXT,
    "attachReason" TEXT NOT NULL,
    "attachScore" REAL NOT NULL DEFAULT 0,
    "attachConfidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "factorJson" TEXT,
    "firstObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detachedAt" DATETIME,
    "detachedReason" TEXT,
    "detachedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ParcelSignal_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ParcelSignal_parcelId_idx" ON "ParcelSignal"("parcelId");
CREATE INDEX "ParcelSignal_signalKind_idx" ON "ParcelSignal"("signalKind");
CREATE INDEX "ParcelSignal_sourceMarketSignalId_idx" ON "ParcelSignal"("sourceMarketSignalId");
CREATE INDEX "ParcelSignal_sourceRelationshipEdgeId_idx" ON "ParcelSignal"("sourceRelationshipEdgeId");
CREATE INDEX "ParcelSignal_sourceMarketLeadId_idx" ON "ParcelSignal"("sourceMarketLeadId");
CREATE INDEX "ParcelSignal_sourceMarketSourceDocId_idx" ON "ParcelSignal"("sourceMarketSourceDocId");
CREATE INDEX "ParcelSignal_firstObservedAt_idx" ON "ParcelSignal"("firstObservedAt");

-- ── ParcelProject ────────────────────────────────────────────────────────────
CREATE TABLE "ParcelProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parcelId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "attachReason" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "role" TEXT NOT NULL DEFAULT 'primary',
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detachedAt" DATETIME,
    "detachedReason" TEXT,
    "detachedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ParcelProject_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ParcelProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ParcelProject_parcelId_idx" ON "ParcelProject"("parcelId");
CREATE INDEX "ParcelProject_projectId_idx" ON "ParcelProject"("projectId");
CREATE INDEX "ParcelProject_role_idx" ON "ParcelProject"("role");
CREATE UNIQUE INDEX "ParcelProject_parcelId_projectId_role_key" ON "ParcelProject"("parcelId", "projectId", "role");

-- ── ParcelAdjacency ──────────────────────────────────────────────────────────
CREATE TABLE "ParcelAdjacency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromParcelId" TEXT NOT NULL,
    "toParcelId" TEXT NOT NULL,
    "adjacencyKind" TEXT NOT NULL DEFAULT 'INFERRED',
    "approxDistanceFt" REAL,
    "bearingDegrees" REAL,
    "source" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'LOW',
    "reviewStatus" TEXT NOT NULL DEFAULT 'AUTO',
    "notes" TEXT,
    "firstObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ParcelAdjacency_fromParcelId_fkey" FOREIGN KEY ("fromParcelId") REFERENCES "Parcel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ParcelAdjacency_toParcelId_fkey" FOREIGN KEY ("toParcelId") REFERENCES "Parcel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ParcelAdjacency_fromParcelId_idx" ON "ParcelAdjacency"("fromParcelId");
CREATE INDEX "ParcelAdjacency_toParcelId_idx" ON "ParcelAdjacency"("toParcelId");
CREATE INDEX "ParcelAdjacency_adjacencyKind_idx" ON "ParcelAdjacency"("adjacencyKind");
CREATE UNIQUE INDEX "ParcelAdjacency_fromParcelId_toParcelId_adjacencyKind_key" ON "ParcelAdjacency"("fromParcelId", "toParcelId", "adjacencyKind");

-- ── ParcelJurisdiction ───────────────────────────────────────────────────────
CREATE TABLE "ParcelJurisdiction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parcelId" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "jurisdictionKind" TEXT NOT NULL DEFAULT 'MUNICIPALITY',
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "source" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ParcelJurisdiction_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ParcelJurisdiction_parcelId_effectiveFrom_idx" ON "ParcelJurisdiction"("parcelId", "effectiveFrom");
CREATE INDEX "ParcelJurisdiction_jurisdiction_idx" ON "ParcelJurisdiction"("jurisdiction");
CREATE INDEX "ParcelJurisdiction_effectiveTo_idx" ON "ParcelJurisdiction"("effectiveTo");

-- ── ParcelUtilityContext ─────────────────────────────────────────────────────
CREATE TABLE "ParcelUtilityContext" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parcelId" TEXT NOT NULL,
    "utilityKind" TEXT NOT NULL,
    "availability" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "providerName" TEXT,
    "capacity" TEXT,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "source" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ParcelUtilityContext_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ParcelUtilityContext_parcelId_utilityKind_effectiveFrom_idx" ON "ParcelUtilityContext"("parcelId", "utilityKind", "effectiveFrom");
CREATE INDEX "ParcelUtilityContext_availability_idx" ON "ParcelUtilityContext"("availability");

-- ── ParcelZoningContext ──────────────────────────────────────────────────────
CREATE TABLE "ParcelZoningContext" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parcelId" TEXT NOT NULL,
    "zoningCode" TEXT NOT NULL,
    "zoningKind" TEXT NOT NULL DEFAULT 'CURRENT',
    "overlayCode" TEXT,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "triggerSignalRefKind" TEXT,
    "triggerSignalRefId" TEXT,
    "source" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ParcelZoningContext_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ParcelZoningContext_parcelId_effectiveFrom_idx" ON "ParcelZoningContext"("parcelId", "effectiveFrom");
CREATE INDEX "ParcelZoningContext_zoningCode_idx" ON "ParcelZoningContext"("zoningCode");
CREATE INDEX "ParcelZoningContext_zoningKind_idx" ON "ParcelZoningContext"("zoningKind");

-- ── ParcelPressureSnapshot ───────────────────────────────────────────────────
CREATE TABLE "ParcelPressureSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parcelId" TEXT NOT NULL,
    "pressureScore" REAL NOT NULL,
    "factorsJson" TEXT NOT NULL,
    "pressureVersion" TEXT NOT NULL DEFAULT 'v1',
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    CONSTRAINT "ParcelPressureSnapshot_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ParcelPressureSnapshot_parcelId_computedAt_idx" ON "ParcelPressureSnapshot"("parcelId", "computedAt");
CREATE INDEX "ParcelPressureSnapshot_pressureScore_idx" ON "ParcelPressureSnapshot"("pressureScore");

-- ── ProjectParcel augmentation: 3 nullable columns + FK to Parcel ────────────
-- SQLite-style ALTER TABLE via table-redefine. All existing data is preserved
-- exactly; new columns default to NULL.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ProjectParcel" (
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
    "canonicalParcelId" TEXT,
    "parcelResolverVersion" TEXT,
    "parcelResolverConfidence" TEXT,
    "attachedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectParcel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectParcel_canonicalParcelId_fkey" FOREIGN KEY ("canonicalParcelId") REFERENCES "Parcel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_ProjectParcel" ("address", "areaSqft", "attachReason", "attachedAt", "confidence", "id", "jurisdiction", "lat", "lng", "parcelId", "parcelSource", "projectId", "updatedAt")
SELECT "address", "areaSqft", "attachReason", "attachedAt", "confidence", "id", "jurisdiction", "lat", "lng", "parcelId", "parcelSource", "projectId", "updatedAt"
FROM "ProjectParcel";

DROP TABLE "ProjectParcel";
ALTER TABLE "new_ProjectParcel" RENAME TO "ProjectParcel";

CREATE INDEX "ProjectParcel_projectId_idx" ON "ProjectParcel"("projectId");
CREATE INDEX "ProjectParcel_parcelId_idx" ON "ProjectParcel"("parcelId");
CREATE INDEX "ProjectParcel_jurisdiction_idx" ON "ProjectParcel"("jurisdiction");
CREATE INDEX "ProjectParcel_canonicalParcelId_idx" ON "ProjectParcel"("canonicalParcelId");
CREATE UNIQUE INDEX "ProjectParcel_projectId_parcelId_parcelSource_key" ON "ProjectParcel"("projectId", "parcelId", "parcelSource");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
